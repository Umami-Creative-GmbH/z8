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

function createTransaction(employees: Array<{ userId: string | null }> = []) {
	const events: string[] = [];
	const tableName = (table: unknown) => {
		if (table === authSchema.organization) return "organization";
		if (table === authSchema.ssoProvider) return "sso_provider";
		if (table === authSchema.session) return "session";
		if (table === schema.waterIntakeLog) return "water_intake_log";
		if (table === schema.pushSubscription) return "push_subscription";
		return "other";
	};
	const deleteFrom = vi.fn((table: unknown) => ({
		where: vi.fn(async () => {
			events.push(`delete:${tableName(table)}`);
		}),
	}));
	const update = vi.fn((table: unknown) => ({
		set: vi.fn(() => ({
			where: vi.fn(async () => {
				events.push(`update:${tableName(table)}`);
			}),
		})),
	}));
	const execute = vi.fn(async () => ({ rows: [] }));
	const tx = {
		execute,
		delete: deleteFrom,
		update,
		query: { employee: { findMany: vi.fn().mockResolvedValue(employees) } },
	};
	return { deleteFrom, events, execute, tx };
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
		const { deleteFrom, events, execute, tx } = createTransaction([
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
		// Only rows outside the organization cascade are handled explicitly (#306):
		// no employee, history or approval table is deleted before the organization.
		expect(events).toEqual([
			"delete:water_intake_log",
			"delete:push_subscription",
			"update:session",
			"delete:sso_provider",
			"delete:organization",
		]);
		expect(execute).not.toHaveBeenCalled();
		expect(deleteFrom).not.toHaveBeenCalledWith(authSchema.member);
		expect(deleteFrom).not.toHaveBeenCalledWith(schema.employee);
		expect(deleteFrom).toHaveBeenLastCalledWith(authSchema.organization);
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
