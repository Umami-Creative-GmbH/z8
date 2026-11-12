import { desc, type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { workPolicyAssignment } from "@/db/schema";
import type { StubCaller } from "@/test/organization-action";

// biome-ignore lint/suspicious/noExplicitAny: loose row stand-ins for a mocked database
type Row = any;

const state = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	managedEmployeeIds: new Set<string>(),
	workPolicies: [] as Row[],
	workPolicyQueue: [] as Row[],
	workPolicyPresets: [] as Row[],
	workPolicyPresetQueue: [] as Row[],
	workPolicyPresetFindFirstArgs: [] as Row[],
	assignmentQueue: [] as Row[],
	employeeQueue: [] as Row[],
	teamQueue: [] as Row[],
	assignmentFindFirstArgs: [] as Row[],
	violationRows: [] as Row[],
	insertQueue: [] as Row[],
	insertValues: [] as Row[],
	selectQueue: [] as Row[],
	updateSets: [] as Row[],
	updateWhereArgs: [] as Row[],
	markOrganizationWorkBalancesDirty: vi.fn(),
	formerEmployeeIds: new Set<string>(),
}));

vi.mock("@/lib/employee-lifecycle/current-roster-guard", async () =>
	(
		await import("@/lib/employee-lifecycle/testing/current-roster-guard.test.mock")
	).currentRosterGuardModule(() => state.formerEmployeeIds),
);

vi.mock("@/lib/work-balance/service", () => ({
	markOrganizationWorkBalancesDirty: state.markOrganizationWorkBalancesDirty,
}));

vi.mock("@/lib/datetime/drizzle-adapter", () => ({
	currentTimestamp: () => new Date("2026-01-01T00:00:00.000Z"),
}));

const db = {
	query: {
		workPolicy: {
			findMany: vi.fn(async () => state.workPolicies),
			findFirst: vi.fn(async () => state.workPolicyQueue.shift() ?? null),
		},
		workPolicyViolation: { findMany: vi.fn(async () => state.violationRows) },
		workPolicyPreset: {
			findFirst: vi.fn(async (input: Row) => {
				state.workPolicyPresetFindFirstArgs.push(input);
				return state.workPolicyPresetQueue.shift() ?? null;
			}),
			findMany: vi.fn(async () => state.workPolicyPresets),
		},
		team: {
			findMany: vi.fn(async () => []),
			findFirst: vi.fn(async () => state.teamQueue.shift() ?? null),
		},
		workPolicyAssignment: {
			findMany: vi.fn(async () => []),
			findFirst: vi.fn(async (input: Row) => {
				state.assignmentFindFirstArgs.push(input);
				return state.assignmentQueue.shift() ?? null;
			}),
		},
		employee: { findFirst: vi.fn(async () => state.employeeQueue.shift() ?? null) },
	},
	select: vi.fn(() => ({
		from: vi.fn(() => ({
			where: vi.fn(() => ({ limit: vi.fn(async () => state.selectQueue.shift() ?? []) })),
		})),
	})),
	insert: vi.fn(() => ({
		values: vi.fn((input: unknown) => {
			state.insertValues.push(input);
			return { returning: vi.fn(async () => state.insertQueue.shift() ?? []) };
		}),
	})),
	update: vi.fn(() => ({
		set: vi.fn((input: unknown) => {
			state.updateSets.push(input);
			return {
				where: vi.fn(async (input: unknown) => {
					state.updateWhereArgs.push(input);
				}),
			};
		}),
	})),
	delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
};

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => state.caller, {
			db,
			query: (name, fn) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([[...state.managedEmployeeIds].map((id) => ({ id })), []]) as never)
					: Effect.promise(fn),
		}),
	);
});

const actions = await import("./actions");

const dialect = new PgDialect();
function rendered(where: SQL) {
	return dialect.sqlToQuery(where);
}

const scopedManager: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-employee-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	...scopedManager,
	employee: { id: "manager-employee-1", role: "employee", former: false },
};
const orgAdmin: StubCaller = {
	...scopedManager,
	membershipRole: "admin",
	employee: { id: "actor-employee-1", role: "admin", former: false },
};

const presetInput = {
	name: "Warehouse",
	description: "Warehouse hours",
	scheduleEnabled: true,
	regulationEnabled: false,
	schedule: { scheduleCycle: "weekly" as const, workingDaysPreset: "weekdays" as const, hoursPerCycle: "40" },
};

const policyInput = {
	name: "Night Shift",
	description: "Overnight coverage",
	scheduleEnabled: true,
	regulationEnabled: false,
	presenceEnabled: false,
	schedule: {
		scheduleCycle: "weekly" as const,
		scheduleType: "simple" as const,
		workingDaysPreset: "weekdays" as const,
		hoursPerCycle: "40",
	},
};

const period = {
	startDate: new Date("2026-01-01T00:00:00.000Z"),
	endDate: new Date("2026-01-31T00:00:00.000Z"),
};

describe("work policy settings scope actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.caller = scopedManager;
		state.managedEmployeeIds = new Set(["employee-1"]);
		state.workPolicies = [{ id: "policy-1", organizationId: "org-1", name: "Standard", isActive: true }];
		state.workPolicyQueue = [];
		state.workPolicyPresets = [];
		state.workPolicyPresetQueue = [];
		state.workPolicyPresetFindFirstArgs = [];
		state.assignmentQueue = [];
		state.employeeQueue = [];
		state.teamQueue = [];
		state.assignmentFindFirstArgs = [];
		state.violationRows = [{ id: "violation-1", organizationId: "org-1" }];
		state.insertQueue = [];
		state.insertValues = [];
		state.selectQueue = [];
		state.updateSets = [];
		state.updateWhereArgs = [];
		state.markOrganizationWorkBalancesDirty.mockResolvedValue(undefined);
		state.formerEmployeeIds = new Set();
	});

	it("refuses assigning a work policy to a former employee (#1438)", async () => {
		state.formerEmployeeIds = new Set(["employee-1"]);
		state.selectQueue = [[{ id: "employee-1" }]];
		state.workPolicyQueue = [{ id: "policy-1" }];
		state.insertQueue = [[{ id: "assignment-1" }]];

		const result = await actions.createWorkPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-1",
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError", refusal: "former_employee" });
		expect(state.insertValues).toHaveLength(0);
	});

	it("lets managers read work policy definitions", async () => {
		const result = await actions.getWorkPolicies();

		expect(result).toEqual({ success: true, data: state.workPolicies });
	});

	it("returns active system and organization work policy presets with source labels", async () => {
		state.workPolicyPresets = [
			{ id: "system-preset", organizationId: null, name: "EU Standard", isActive: true },
			{ id: "custom-preset", organizationId: "org-1", name: "Warehouse", isActive: true },
		];

		const result = await actions.getWorkPolicyPresets();

		expect(result).toEqual({
			success: true,
			data: [
				{
					id: "system-preset",
					organizationId: null,
					name: "EU Standard",
					isActive: true,
					source: "system",
					sourceLabel: "System",
				},
				{
					id: "custom-preset",
					organizationId: "org-1",
					name: "Warehouse",
					isActive: true,
					source: "custom",
					sourceLabel: "Custom",
				},
			],
		});
	});

	it("rejects non-admin custom work policy preset creation", async () => {
		const result = await actions.createWorkPolicyPreset(presetInput);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(state.insertValues).toHaveLength(0);
	});

	it("rejects archiving system work policy presets", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "EU Standard", isActive: true },
		];

		const result = await actions.archiveWorkPolicyPreset("system-preset");

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(state.updateSets).toHaveLength(0);
	});

	it("rejects archiving and updating other-organization work policy presets", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{ id: "other-preset", organizationId: "org-2", name: "Other", isActive: true },
			{ id: "other-preset", organizationId: "org-2", name: "Other", isActive: true },
		];

		const archiveResult = await actions.archiveWorkPolicyPreset("other-preset");
		const updateResult = await actions.updateWorkPolicyPreset({
			presetId: "other-preset",
			input: { ...presetInput, name: "Updated Other" },
		});

		expect(archiveResult).toMatchObject({ success: false, code: "NotFoundError" });
		expect(updateResult).toMatchObject({ success: false, code: "NotFoundError" });
		expect(state.updateSets).toHaveLength(0);
	});

	it("returns a conflict for duplicate active organization work policy preset names", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{ id: "existing-preset", organizationId: "org-1", name: "Warehouse", isActive: true },
		];

		const result = await actions.createWorkPolicyPreset({ ...presetInput, name: " Warehouse " });

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		expect(state.insertValues).toHaveLength(0);
	});

	it("checks duplicate organization preset names against inactive archived presets when creating", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{ id: "archived-preset", organizationId: "org-1", name: "Warehouse", isActive: false },
		];

		const result = await actions.createWorkPolicyPreset(presetInput);

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		expect(rendered(state.workPolicyPresetFindFirstArgs[0].where).sql).not.toContain("is_active");
		expect(state.insertValues).toHaveLength(0);
	});

	it("checks duplicate organization preset names against inactive archived presets when copying system presets", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "System Source", isActive: true },
			{ id: "archived-preset", organizationId: "org-1", name: "Warehouse", isActive: false },
		];

		const result = await actions.copySystemWorkPolicyPreset({
			presetId: "system-preset",
			input: presetInput,
		});

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		const sourceLookup = rendered(state.workPolicyPresetFindFirstArgs[0].where).sql;
		expect(sourceLookup).toContain("is_active");
		expect(sourceLookup).toContain("is null");
		expect(rendered(state.workPolicyPresetFindFirstArgs[1].where).sql).not.toContain("is_active");
		expect(state.insertValues).toHaveLength(0);
	});

	it("checks duplicate organization preset names against inactive archived presets when updating", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{ id: "custom-preset", organizationId: "org-1", name: "Current", isActive: true },
			{ id: "archived-preset", organizationId: "org-1", name: "Warehouse", isActive: false },
		];

		const result = await actions.updateWorkPolicyPreset({
			presetId: "custom-preset",
			input: presetInput,
		});

		expect(result).toMatchObject({ success: false, code: "ConflictError" });
		expect(rendered(state.workPolicyPresetFindFirstArgs[0].where).params).toContain("org-1");
		expect(rendered(state.workPolicyPresetFindFirstArgs[1].where).sql).not.toContain("is_active");
		expect(state.updateSets).toHaveLength(0);
	});

	it("scopes custom preset update and archive lookups to the current organization", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [null, null];

		await actions.updateWorkPolicyPreset({ presetId: "missing-preset", input: presetInput });
		await actions.archiveWorkPolicyPreset("missing-preset");

		for (const lookup of state.workPolicyPresetFindFirstArgs) {
			expect(rendered(lookup.where).params).toEqual(
				expect.arrayContaining(["org-1", "missing-preset"]),
			);
		}
		expect(state.workPolicyPresetFindFirstArgs).toHaveLength(2);
	});

	it("rejects archived custom preset updates without reactivating them", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [null];

		const result = await actions.updateWorkPolicyPreset({
			presetId: "archived-preset",
			input: { ...presetInput, name: "Reactivated Warehouse" },
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(rendered(state.workPolicyPresetFindFirstArgs[0].where).sql).toContain("is_active");
		expect(state.updateSets).toHaveLength(0);
	});

	it("scopes compatibility import preset lookup to active visible presets", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [null];

		const result = await actions.importWorkPolicyPreset({ presetId: "missing-preset" });

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		const lookup = rendered(state.workPolicyPresetFindFirstArgs[0].where);
		expect(lookup.params).toEqual(expect.arrayContaining(["missing-preset", "org-1"]));
		expect(lookup.sql).toContain("is_active");
		expect(lookup.sql).toContain("is null");
	});

	it("creates a real work policy from reviewed preset input and marks balances dirty", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "Source", isActive: true },
		];
		const created = {
			id: "policy-from-preset",
			organizationId: "org-1",
			name: "Reviewed Policy",
			schedule: null,
			regulation: null,
			presence: null,
		};
		state.workPolicyQueue = [null, created];
		state.insertQueue = [[{ id: "policy-from-preset" }], [{ id: "regulation-1" }], [{ id: "break-rule-1" }]];

		const result = await actions.createWorkPolicyFromPreset({
			presetId: "system-preset",
			input: {
				name: " Reviewed Policy ",
				description: " Reviewed description ",
				scheduleEnabled: false,
				regulationEnabled: true,
				regulation: {
					maxDailyMinutes: 480,
					maxWeeklyMinutes: 2400,
					breakRules: [{ workingMinutesThreshold: 360, requiredBreakMinutes: 30, options: [] }],
				},
			},
		});

		expect(result).toEqual({ success: true, data: created });
		expect(state.insertValues[0]).toMatchObject({
			organizationId: "org-1",
			name: "Reviewed Policy",
			description: "Reviewed description",
		});
		expect(state.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({ organizationId: "org-1" });
	});

	it("rejects malformed reviewed preset break option data", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "Source", isActive: true },
		];

		const result = await actions.createWorkPolicyFromPreset({
			presetId: "system-preset",
			input: {
				name: "Reviewed Policy",
				scheduleEnabled: false,
				regulationEnabled: true,
				regulation: {
					breakRules: [
						{
							workingMinutesThreshold: 360,
							requiredBreakMinutes: 30,
							options: [
								{
									splitCount: "one" as never,
									minimumSplitMinutes: null,
									minimumLongestSplitMinutes: null,
								},
							],
						},
					],
				},
			},
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(state.insertValues).toHaveLength(0);
	});

	it("rejects malformed persisted preset break rules during compatibility import", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{
				id: "system-preset",
				organizationId: null,
				name: "System Source",
				isActive: true,
				breakRulesJson: "not-json",
			},
		];

		const result = await actions.importWorkPolicyPreset({ presetId: "system-preset" });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(state.insertValues).toHaveLength(0);
	});

	it("rejects malformed persisted preset break option data when using a preset", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{
				id: "system-preset",
				organizationId: null,
				name: "System Source",
				isActive: true,
				breakRulesJson: {
					rules: [
						{ workingMinutesThreshold: 360, requiredBreakMinutes: 30, options: [{ splitCount: "one" }] },
					],
				},
			},
		];

		const result = await actions.importWorkPolicyPreset({ presetId: "system-preset" });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(state.insertValues).toHaveLength(0);
	});

	it("copies system presets using reviewed input into organization-owned presets", async () => {
		state.caller = orgAdmin;
		state.workPolicyPresetQueue = [
			{ id: "system-preset", organizationId: null, name: "System Source", isActive: true },
			null,
		];
		state.insertQueue = [[{ id: "custom-preset", organizationId: "org-1", name: "Reviewed Copy" }]];

		const result = await actions.copySystemWorkPolicyPreset({
			presetId: "system-preset",
			input: {
				name: " Reviewed Copy ",
				description: " Reviewed custom preset ",
				scheduleEnabled: true,
				regulationEnabled: true,
				schedule: { scheduleCycle: "weekly", workingDaysPreset: "weekdays", hoursPerCycle: "38" },
				regulation: { maxDailyMinutes: 480, maxUninterruptedMinutes: 360, breakRules: [] },
			},
		});

		expect(result).toEqual({
			success: true,
			data: { id: "custom-preset", organizationId: "org-1", name: "Reviewed Copy" },
		});
		expect(state.insertValues[0]).toMatchObject({
			organizationId: "org-1",
			name: "Reviewed Copy",
			description: "Reviewed custom preset",
			scheduleCycle: "weekly",
			workingDaysPreset: "weekdays",
			hoursPerCycle: "38",
			maxDailyMinutes: 480,
			maxUninterruptedMinutes: 360,
		});
		expect(state.markOrganizationWorkBalancesDirty).not.toHaveBeenCalled();
	});

	it("rejects managers when mutating work policy definitions", async () => {
		const result = await actions.createWorkPolicy(policyInput);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("lets managers assign work policies to managed members and marks balances dirty", async () => {
		state.selectQueue = [[{ id: "employee-1" }]];
		state.workPolicyQueue = [{ id: "policy-1" }];
		state.insertQueue = [[{ id: "assignment-1" }]];

		const result = await actions.createWorkPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-1",
		});

		expect(result).toEqual({ success: true, data: { id: "assignment-1" } });
		expect(state.insertValues[0]).toMatchObject({ organizationId: "org-1", createdBy: "user-1" });
		expect(state.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({ organizationId: "org-1" });
	});

	it("refuses a manager an organization-wide assignment", async () => {
		const result = await actions.createWorkPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "organization",
		});

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(state.insertValues).toHaveLength(0);
	});

	it("marks organization work balances dirty after deleting a work policy assignment", async () => {
		state.assignmentQueue = [
			{ id: "assignment-1", organizationId: "org-1", assignmentType: "employee", employeeId: "employee-1" },
		];

		const result = await actions.deleteWorkPolicyAssignment("assignment-1");

		expect(result).toEqual({ success: true, data: undefined });
		expect(state.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({ organizationId: "org-1" });
	});

	it("marks organization work balances dirty after schedule-affecting work policy updates", async () => {
		state.caller = orgAdmin;
		state.workPolicyQueue = [
			{
				id: "policy-1",
				organizationId: "org-1",
				name: "Standard",
				description: null,
				scheduleEnabled: true,
				regulationEnabled: false,
				presenceEnabled: false,
				schedule: null,
				regulation: null,
				presence: null,
			},
			{ id: "policy-1", organizationId: "org-1", name: "Standard", schedule: null },
		];

		const result = await actions.updateWorkPolicy({
			policyId: "policy-1",
			data: { scheduleEnabled: false },
		});

		expect(result).toMatchObject({ success: true });
		expect(state.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({ organizationId: "org-1" });
	});

	describe("latest clock-in on detailed schedule days", () => {
		const existing = {
			id: "policy-1",
			organizationId: "org-1",
			name: "Standard",
			description: null,
			scheduleEnabled: true,
			regulationEnabled: false,
			presenceEnabled: false,
			schedule: null,
			regulation: null,
			presence: null,
		};
		const day = (
			dayOfWeek: "monday" | "tuesday" | "saturday",
			isWorkDay: boolean,
			latestClockIn: string | null,
		) => ({ dayOfWeek, hoursPerDay: isWorkDay ? "8" : "0", isWorkDay, latestClockIn });
		const saveDays = (days: ReturnType<typeof day>[]) =>
			actions.updateWorkPolicy({
				policyId: "policy-1",
				data: {
					schedule: {
						scheduleCycle: "weekly",
						scheduleType: "detailed",
						workingDaysPreset: "custom",
						days,
					},
				},
			});
		const storedDays = () =>
			state.insertValues.find(Array.isArray) as Array<{ dayOfWeek: string; latestClockIn: string | null }>;

		beforeEach(() => {
			state.caller = orgAdmin;
			state.workPolicyQueue = [existing, { ...existing, schedule: null }];
			state.insertQueue = [[{ id: "schedule-1" }]];
		});

		it("stores a latest clock-in on work days and clears it on others", async () => {
			const result = await saveDays([
				day("monday", true, "09:00"),
				day("tuesday", true, null),
				day("saturday", false, "09:00"),
			]);

			expect(result).toMatchObject({ success: true });
			expect(Object.fromEntries(storedDays().map((row) => [row.dayOfWeek, row.latestClockIn]))).toEqual({
				monday: "09:00",
				tuesday: null,
				saturday: null,
			});
		});

		it("rejects a latest clock-in that is not a HH:mm time", async () => {
			const result = await saveDays([day("monday", true, "9am")]);

			expect(result).toMatchObject({ success: false, code: "ValidationError" });
			expect(state.insertValues).toHaveLength(0);
		});
	});

	it("marks organization work balances dirty after deleting a work policy", async () => {
		state.caller = orgAdmin;
		state.workPolicyQueue = [{ id: "policy-1", organizationId: "org-1" }];

		const result = await actions.deleteWorkPolicy("policy-1");

		expect(result).toEqual({ success: true, data: undefined });
		expect(state.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({ organizationId: "org-1" });
	});

	it("marks organization work balances dirty after changing the default work policy", async () => {
		state.caller = orgAdmin;
		state.workPolicyQueue = [{ id: "policy-1", organizationId: "org-1" }];

		const result = await actions.setDefaultWorkPolicy("policy-1");

		expect(result).toEqual({ success: true, data: undefined });
		expect(state.markOrganizationWorkBalancesDirty).toHaveBeenCalledWith({ organizationId: "org-1" });
	});

	it("reads another organization's policy as not found", async () => {
		state.caller = orgAdmin;
		state.workPolicyQueue = [null];

		await expect(actions.deleteWorkPolicy("policy-elsewhere")).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(state.updateSets).toHaveLength(0);
	});

	it("rejects manager work policy assignment for unmanaged members", async () => {
		state.selectQueue = [[{ id: "employee-2" }]];
		state.workPolicyQueue = [{ id: "policy-1" }];

		const result = await actions.createWorkPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-2",
		});

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(state.insertValues).toHaveLength(0);
	});

	it("rejects work policy team assignments outside the actor organization", async () => {
		state.caller = orgAdmin;
		state.workPolicyQueue = [{ id: "policy-1" }];
		state.teamQueue = [null];

		const result = await actions.createWorkPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "team",
			teamId: "team-outside-org",
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
	});

	it("rejects malformed work policy assignment payloads when required target ids are missing or conflicting", async () => {
		state.caller = orgAdmin;

		const missingTeamId = await actions.createWorkPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "team",
		});
		const missingEmployeeId = await actions.createWorkPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "employee",
		});
		const conflictingIds = await actions.createWorkPolicyAssignment({
			policyId: "policy-1",
			assignmentType: "employee",
			employeeId: "employee-1",
			teamId: "team-1",
		});

		expect(missingTeamId).toMatchObject({ success: false, code: "ValidationError" });
		expect(missingEmployeeId).toMatchObject({ success: false, code: "ValidationError" });
		expect(conflictingIds).toMatchObject({ success: false, code: "ValidationError" });
	});

	it("looks up effective assignments using date predicates and null effective dates as fallback", async () => {
		state.employeeQueue = [{ id: "employee-1", organizationId: "org-1", teamId: "team-1", team: null }];

		const result = await actions.getEmployeeEffectiveScheduleDetails("employee-1");

		expect(result).toEqual({ success: true, data: null });
		expect(state.assignmentFindFirstArgs).toHaveLength(3);
		for (const assignmentLookup of state.assignmentFindFirstArgs) {
			const where = rendered(assignmentLookup.where).sql;
			expect(where).toContain("effective_from");
			expect(where).toContain("effective_until");
			const orderBy = rendered(
				sql.join(assignmentLookup.orderBy(workPolicyAssignment, { desc }), sql`, `),
			).sql;
			expect(orderBy).toContain("DESC NULLS LAST");
		}
	});

	it("reads an employee outside the active organization as not found", async () => {
		state.managedEmployeeIds = new Set(["employee-outside-org"]);
		state.employeeQueue = [null];

		const result = await actions.getEmployeeEffectiveScheduleDetails("employee-outside-org");

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(state.assignmentFindFirstArgs).toHaveLength(0);
	});

	it("refuses a manager the schedule of an employee they do not manage", async () => {
		state.employeeQueue = [{ id: "employee-2", organizationId: "org-1", teamId: null, team: null }];

		const result = await actions.getEmployeeEffectiveScheduleDetails("employee-2");

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(state.assignmentFindFirstArgs).toHaveLength(0);
	});

	it("rejects managers from hidden compliance actions", async () => {
		const result = await actions.getWorkPolicyViolations(period);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it("acknowledges violations with the actor employee scoped to the active organization", async () => {
		state.caller = orgAdmin;

		const result = await actions.acknowledgeWorkPolicyViolation({
			violationId: "violation-1",
			note: "Reviewed",
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(state.updateSets[0]).toMatchObject({ acknowledgedBy: "actor-employee-1" });
		expect(rendered(state.updateWhereArgs[0]).params).toEqual(
			expect.arrayContaining(["org-1", "violation-1"]),
		);
	});

	it("needs an employee record to acknowledge a violation", async () => {
		state.caller = { ...orgAdmin, membershipRole: "owner", employee: null };

		const result = await actions.acknowledgeWorkPolicyViolation({ violationId: "violation-1" });

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(state.updateSets).toHaveLength(0);
	});
});

describe("work policy settings access", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.insertValues = [];
		state.updateSets = [];
	});

	it.each([
		["getWorkPolicies", () => actions.getWorkPolicies()],
		["getWorkPolicy", () => actions.getWorkPolicy("policy-1")],
		["getWorkPolicyAssignments", () => actions.getWorkPolicyAssignments()],
		[
			"createWorkPolicyAssignment",
			() =>
				actions.createWorkPolicyAssignment({
					policyId: "policy-1",
					assignmentType: "employee",
					employeeId: "employee-1",
				}),
		],
		["deleteWorkPolicyAssignment", () => actions.deleteWorkPolicyAssignment("assignment-1")],
		["getWorkPolicyPresets", () => actions.getWorkPolicyPresets()],
		["getEmployeeEffectiveScheduleDetails", () => actions.getEmployeeEffectiveScheduleDetails("employee-1")],
		["getTeamsForAssignment", () => actions.getTeamsForAssignment()],
		["getEmployeesForAssignment", () => actions.getEmployeesForAssignment()],
	])("refuses %s to an org member", async (_name, call) => {
		state.caller = orgMember;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
	});

	it.each([
		["createWorkPolicy", () => actions.createWorkPolicy(policyInput)],
		["updateWorkPolicy", () => actions.updateWorkPolicy({ policyId: "policy-1", data: { name: "X" } })],
		["deleteWorkPolicy", () => actions.deleteWorkPolicy("policy-1")],
		["setDefaultWorkPolicy", () => actions.setDefaultWorkPolicy("policy-1")],
		["duplicateWorkPolicy", () => actions.duplicateWorkPolicy("policy-1")],
		["getWorkPolicyViolations", () => actions.getWorkPolicyViolations(period)],
		[
			"acknowledgeWorkPolicyViolation",
			() => actions.acknowledgeWorkPolicyViolation({ violationId: "violation-1" }),
		],
		["createWorkPolicyPreset", () => actions.createWorkPolicyPreset(presetInput)],
		[
			"updateWorkPolicyPreset",
			() => actions.updateWorkPolicyPreset({ presetId: "preset-1", input: presetInput }),
		],
		["archiveWorkPolicyPreset", () => actions.archiveWorkPolicyPreset("preset-1")],
		[
			"copySystemWorkPolicyPreset",
			() => actions.copySystemWorkPolicyPreset({ presetId: "preset-1", input: presetInput }),
		],
		[
			"createWorkPolicyFromPreset",
			() => actions.createWorkPolicyFromPreset({ presetId: "preset-1", input: presetInput }),
		],
		["importWorkPolicyPreset", () => actions.importWorkPolicyPreset({ presetId: "preset-1" })],
	])("refuses %s to a scoped manager", async (_name, call) => {
		state.caller = scopedManager;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(state.insertValues).toHaveLength(0);
		expect(state.updateSets).toHaveLength(0);
	});
});
