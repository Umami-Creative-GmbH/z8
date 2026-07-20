import { beforeEach, describe, expect, it, vi } from "vitest";
import * as authSchema from "@/db/auth-schema";

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

function createTransaction() {
	const events: string[] = [];
	const deleteWhere = vi.fn(async () => undefined);
	const deleteFrom = vi.fn((table: unknown) => ({
		where: vi.fn(async () => {
			if (table === authSchema.member) events.push("member-delete");
			if (table === authSchema.organization) events.push("organization-delete");
			return deleteWhere();
		}),
	}));
	const update = vi.fn(() => ({ set: vi.fn(() => ({ where: vi.fn() })) }));
	const findMany = vi.fn().mockResolvedValue([]);
	const tx = {
		delete: deleteFrom,
		update,
		query: {
			employee: { findMany },
			holidayPreset: { findMany },
			project: { findMany },
			shift: { findMany },
			surchargeModel: { findMany },
			workPolicy: { findMany },
			workPolicySchedule: { findMany },
			workPolicyRegulation: { findMany },
			workPolicyBreakRule: { findMany },
			location: { findMany },
		},
	};
	return { deleteFrom, events, tx };
}

describe("organization cleanup membership cascade", () => {
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

	it("deletes tenant data then the organization without directly deleting memberships", async () => {
		const { deleteFrom, events, tx } = createTransaction();
		mocks.db.transaction.mockImplementation(async (run) => run(tx));

		const result = await runOrganizationCleanup();

		expect(result).toMatchObject({
			success: true,
			organizationsDeleted: 1,
			errors: [],
		});
		expect(mocks.db.transaction).toHaveBeenCalledOnce();
		expect(deleteFrom).not.toHaveBeenCalledWith(authSchema.member);
		expect(events).toEqual(["organization-delete"]);
		expect(deleteFrom).toHaveBeenLastCalledWith(authSchema.organization);
	});
});
