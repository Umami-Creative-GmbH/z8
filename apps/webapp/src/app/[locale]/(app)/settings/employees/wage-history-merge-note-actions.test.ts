import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	loadWageHistoryMergeNote: vi.fn(
		async (_database: unknown, _input: unknown): Promise<unknown> => ({
			mergedOn: "2026-10-14",
			adjustedCount: 2,
		}),
	),
	dismissWageHistoryMergeNote: vi.fn(async (_database: unknown, _input: unknown) => undefined),
	scopedDb: { name: "scoped-db" },
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: mocks.scopedDb }));
});
vi.mock("@/lib/employment-history/wage-history-merge-note", () => ({
	loadWageHistoryMergeNote: mocks.loadWageHistoryMergeNote,
	dismissWageHistoryMergeNote: mocks.dismissWageHistoryMergeNote,
}));

const { dismissWageHistoryMergeNoteAction, getWageHistoryMergeNoteAction } = await import(
	"./wage-history-merge-note-actions"
);

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "user-2",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};

describe("wage history merge note actions (#1176)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = null;
	});

	it("reads the employee's note in the org admin's organization", async () => {
		mocks.caller = orgAdmin;

		await expect(getWageHistoryMergeNoteAction(EMPLOYEE_ID)).resolves.toEqual({
			success: true,
			data: { mergedOn: "2026-10-14", adjustedCount: 2 },
		});
		expect(mocks.loadWageHistoryMergeNote).toHaveBeenCalledWith(mocks.scopedDb, {
			organizationId: "org-1",
			employeeId: EMPLOYEE_ID,
		});
	});

	it("dismisses the employee's note for the org admin's organization", async () => {
		mocks.caller = orgAdmin;

		await expect(dismissWageHistoryMergeNoteAction(EMPLOYEE_ID)).resolves.toEqual({
			success: true,
			data: undefined,
		});
		expect(mocks.dismissWageHistoryMergeNote).toHaveBeenCalledWith(mocks.scopedDb, {
			organizationId: "org-1",
			employeeId: EMPLOYEE_ID,
			actorUserId: "user-1",
		});
	});

	it("refuses a scoped manager, one level below org admin", async () => {
		mocks.caller = scopedManager;

		await expect(getWageHistoryMergeNoteAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		await expect(dismissWageHistoryMergeNoteAction(EMPLOYEE_ID)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.loadWageHistoryMergeNote).not.toHaveBeenCalled();
		expect(mocks.dismissWageHistoryMergeNote).not.toHaveBeenCalled();
	});

	it("refuses an employee id that is not a UUID", async () => {
		mocks.caller = orgAdmin;

		await expect(getWageHistoryMergeNoteAction("nope")).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
		});
		await expect(dismissWageHistoryMergeNoteAction("nope")).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
		});
		expect(mocks.loadWageHistoryMergeNote).not.toHaveBeenCalled();
		expect(mocks.dismissWageHistoryMergeNote).not.toHaveBeenCalled();
	});
});
