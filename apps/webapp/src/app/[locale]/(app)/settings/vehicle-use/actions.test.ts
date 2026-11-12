import { sql } from "drizzle-orm";
import { Effect } from "effect";
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
	readVehicleUseSettings: vi.fn(),
	listVehicleUseAssignments: vi.fn(),
	saveVehicleUseSettings: vi.fn(),
	setVehicleUseAssignment: vi.fn(),
	removeVehicleUseAssignment: vi.fn(),
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

vi.mock("@/lib/time-tracking/vehicle-use/store", () => ({
	readVehicleUseSettings: mocks.readVehicleUseSettings,
	listVehicleUseAssignments: mocks.listVehicleUseAssignments,
	saveVehicleUseSettings: mocks.saveVehicleUseSettings,
	setVehicleUseAssignment: mocks.setVehicleUseAssignment,
	removeVehicleUseAssignment: mocks.removeVehicleUseAssignment,
}));

const { VehicleUseRefusal } = await import("@/lib/time-tracking/vehicle-use/errors");
const {
	getVehicleUseAdminDataAction,
	removeVehicleUseAssignmentAction,
	saveVehicleUseSettingsAction,
	setVehicleUseAssignmentAction,
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

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.notOnRoster = [];
	mocks.readVehicleUseSettings.mockResolvedValue({ enabled: false });
	mocks.listVehicleUseAssignments.mockResolvedValue([]);
	mocks.saveVehicleUseSettings.mockResolvedValue({ enabled: true });
	mocks.setVehicleUseAssignment.mockResolvedValue({ assignmentId: ASSIGNMENT_ID });
	mocks.removeVehicleUseAssignment.mockResolvedValue(undefined);
});

const refused = { success: false, code: "AuthorizationError" };

describe("vehicle use settings actions", () => {
	it("refuses a scoped manager everything", async () => {
		mocks.caller = scopedManager;

		expect(await getVehicleUseAdminDataAction()).toMatchObject(refused);
		expect(await saveVehicleUseSettingsAction({ enabled: true })).toMatchObject(refused);
		expect(
			await setVehicleUseAssignmentAction({ target: { type: "organization" }, mode: "asked" }),
		).toMatchObject(refused);
		expect(await removeVehicleUseAssignmentAction({ assignmentId: ASSIGNMENT_ID })).toMatchObject(
			refused,
		);
		expect(mocks.saveVehicleUseSettings).not.toHaveBeenCalled();
		expect(mocks.setVehicleUseAssignment).not.toHaveBeenCalled();
		expect(mocks.removeVehicleUseAssignment).not.toHaveBeenCalled();
	});

	it("loads the session organization's configuration for an org admin", async () => {
		const result = await getVehicleUseAdminDataAction();

		expect(result).toEqual({
			success: true,
			data: { settings: { enabled: false }, assignments: [], teams: [], employees: [] },
		});
		expect(mocks.readVehicleUseSettings).toHaveBeenCalledWith(fakeDb, "org-1");
	});

	it("saves the switch as the caller in the session organization", async () => {
		expect(await saveVehicleUseSettingsAction({ enabled: true })).toEqual({
			success: true,
			data: { enabled: true },
		});
		expect(mocks.saveVehicleUseSettings).toHaveBeenCalledWith(fakeDb, {
			organizationId: "org-1",
			actorUserId: "user-admin",
			settings: { enabled: true },
		});
	});

	it("sets a team assignment with the chosen mode", async () => {
		expect(
			await setVehicleUseAssignmentAction({
				target: { type: "team", teamId: TEAM_ID },
				mode: "expected",
			}),
		).toEqual({ success: true, data: { assignmentId: ASSIGNMENT_ID } });
		expect(mocks.setVehicleUseAssignment).toHaveBeenCalledWith(fakeDb, {
			organizationId: "org-1",
			actorUserId: "user-admin",
			target: { type: "team", teamId: TEAM_ID },
			mode: "expected",
		});
	});

	it("refuses an invalid target or mode before the store runs", async () => {
		expect(
			await setVehicleUseAssignmentAction({
				target: { type: "team", teamId: "not-a-uuid" },
				mode: "asked",
			}),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(
			await setVehicleUseAssignmentAction({
				target: { type: "organization" },
				mode: "sometimes" as never,
			}),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.setVehicleUseAssignment).not.toHaveBeenCalled();
	});

	it("leaves the roster rule to the store, so a former employee's existing assignment still switches", async () => {
		mocks.notOnRoster = [EMPLOYEE_ID];

		expect(
			await setVehicleUseAssignmentAction({
				target: { type: "employee", employeeId: EMPLOYEE_ID },
				mode: "asked",
			}),
		).toMatchObject({ success: true });
		expect(mocks.setVehicleUseAssignment).toHaveBeenCalled();
	});

	it("returns the store's refusal code", async () => {
		mocks.removeVehicleUseAssignment.mockRejectedValue(
			new VehicleUseRefusal("assignment_not_found", "Not found"),
		);

		expect(await removeVehicleUseAssignmentAction({ assignmentId: ASSIGNMENT_ID })).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "assignment_not_found",
		});
	});
});
