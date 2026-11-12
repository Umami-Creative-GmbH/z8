import { and, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";
import type { holidayTestDatabase } from "./holiday-database.test.mock";

const PRESET_ID = "00000000-0000-4000-8000-000000000001";
const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000002";
const TEAM_ID = "00000000-0000-4000-8000-000000000003";
const OTHER_CATEGORY_ID = "00000000-0000-4000-8000-000000000004";

function presetAssignment(
	id: string,
	assignmentType: "organization" | "team" | "employee",
	target: { teamId?: string; employeeId?: string } = {},
) {
	return {
		id,
		presetId: `preset-${id}`,
		assignmentType,
		teamId: target.teamId ?? null,
		employeeId: target.employeeId ?? null,
		priority: 0,
		effectiveFrom: null,
		effectiveUntil: null,
		isActive: true,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		preset: { id: `preset-${id}`, name: id, year: 2026, color: null, countryCode: "DE", stateCode: null },
		team: null,
		employee: null,
	};
}

const presetAssignments = [
	presetAssignment("preset-org", "organization"),
	presetAssignment("preset-team", "team", { teamId: "team-managed" }),
	presetAssignment("preset-employee", "employee", { employeeId: "employee-managed" }),
	presetAssignment("preset-other-team", "team", { teamId: "team-other" }),
];

const existingPreset = {
	id: PRESET_ID,
	organizationId: "org-1",
	name: "Existing preset",
	description: null,
	countryCode: "DE",
	stateCode: null,
	regionCode: null,
	year: null,
	color: null,
	isActive: true,
};

const harness = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	managedEmployeeIds: new Set<string>(),
	settingsTeamIds: [] as string[],
	formerEmployeeIds: new Set<string>(),
	database: null as unknown as ReturnType<typeof holidayTestDatabase>,
}));

vi.mock("@/lib/employee-lifecycle/current-roster-guard", async () =>
	(
		await import("@/lib/employee-lifecycle/testing/current-roster-guard.test.mock")
	).currentRosterGuardModule(() => harness.formerEmployeeIds),
);

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { holidayTestDatabase } = await import("./holiday-database.test.mock");
	harness.database = holidayTestDatabase({
		teamPermissions: {
			findMany: vi.fn(async () =>
				harness.settingsTeamIds.map((teamId) => ({ teamId, canManageTeamSettings: true })),
			),
		},
	});
	return runtimeModuleOver(
		organizationActionStubLayer(() => harness.caller, {
			db: harness.database.db,
			query: (name, fn) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([[...harness.managedEmployeeIds].map((id) => ({ id })), []]) as never)
					: Effect.promise(fn),
		}),
	);
});

const { assignmentRangesOverlap, buildPresetLocationConflictConditions } = await import(
	"./preset-scheduling"
);
const actions = await import("./preset-actions");

const dialect = new PgDialect();
function rendered(condition: SQL | undefined) {
	if (!condition) throw new Error("no condition");
	return dialect.sqlToQuery(condition);
}

const scopedManager: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	...scopedManager,
	employee: { id: "manager-1", role: "employee", former: false },
};
const orgAdmin: StubCaller = {
	...scopedManager,
	membershipRole: "admin",
	employee: { id: "admin-1", role: "admin", former: false },
};
const ownerWithoutEmployee: StubCaller = { ...scopedManager, membershipRole: "owner", employee: null };

const presetDetails = {
	name: "Bavaria",
	description: "",
	countryCode: "DE",
	stateCode: "BY",
	regionCode: "",
	color: "",
	isActive: true,
};

const presetHoliday = {
	name: "Holiday",
	description: "",
	month: 1,
	day: 1,
	durationDays: 1,
	holidayType: "public" as const,
	isFloating: false,
	floatingRule: null,
	isActive: true,
};

beforeEach(() => {
	vi.clearAllMocks();
	harness.database.reset();
	harness.caller = scopedManager;
	harness.managedEmployeeIds = new Set(["employee-managed"]);
	harness.settingsTeamIds = ["team-managed"];
	harness.formerEmployeeIds = new Set();
});

describe("holiday preset settings scope behavior", () => {
	it("refuses a holiday preset assignment for a former employee and checks current ones (#1438)", async () => {
		harness.caller = orgAdmin;
		const assign = () =>
			actions.createPresetAssignment({
				presetId: PRESET_ID,
				assignmentType: "employee",
				employeeId: EMPLOYEE_ID,
				isActive: true,
			});
		const { ensureOnCurrentRoster } = await import("@/lib/employee-lifecycle/current-roster-guard");

		harness.formerEmployeeIds = new Set([EMPLOYEE_ID]);
		expect(await assign()).toMatchObject({ success: false, refusal: "former_employee" });
		expect(harness.database.state.inserts).toHaveLength(0);

		harness.formerEmployeeIds = new Set();
		harness.database.state.selects = [[existingPreset], [{ id: EMPLOYEE_ID }], []];
		expect(await assign()).toMatchObject({ success: true });
		expect(ensureOnCurrentRoster).toHaveBeenLastCalledWith(
			expect.anything(),
			expect.objectContaining({ organizationId: "org-1", employeeIds: [EMPLOYEE_ID] }),
		);
		expect(harness.database.state.inserts).toEqual([
			expect.objectContaining({ organizationId: "org-1", employeeId: EMPLOYEE_ID, priority: 2 }),
		]);
	});

	it("lets managers read only organization, managed-team, and managed-employee preset assignments", async () => {
		harness.database.state.selects = [presetAssignments];

		const result = await actions.getPresetAssignments();

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.map((assignment) => assignment.id)).toEqual([
				"preset-org",
				"preset-team",
				"preset-employee",
			]);
			expect(result.data[0]?.preset.year).toBe(2026);
		}
	});

	it("lets owners create holiday presets with org-admin parity even without an employee row", async () => {
		harness.caller = ownerWithoutEmployee;
		harness.database.state.selects = [[]];

		const result = await actions.createHolidayPreset(presetDetails);

		expect(result.success).toBe(true);
		expect(harness.database.state.inserts).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				name: "Bavaria",
				countryCode: "DE",
				stateCode: "BY",
				regionCode: null,
				color: null,
				createdBy: "user-1",
			}),
		]);
	});

	it("refuses a preset at a location that already has one", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[{ id: "preset-elsewhere" }]];

		const result = await actions.createHolidayPreset(presetDetails);

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		expect(harness.database.state.inserts).toHaveLength(0);
	});

	it("rejects managers reading holiday presets outside their holiday assignment scope", async () => {
		harness.database.state.selects = [
			[existingPreset],
			[presetAssignment("preset-other-team", "team", { teamId: "team-other" })],
		];

		const result = await actions.getHolidayPreset(PRESET_ID);

		expect(result).toMatchObject({ success: false, error: "Preset not found" });
	});

	it("lets owners read holiday presets with org-admin parity even without an employee row", async () => {
		harness.caller = ownerWithoutEmployee;
		harness.database.state.selects = [[existingPreset], []];

		const result = await actions.getHolidayPreset(PRESET_ID);

		expect(result).toEqual({ success: true, data: { preset: existingPreset, holidays: [] } });
	});

	it("reads another organization's preset as not found", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[]];

		await expect(actions.getHolidayPreset(PRESET_ID)).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("persists the preset year when updating preset details", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[existingPreset], []];

		const result = await actions.updateHolidayPreset({
			presetId: PRESET_ID,
			data: { ...presetDetails, name: "Existing preset", stateCode: "", year: 2027 },
		});

		expect(result.success).toBe(true);
		expect(harness.database.state.updates[0]).toEqual(expect.objectContaining({ year: 2027 }));
	});

	it("deletes preset assignments only in the active organization", async () => {
		harness.caller = orgAdmin;
		harness.database.state.updateReturn = [{ id: "assignment-1" }];

		const result = await actions.deletePresetAssignment("assignment-1");

		expect(result.success).toBe(true);
		expect(rendered(harness.database.state.updateConditions[0] as SQL).params).toEqual(
			expect.arrayContaining(["assignment-1", "org-1"]),
		);
	});

	it("verifies preset holiday ownership before deleting", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[]];

		await expect(actions.deleteHolidayFromPreset("holiday-1")).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(harness.database.state.deletes).toBe(0);

		harness.database.state.selects = [[{ id: "holiday-1" }]];

		await expect(actions.deleteHolidayFromPreset("holiday-1")).resolves.toMatchObject({
			success: true,
		});
		expect(harness.database.state.deletes).toBe(1);
	});

	it("hard deletes holiday presets instead of only marking them inactive", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[existingPreset]];
		harness.database.state.deleteReturn = [{ id: PRESET_ID }];

		const result = await actions.deleteHolidayPreset(PRESET_ID);

		expect(result.success).toBe(true);
		expect(harness.database.state.deletes).toBe(1);
		expect(harness.database.state.updates).toHaveLength(0);
	});

	it("rejects adding preset holidays with a category from another organization", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[existingPreset], []];

		const result = await actions.addHolidayToPreset({
			presetId: PRESET_ID,
			data: { ...presetHoliday, categoryId: OTHER_CATEGORY_ID },
		});

		expect(result).toMatchObject({ success: false, error: "Holiday category not found" });
		expect(harness.database.state.inserts).toHaveLength(0);
	});

	it("rejects bulk adding preset holidays with a category from another organization", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[existingPreset], []];

		const result = await actions.bulkAddHolidaysToPreset({
			presetId: PRESET_ID,
			holidays: [presetHoliday],
			categoryId: OTHER_CATEGORY_ID,
		});

		expect(result).toMatchObject({ success: false, error: "Holiday category not found" });
		expect(harness.database.state.inserts).toHaveLength(0);
	});

	it("bulk adds preset holidays", async () => {
		harness.caller = orgAdmin;
		harness.database.state.selects = [[existingPreset]];

		const result = await actions.bulkAddHolidaysToPreset({
			presetId: PRESET_ID,
			holidays: [presetHoliday, { ...presetHoliday, name: "Second", day: 2 }],
		});

		expect(result).toEqual({ success: true, data: { added: 2 } });
	});
});

describe("holiday preset settings access", () => {
	it.each([
		["getHolidayPresets", () => actions.getHolidayPresets()],
		["getHolidayPreset", () => actions.getHolidayPreset(PRESET_ID)],
		["getPresetAssignments", () => actions.getPresetAssignments()],
		["getTeamsForAssignment", () => actions.getTeamsForAssignment()],
		["getEmployeesForAssignment", () => actions.getEmployeesForAssignment()],
	])("refuses %s to an org member", async (_name, call) => {
		harness.caller = orgMember;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it.each([
		["createHolidayPreset", () => actions.createHolidayPreset(presetDetails)],
		[
			"updateHolidayPreset",
			() => actions.updateHolidayPreset({ presetId: PRESET_ID, data: presetDetails }),
		],
		["deleteHolidayPreset", () => actions.deleteHolidayPreset(PRESET_ID)],
		["addHolidayToPreset", () => actions.addHolidayToPreset({ presetId: PRESET_ID, data: presetHoliday })],
		[
			"bulkAddHolidaysToPreset",
			() => actions.bulkAddHolidaysToPreset({ presetId: PRESET_ID, holidays: [presetHoliday] }),
		],
		["deleteHolidayFromPreset", () => actions.deleteHolidayFromPreset("holiday-1")],
		[
			"createPresetAssignment",
			() =>
				actions.createPresetAssignment({
					presetId: PRESET_ID,
					assignmentType: "team",
					teamId: TEAM_ID,
				}),
		],
		["deletePresetAssignment", () => actions.deletePresetAssignment("assignment-1")],
	])("refuses %s to a scoped manager", async (_name, call) => {
		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(harness.database.state.inserts).toEqual([]);
		expect(harness.database.state.updates).toEqual([]);
		expect(harness.database.state.deletes).toBe(0);
	});
});

describe("holiday preset scheduling behavior", () => {
	it("treats adjacent calendar-year assignment ranges as non-overlapping", () => {
		expect(
			assignmentRangesOverlap(
				new Date("2026-01-01T00:00:00.000Z"),
				new Date("2026-12-31T23:59:59.999Z"),
				new Date("2027-01-01T00:00:00.000Z"),
				new Date("2027-12-31T23:59:59.999Z"),
			),
		).toBe(false);
	});

	it("treats overlapping assignment ranges as overlapping", () => {
		expect(
			assignmentRangesOverlap(
				new Date("2026-01-01T00:00:00.000Z"),
				new Date("2026-12-31T23:59:59.999Z"),
				new Date("2026-06-01T00:00:00.000Z"),
				new Date("2027-05-31T23:59:59.999Z"),
			),
		).toBe(true);
	});

	it("treats open-ended ranges as unbounded", () => {
		expect(
			assignmentRangesOverlap(
				new Date("2026-01-01T00:00:00.000Z"),
				null,
				new Date("2027-01-01T00:00:00.000Z"),
				new Date("2027-12-31T23:59:59.999Z"),
			),
		).toBe(true);
	});

	it("includes year in imported preset location conflict checks", () => {
		const conditions = buildPresetLocationConflictConditions("org-1", {
			countryCode: "DE",
			stateCode: "BY",
			regionCode: undefined,
			year: 2027,
		});

		expect(conditions).toHaveLength(5);
		const query = rendered(and(...conditions));
		expect(query.sql).toContain('"year" = $');
		expect(query.params).toContain(2027);
	});

	it("excludes the current preset from update location conflict checks", () => {
		const conditions = buildPresetLocationConflictConditions(
			"org-1",
			{ countryCode: "DE", stateCode: "BY", regionCode: undefined, year: 2027 },
			{ excludePresetId: "preset-current" },
		);

		const query = rendered(and(...conditions));
		expect(query.sql).toContain('"id" <> $');
		expect(query.params).toContain("preset-current");
	});
});
