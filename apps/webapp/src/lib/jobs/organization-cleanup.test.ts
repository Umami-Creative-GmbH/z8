import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";

const mocks = vi.hoisted(() => ({
	db: {
		query: { organization: { findMany: vi.fn() } },
		transaction: vi.fn(),
	},
}));

vi.mock("@/db", () => ({ db: mocks.db }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: vi.fn(), info: vi.fn() }),
}));

import { runOrganizationCleanup } from "./organization-cleanup";

interface OtherOrganizationRows {
	members?: Array<{ userId: string }>;
	employees?: Array<{ userId: string }>;
}

function createTransaction(
	employees: Array<{ userId: string | null }> = [],
	otherOrganizations: OtherOrganizationRows = {},
) {
	const events: string[] = [];
	const deleteWhere = new Map<string, SQL>();
	const tableName = (table: unknown) => {
		if (table === authSchema.organization) return "organization";
		if (table === authSchema.ssoProvider) return "sso_provider";
		if (table === authSchema.session) return "session";
		if (table === schema.waterIntakeLog) return "water_intake_log";
		if (table === schema.pushSubscription) return "push_subscription";
		return "other";
	};
	const deleteFrom = vi.fn((table: unknown) => ({
		where: vi.fn(async (where: SQL) => {
			events.push(`delete:${tableName(table)}`);
			deleteWhere.set(tableName(table), where);
		}),
	}));
	// Memberships and employees of the candidates in other organizations.
	const select = vi.fn(() => ({
		from: vi.fn((table: unknown) => ({
			where: vi.fn(async () =>
				table === authSchema.member
					? (otherOrganizations.members ?? [])
					: (otherOrganizations.employees ?? []),
			),
		})),
	}));
	const update = vi.fn((table: unknown) => ({
		set: vi.fn(() => ({
			where: vi.fn(async () => {
				events.push(`update:${tableName(table)}`);
			}),
		})),
	}));
	const execute = vi.fn(async () => {
		events.push("guard");
		return { rows: [] };
	});
	const tx = {
		execute,
		select,
		delete: deleteFrom,
		update,
		query: {
			employee: { findMany: vi.fn().mockResolvedValue(employees) },
			member: { findMany: vi.fn().mockResolvedValue([{ userId: "user-2" }]) },
		},
	};
	return { deleteFrom, deleteWhere, events, execute, tx };
}

function deletedUserIds(where: SQL | undefined) {
	return where ? new PgDialect().sqlToQuery(where).params : undefined;
}

describe("organization cleanup topology", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.db.query.organization.findMany.mockResolvedValue([
			{
				id: "org-1",
				name: "Deleted organization",
				deletedAt: new Date(0),
			},
		]);
	});

	it("deletes the organization in one transaction and lets its cascade remove tenant data", async () => {
		const { deleteFrom, events, tx } = createTransaction([
			{ userId: "user-1" },
			{ userId: null },
		]);
		mocks.db.transaction.mockImplementation(async (run) => run(tx));

		const result = await runOrganizationCleanup();

		expect(result).toMatchObject({
			success: true,
			organizationsDeleted: 1,
			errors: [],
		});
		expect(mocks.db.transaction).toHaveBeenCalledOnce();
		// Exclusive organization configuration protection, then the guards of
		// user-1 and user-2, precede the first delete (#318). Only rows outside
		// the organization cascade are handled explicitly (#306): no employee,
		// history or approval table is deleted before the organization.
		expect(events).toEqual([
			"guard",
			"guard",
			"guard",
			"delete:push_subscription",
			"update:session",
			"delete:sso_provider",
			"delete:organization",
		]);
		expect(deleteFrom).not.toHaveBeenCalledWith(authSchema.member);
		expect(deleteFrom).not.toHaveBeenCalledWith(schema.employee);
		expect(deleteFrom).toHaveBeenLastCalledWith(authSchema.organization);
	});

	it("keeps user-level rows of users who stay in another organization (#437)", async () => {
		const { deleteFrom, deleteWhere, events, tx } = createTransaction(
			[{ userId: "user-1" }, { userId: "user-3" }, { userId: "user-4" }],
			{ members: [{ userId: "user-1" }], employees: [{ userId: "user-3" }] },
		);
		mocks.db.transaction.mockImplementation(async (run) => run(tx));

		const result = await runOrganizationCleanup();

		expect(result.success).toBe(true);
		// user-1 keeps a membership and user-3 an employee elsewhere; only
		// user-4 leaves every organization and loses their push subscriptions.
		expect(deletedUserIds(deleteWhere.get("push_subscription"))).toEqual(["user-4"]);
		// Water intake logs are personal history and outlive every organization.
		expect(deleteFrom).not.toHaveBeenCalledWith(schema.waterIntakeLog);
		expect(events.at(-1)).toBe("delete:organization");
	});

	it("deletes no push subscription when every user stays in another organization", async () => {
		const { deleteFrom, events, tx } = createTransaction([{ userId: "user-1" }], {
			members: [{ userId: "user-1" }],
		});
		mocks.db.transaction.mockImplementation(async (run) => run(tx));

		await runOrganizationCleanup();

		expect(deleteFrom).not.toHaveBeenCalledWith(schema.pushSubscription);
		expect(events).toEqual([
			"guard",
			"guard",
			"guard",
			"update:session",
			"delete:sso_provider",
			"delete:organization",
		]);
	});

	it("reports a failed deletion without partial success", async () => {
		const { tx } = createTransaction();
		tx.delete = vi.fn(() => ({
			where: vi.fn(async () => {
				throw new Error("violates foreign key constraint");
			}),
		}));
		mocks.db.transaction.mockImplementation(async (run) => run(tx));

		const result = await runOrganizationCleanup();

		expect(result).toEqual({
			success: false,
			organizationsDeleted: 0,
			errors: ["Failed to delete org org-1: violates foreign key constraint"],
		});
	});
});
