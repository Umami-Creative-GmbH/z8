import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	actor: null as null | {
		accessTier: "orgAdmin" | "manager" | "member";
		organizationId: string;
		session: { user: { id: string } };
	},
	dismissWorkingWeekNotice: vi.fn(async (_database: unknown, _input: unknown) => undefined),
	revalidatePath: vi.fn(),
	scopedDb: { name: "scoped-db" },
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
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
vi.mock("../employees/employee-action-utils", async (importOriginal) => {
	const { Effect } = await import("effect");
	const { AuthorizationError } = await import("@/lib/effect/errors");
	const original = await importOriginal<typeof import("../employees/employee-action-utils")>();
	return {
		...original,
		getEmployeeSettingsActorContext: vi.fn(() =>
			mocks.actor
				? Effect.succeed(mocks.actor)
				: Effect.fail(new AuthorizationError({ message: "Not signed in", userId: "unknown" })),
		),
	};
});
vi.mock("@/lib/absences/working-week-notice-store", () => ({
	dismissWorkingWeekNotice: mocks.dismissWorkingWeekNotice,
}));

const { dismissWorkingWeekNoticeAction } = await import("./working-week-notice-actions");

function actor(accessTier: "orgAdmin" | "manager" | "member") {
	return { accessTier, organizationId: "org-1", session: { user: { id: "user-1" } } };
}

describe("dismissWorkingWeekNoticeAction (#990)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.actor = null;
	});

	it("dismisses the notice for the actor's organization through the action's database", async () => {
		mocks.actor = actor("orgAdmin");

		await expect(dismissWorkingWeekNoticeAction()).resolves.toEqual({
			success: true,
			data: undefined,
		});
		expect(mocks.dismissWorkingWeekNotice).toHaveBeenCalledWith(mocks.scopedDb, {
			organizationId: "org-1",
			actorUserId: "user-1",
		});
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/vacation");
		expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/vacation/employees");
	});

	it.each(["manager", "member"] as const)("refuses a %s", async (accessTier) => {
		mocks.actor = actor(accessTier);

		await expect(dismissWorkingWeekNoticeAction()).resolves.toMatchObject({ success: false });
		expect(mocks.dismissWorkingWeekNotice).not.toHaveBeenCalled();
		expect(mocks.revalidatePath).not.toHaveBeenCalled();
	});

	it("refuses without a session or an active organization", async () => {
		await expect(dismissWorkingWeekNoticeAction()).resolves.toMatchObject({ success: false });
		expect(mocks.dismissWorkingWeekNotice).not.toHaveBeenCalled();
	});
});
