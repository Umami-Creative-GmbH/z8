import { sql } from "drizzle-orm";
import { Effect } from "effect";
import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/effect/errors";
import type { DatabaseQuery } from "@/lib/effect/services/database.service";
import type { StubCaller } from "@/test/organization-action";

const TEAM_ID = "d1618000-0000-4000-8000-0000000000a1";
const EMPLOYEE_ID = "d1618000-0000-4000-8000-000000000001";
const ASSIGNMENT_ID = "d1618000-0000-4000-8000-0000000000b1";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	notOnRoster: [] as string[],
	readPositionCaptureSettings: vi.fn(),
	listPositionNotices: vi.fn(),
	savePositionCaptureSettings: vi.fn(),
	setPositionCaptureAssignment: vi.fn(),
	removePositionCaptureAssignment: vi.fn(),
}));

/** A select chain that resolves to no rows and can stand in for a subquery. */
function emptySelect(): unknown {
	const chain: Record<string, unknown> = {
		getSQL: () => sql`select 1`,
		// biome-ignore lint/suspicious/noThenProperty: a thenable query builder stand-in
		then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
	};
	for (const method of ["from", "innerJoin", "where", "orderBy"]) chain[method] = () => chain;
	return chain;
}

const fakeDb = {
	select: () => emptySelect(),
	transaction: (work: (tx: unknown) => unknown) => work(fakeDb),
};

/** Like the real `DatabaseService.query`: a rejection becomes a `DatabaseError` with its cause. */
const query: DatabaseQuery = (name, fn) =>
	name === "employeeLifecycle.findNotOnCurrentRoster"
		? (Effect.succeed(mocks.notOnRoster) as never)
		: Effect.tryPromise({
				try: fn,
				catch: (cause) => new DatabaseError({ message: name, operation: name, cause }),
			});

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: fakeDb, query }));
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/time-tracking/position-capture/store", () => ({
	readPositionCaptureSettings: mocks.readPositionCaptureSettings,
	listPositionNotices: mocks.listPositionNotices,
	savePositionCaptureSettings: mocks.savePositionCaptureSettings,
	setPositionCaptureAssignment: mocks.setPositionCaptureAssignment,
	removePositionCaptureAssignment: mocks.removePositionCaptureAssignment,
}));

const { PositionCaptureRefusal } = await import("@/lib/time-tracking/position-capture/errors");
const {
	getPositionCaptureAdminDataAction,
	removePositionCaptureAssignmentAction,
	savePositionCaptureSettingsAction,
	setPositionCaptureAssignmentAction,
} = await import("./actions");

const orgAdmin: StubCaller = {
	userId: "user-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-admin", role: "admin", former: false },
};
/** A team manager: settings access one level below the org admin the actions require. */
const scopedManager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};

const settings = { enabled: true, purposeStatement: "Customer proof", retentionDays: 90 };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.notOnRoster = [];
	mocks.readPositionCaptureSettings.mockResolvedValue({
		enabled: false,
		purposeStatement: null,
		retentionDays: 90,
	});
	mocks.listPositionNotices.mockResolvedValue([
		{
			id: "notice-1",
			version: 1,
			purposeStatement: "Customer proof",
			retentionDays: 90,
			templateRevision: 1,
			createdAt: Temporal.Instant.from("2026-01-02T03:04:05Z"),
		},
	]);
	mocks.savePositionCaptureSettings.mockResolvedValue({ publishedNotice: { version: 2 } });
	mocks.setPositionCaptureAssignment.mockResolvedValue({ assignmentId: ASSIGNMENT_ID });
	mocks.removePositionCaptureAssignment.mockResolvedValue(undefined);
});

const refused = { success: false, code: "AuthorizationError" };

describe("position capture settings actions", () => {
	it("refuses a scoped manager everything", async () => {
		mocks.caller = scopedManager;

		expect(await getPositionCaptureAdminDataAction()).toMatchObject(refused);
		expect(await savePositionCaptureSettingsAction(settings)).toMatchObject(refused);
		expect(
			await setPositionCaptureAssignmentAction({
				target: { type: "organization" },
				captureEnabled: true,
			}),
		).toMatchObject(refused);
		expect(
			await removePositionCaptureAssignmentAction({ assignmentId: ASSIGNMENT_ID }),
		).toMatchObject(refused);
		expect(mocks.savePositionCaptureSettings).not.toHaveBeenCalled();
		expect(mocks.setPositionCaptureAssignment).not.toHaveBeenCalled();
		expect(mocks.removePositionCaptureAssignment).not.toHaveBeenCalled();
	});

	it("loads the session organization's configuration for an org admin", async () => {
		const result = await getPositionCaptureAdminDataAction();

		expect(result).toMatchObject({
			success: true,
			data: {
				settings: { enabled: false, purposeStatement: null, retentionDays: 90 },
				notices: [{ id: "notice-1", version: 1, createdAt: "2026-01-02T03:04:05Z" }],
				assignments: [],
				teams: [],
				employees: [],
			},
		});
		expect(mocks.readPositionCaptureSettings).toHaveBeenCalledWith(fakeDb, "org-1");
	});

	it("saves the settings as the caller and returns the published notice version", async () => {
		expect(await savePositionCaptureSettingsAction(settings)).toEqual({
			success: true,
			data: { publishedNoticeVersion: 2 },
		});
		expect(mocks.savePositionCaptureSettings).toHaveBeenCalledWith(fakeDb, {
			organizationId: "org-1",
			actorUserId: "user-admin",
			settings,
		});
	});

	it("returns the store's refusal code", async () => {
		mocks.savePositionCaptureSettings.mockRejectedValue(
			new PositionCaptureRefusal("purpose_required", "A purpose is required"),
		);

		expect(
			await savePositionCaptureSettingsAction({ ...settings, purposeStatement: " " }),
		).toMatchObject({ success: false, code: "ValidationError", refusal: "purpose_required" });
	});

	it("sets a team assignment", async () => {
		expect(
			await setPositionCaptureAssignmentAction({
				target: { type: "team", teamId: TEAM_ID },
				captureEnabled: true,
			}),
		).toEqual({ success: true, data: { assignmentId: ASSIGNMENT_ID } });
		expect(mocks.setPositionCaptureAssignment).toHaveBeenCalledWith(fakeDb, {
			organizationId: "org-1",
			actorUserId: "user-admin",
			target: { type: "team", teamId: TEAM_ID },
			captureEnabled: true,
		});
	});

	it("refuses an invalid target before the store runs", async () => {
		expect(
			await setPositionCaptureAssignmentAction({
				target: { type: "employee", employeeId: "not-a-uuid" },
				captureEnabled: true,
			}),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(
			await setPositionCaptureAssignmentAction({
				target: { type: "everyone" } as never,
				captureEnabled: true,
			}),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.setPositionCaptureAssignment).not.toHaveBeenCalled();
	});

	it("leaves the roster rule to the store, so a former employee's existing assignment still switches", async () => {
		mocks.notOnRoster = [EMPLOYEE_ID];

		expect(
			await setPositionCaptureAssignmentAction({
				target: { type: "employee", employeeId: EMPLOYEE_ID },
				captureEnabled: true,
			}),
		).toMatchObject({ success: true });
		expect(mocks.setPositionCaptureAssignment).toHaveBeenCalled();
	});

	it("removes an assignment of the session organization", async () => {
		expect(await removePositionCaptureAssignmentAction({ assignmentId: ASSIGNMENT_ID })).toEqual({
			success: true,
			data: { assignmentId: ASSIGNMENT_ID },
		});
		expect(mocks.removePositionCaptureAssignment).toHaveBeenCalledWith(fakeDb, {
			organizationId: "org-1",
			actorUserId: "user-admin",
			assignmentId: ASSIGNMENT_ID,
		});
	});
});
