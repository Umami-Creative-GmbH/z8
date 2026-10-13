import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	actor: null as null | {
		accessTier: "orgAdmin" | "manager" | "member";
		organizationId: string;
		session: { user: { id: string } };
	},
	loadWageHistoryMergeNote: vi.fn(
		async (_database: unknown, _input: unknown): Promise<unknown> => ({
			mergedOn: "2026-10-14",
			adjustedCount: 2,
		}),
	),
	dismissWageHistoryMergeNote: vi.fn(async (_database: unknown, _input: unknown) => undefined),
	scopedDb: { name: "scoped-db" },
}));

vi.mock("@/db", () => ({ db: { name: "global-db" } }));
vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	return runtimeModuleOver(
		Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mocks.scopedDb as never,
				query: (_name, query) => Effect.promise(query),
			}),
		),
	);
});
vi.mock("./employee-action-utils", async (importOriginal) => {
	const { Effect } = await import("effect");
	const { AuthorizationError } = await import("@/lib/effect/errors");
	const original = await importOriginal<typeof import("./employee-action-utils")>();
	return {
		...original,
		getEmployeeSettingsActorContext: vi.fn(() =>
			mocks.actor
				? Effect.succeed(mocks.actor)
				: Effect.fail(new AuthorizationError({ message: "Not signed in", userId: "unknown" })),
		),
	};
});
vi.mock("@/lib/employment-history/wage-history-merge-note", () => ({
	loadWageHistoryMergeNote: mocks.loadWageHistoryMergeNote,
	dismissWageHistoryMergeNote: mocks.dismissWageHistoryMergeNote,
}));

const { dismissWageHistoryMergeNoteAction, getWageHistoryMergeNoteAction } = await import(
	"./wage-history-merge-note-actions"
);

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";

function actor(accessTier: "orgAdmin" | "manager" | "member") {
	return { accessTier, organizationId: "org-1", session: { user: { id: "user-1" } } };
}

describe("wage history merge note actions (#1176)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.actor = null;
	});

	it("reads the employee's note in the org admin's organization", async () => {
		mocks.actor = actor("orgAdmin");

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
		mocks.actor = actor("orgAdmin");

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

	it.each(["manager", "member"] as const)(
		"shows a %s nothing and lets them dismiss nothing",
		async (accessTier) => {
			mocks.actor = actor(accessTier);

			await expect(getWageHistoryMergeNoteAction(EMPLOYEE_ID)).resolves.toMatchObject({
				success: false,
			});
			await expect(dismissWageHistoryMergeNoteAction(EMPLOYEE_ID)).resolves.toMatchObject({
				success: false,
			});
			expect(mocks.loadWageHistoryMergeNote).not.toHaveBeenCalled();
			expect(mocks.dismissWageHistoryMergeNote).not.toHaveBeenCalled();
		},
	);

	it("refuses an employee id that is not a UUID", async () => {
		mocks.actor = actor("orgAdmin");

		await expect(getWageHistoryMergeNoteAction("nope")).resolves.toMatchObject({
			success: false,
		});
		await expect(dismissWageHistoryMergeNoteAction("nope")).resolves.toMatchObject({
			success: false,
		});
		expect(mocks.loadWageHistoryMergeNote).not.toHaveBeenCalled();
		expect(mocks.dismissWageHistoryMergeNote).not.toHaveBeenCalled();
	});
});
