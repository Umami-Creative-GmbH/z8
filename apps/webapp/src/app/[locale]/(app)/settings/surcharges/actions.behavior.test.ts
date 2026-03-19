import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	settingsActorAccessTier: "manager" as "manager" | "orgAdmin",
	membershipRole: "member" as "member" | "admin" | "owner",
	authContext: {
		user: { id: "user-1" },
		session: { activeOrganizationId: "org-1" },
		employee: {
			id: "manager-1",
			organizationId: "org-1",
			role: "manager" as const,
			teamId: "team-managed",
		},
	},
	teamPermissionsRows: [{ teamId: "team-managed", canManageTeamSettings: true }],
	locationAssignments: [{ locationId: "location-managed" }],
	subareaAssignments: [{ subareaId: "subarea-managed" }],
	projectManagers: [{ projectId: "project-managed" }],
	managedEmployees: [{ id: "employee-managed" }],
	calculationEmployees: [{ id: "employee-managed", firstName: "Mina", lastName: "Miller" }],
	surchargeModels: [
		{
			id: "model-org",
			organizationId: "org-1",
			name: "Organization Default",
			description: null,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
			updatedBy: null,
			rules: [],
		},
		{
			id: "model-team",
			organizationId: "org-1",
			name: "Managed Team",
			description: null,
			isActive: true,
			createdAt: new Date("2026-01-02T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-02T00:00:00.000Z"),
			updatedBy: null,
			rules: [],
		},
		{
			id: "model-area",
			organizationId: "org-1",
			name: "Managed Area",
			description: null,
			isActive: true,
			createdAt: new Date("2026-01-03T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-03T00:00:00.000Z"),
			updatedBy: null,
			rules: [],
		},
		{
			id: "model-project",
			organizationId: "org-1",
			name: "Managed Project",
			description: null,
			isActive: true,
			createdAt: new Date("2026-01-04T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-04T00:00:00.000Z"),
			updatedBy: null,
			rules: [],
		},
		{
			id: "model-other",
			organizationId: "org-1",
			name: "Other Scope",
			description: null,
			isActive: true,
			createdAt: new Date("2026-01-05T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-05T00:00:00.000Z"),
			updatedBy: null,
			rules: [],
		},
	],
	surchargeAssignments: [
		{
			id: "assignment-org",
			modelId: "model-org",
			organizationId: "org-1",
			assignmentType: "organization" as const,
			teamId: null,
			employeeId: null,
			priority: 0,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-01T00:00:00.000Z"),
			model: { id: "model-org", name: "Organization Default" },
			team: null,
			employee: null,
		},
		{
			id: "assignment-team",
			modelId: "model-team",
			organizationId: "org-1",
			assignmentType: "team" as const,
			teamId: "team-managed",
			employeeId: null,
			priority: 1,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-02T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-02T00:00:00.000Z"),
			model: { id: "model-team", name: "Managed Team" },
			team: { id: "team-managed", name: "Managed Team" },
			employee: null,
		},
		{
			id: "assignment-employee",
			modelId: "model-area",
			organizationId: "org-1",
			assignmentType: "employee" as const,
			teamId: null,
			employeeId: "employee-managed",
			priority: 2,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-03T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-03T00:00:00.000Z"),
			model: { id: "model-area", name: "Managed Area" },
			team: null,
			employee: { id: "employee-managed", firstName: "Mina", lastName: "Miller" },
		},
		{
			id: "assignment-other",
			modelId: "model-other",
			organizationId: "org-1",
			assignmentType: "team" as const,
			teamId: "team-other",
			employeeId: null,
			priority: 1,
			effectiveFrom: null,
			effectiveUntil: null,
			isActive: true,
			createdAt: new Date("2026-01-04T00:00:00.000Z"),
			createdBy: "user-1",
			updatedAt: new Date("2026-01-04T00:00:00.000Z"),
			model: { id: "model-other", name: "Other Scope" },
			team: { id: "team-other", name: "Other Team" },
			employee: null,
		},
	],
	surchargeCalculations: [
		{
			id: "calc-managed",
			employeeId: "employee-managed",
			organizationId: "org-1",
			workPeriodId: "wp-area",
			surchargeRuleId: null,
			surchargeModelId: "model-area",
			calculationDate: new Date("2026-02-01T00:00:00.000Z"),
			baseMinutes: 120,
			qualifyingMinutes: 60,
			surchargeMinutes: 15,
			appliedPercentage: "0.25",
			calculationDetails: null,
			createdAt: new Date("2026-02-01T01:00:00.000Z"),
			employee: { id: "employee-managed", firstName: "Mina", lastName: "Miller" },
		},
		{
			id: "calc-project",
			employeeId: "employee-project",
			organizationId: "org-1",
			workPeriodId: "wp-project",
			surchargeRuleId: null,
			surchargeModelId: "model-project",
			calculationDate: new Date("2026-02-02T00:00:00.000Z"),
			baseMinutes: 180,
			qualifyingMinutes: 90,
			surchargeMinutes: 20,
			appliedPercentage: "0.25",
			calculationDetails: null,
			createdAt: new Date("2026-02-02T01:00:00.000Z"),
			employee: { id: "employee-project", firstName: "Pia", lastName: "Project" },
		},
		{
			id: "calc-self",
			employeeId: "manager-1",
			organizationId: "org-1",
			workPeriodId: "wp-self",
			surchargeRuleId: null,
			surchargeModelId: "model-org",
			calculationDate: new Date("2026-02-03T00:00:00.000Z"),
			baseMinutes: 60,
			qualifyingMinutes: 30,
			surchargeMinutes: 10,
			appliedPercentage: "0.25",
			calculationDetails: null,
			createdAt: new Date("2026-02-03T01:00:00.000Z"),
			employee: { id: "manager-1", firstName: "Mara", lastName: "Manager" },
		},
		{
			id: "calc-other",
			employeeId: "employee-other",
			organizationId: "org-1",
			workPeriodId: "wp-other",
			surchargeRuleId: null,
			surchargeModelId: "model-other",
			calculationDate: new Date("2026-02-04T00:00:00.000Z"),
			baseMinutes: 100,
			qualifyingMinutes: 50,
			surchargeMinutes: 12,
			appliedPercentage: "0.25",
			calculationDetails: null,
			createdAt: new Date("2026-02-04T01:00:00.000Z"),
			employee: { id: "employee-other", firstName: "Otto", lastName: "Other" },
		},
	],
	workPeriodsById: {
		"wp-area": {
			id: "wp-area",
			organizationId: "org-1",
			projectId: null,
			locationId: "location-managed",
			subareaId: null,
		},
		"wp-project": {
			id: "wp-project",
			organizationId: "org-1",
			projectId: "project-managed",
			locationId: null,
			subareaId: null,
		},
		"wp-other": {
			id: "wp-other",
			organizationId: "org-1",
			projectId: "project-other",
			locationId: null,
			subareaId: null,
		},
		"wp-self": {
			id: "wp-self",
			organizationId: "org-1",
			projectId: null,
			locationId: null,
			subareaId: null,
		},
	},
	surchargeModelDetail: undefined as any,
	surchargeRuleDetail: undefined as any,
	surchargeAssignmentDetail: undefined as any,
	updateWhereCalls: [] as any[],
	deleteWhereCalls: [] as any[],
	workPeriodFindFirstCalls: 0,
	workPeriodFindManyCalls: 0,
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	desc: vi.fn((value: unknown) => value),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
	inArray: vi.fn((left: unknown, right: unknown[]) => ({ inArray: [left, right] })),
	lte: vi.fn((left: unknown, right: unknown) => ({ lte: [left, right] })),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", () => ({
	AppLayer: {},
}));

vi.mock("../employees/employee-action-utils", async () => {
	const { Effect } = await import("effect");
	const { AuthorizationError } = await import("@/lib/effect/errors");

	return {
		getEmployeeSettingsActorContext: vi.fn(() =>
			Effect.succeed({
				accessTier: mockState.settingsActorAccessTier,
				organizationId: "org-1",
				session: { user: { id: "user-1" } },
				currentEmployee: mockState.authContext.employee,
			}),
		),
		requireOrgAdminEmployeeSettingsAccess: vi.fn((actor: { accessTier: string }, options: any) =>
			actor.accessTier === "orgAdmin"
				? Effect.void
				: Effect.fail(
						new AuthorizationError({
							message: options.message,
							userId: "user-1",
							resource: options.resource,
							action: options.action,
						}),
				  ),
		),
	};
});

vi.mock("@/db/auth-schema", () => ({
	member: { userId: "userId", organizationId: "organizationId" },
}));

vi.mock("@/db/schema", () => ({
	employee: { organizationId: "organizationId", isActive: "isActive", id: "id" },
	locationEmployee: { employeeId: "employeeId", locationId: "locationId" },
	projectManager: { employeeId: "employeeId", projectId: "projectId" },
	subareaEmployee: { employeeId: "employeeId", subareaId: "subareaId" },
	surchargeCalculation: {
		organizationId: "organizationId",
		calculationDate: "calculationDate",
		employeeId: "employeeId",
	},
	surchargeModel: { id: "id", organizationId: "organizationId", createdAt: "createdAt", isActive: "isActive" },
	surchargeModelAssignment: {
		id: "id",
		modelId: "modelId",
		organizationId: "organizationId",
		createdAt: "createdAt",
		priority: "priority",
		isActive: "isActive",
	},
	surchargeRule: { id: "id" },
	team: { organizationId: "organizationId", name: "name" },
	teamPermissions: {
		employeeId: "employeeId",
		organizationId: "organizationId",
		teamId: "teamId",
		canManageTeamSettings: "canManageTeamSettings",
	},
	workPeriod: { id: "id", organizationId: "organizationId", projectId: "projectId", locationId: "locationId", subareaId: "subareaId" },
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: {
				findFirst: vi.fn(async () => ({ role: mockState.membershipRole })),
			},
			surchargeModel: {
				findMany: vi.fn(async () => mockState.surchargeModels),
				findFirst: vi.fn(async () =>
					mockState.surchargeModelDetail !== undefined
						? mockState.surchargeModelDetail
						: mockState.surchargeModels[0] ?? null,
				),
			},
			surchargeModelAssignment: {
				findMany: vi.fn(async () => mockState.surchargeAssignments),
				findFirst: vi.fn(async () =>
					mockState.surchargeAssignmentDetail !== undefined
						? mockState.surchargeAssignmentDetail
						: null,
				),
			},
			surchargeRule: {
				findFirst: vi.fn(async () =>
					mockState.surchargeRuleDetail !== undefined ? mockState.surchargeRuleDetail : null,
				),
			},
			teamPermissions: {
				findMany: vi.fn(async () => mockState.teamPermissionsRows),
			},
			locationEmployee: {
				findMany: vi.fn(async () => mockState.locationAssignments),
			},
			subareaEmployee: {
				findMany: vi.fn(async () => mockState.subareaAssignments),
			},
			projectManager: {
				findMany: vi.fn(async () => mockState.projectManagers),
			},
			employee: {
				findMany: vi.fn(async () => mockState.managedEmployees),
			},
			surchargeCalculation: {
				findMany: vi.fn(async () => mockState.surchargeCalculations),
			},
			workPeriod: {
				findMany: vi.fn(async () => {
					mockState.workPeriodFindManyCalls += 1;
					return Object.values(mockState.workPeriodsById);
				}),
				findFirst: vi.fn(async ({ where }: { where?: { eq?: [unknown, string] } }) => {
					mockState.workPeriodFindFirstCalls += 1;
					const workPeriodId = where?.eq?.[1];
					return workPeriodId ? mockState.workPeriodsById[workPeriodId as keyof typeof mockState.workPeriodsById] ?? null : null;
				}),
			},
		},
		insert: vi.fn(() => ({
			values: vi.fn(() => ({ returning: vi.fn(async () => []) })),
		})),
		update: vi.fn(() => ({
			set: vi.fn(() => ({
				where: vi.fn(async (where: unknown) => {
					mockState.updateWhereCalls.push(where);
					return undefined;
				}),
			})),
		})),
		delete: vi.fn(() => ({
			where: vi.fn(async (where: unknown) => {
				mockState.deleteWhereCalls.push(where);
				return undefined;
			}),
		})),
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: vi.fn(async () => mockState.authContext),
}));

const {
	createSurchargeModel,
	deleteSurchargeAssignment,
	deleteSurchargeModel,
	deleteSurchargeRule,
	getSurchargeModel,
	getSurchargeAssignments,
	getSurchargeCalculationsForPeriod,
	getSurchargeModels,
	updateSurchargeModel,
	updateSurchargeRule,
} = await import("./actions");

describe("surcharge settings scope behavior", () => {
	beforeEach(() => {
		mockState.settingsActorAccessTier = "manager";
		mockState.membershipRole = "member";
		mockState.authContext = {
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
			employee: {
				id: "manager-1",
				organizationId: "org-1",
				role: "manager",
				teamId: "team-managed",
			},
		};
		mockState.surchargeModelDetail = undefined;
		mockState.surchargeRuleDetail = undefined;
		mockState.surchargeAssignmentDetail = undefined;
		mockState.updateWhereCalls = [];
		mockState.deleteWhereCalls = [];
		mockState.workPeriodFindFirstCalls = 0;
		mockState.workPeriodFindManyCalls = 0;
	});

	it("lets managers read surcharge models applied to their teams, areas, and projects", async () => {
		const result = await getSurchargeModels("org-1");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.map((model) => model.id)).toEqual([
				"model-org",
				"model-team",
				"model-area",
				"model-project",
			]);
		}
		expect(mockState.workPeriodFindManyCalls).toBe(1);
		expect(mockState.workPeriodFindFirstCalls).toBe(0);
	});

	it("lets managers read surcharge calculations for managed scope instead of self only", async () => {
		const result = await getSurchargeCalculationsForPeriod(
			"org-1",
			new Date("2026-02-01T00:00:00.000Z"),
			new Date("2026-02-28T23:59:59.999Z"),
		);

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.map((calculation) => calculation.id)).toEqual([
				"calc-managed",
				"calc-project",
			]);
		}
	});

	it("lets managers read only surcharge assignments inside their visible team and employee scope", async () => {
		const result = await getSurchargeAssignments("org-1");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.map((assignment) => assignment.id)).toEqual([
				"assignment-employee",
				"assignment-team",
				"assignment-org",
			]);
		}
	});

	it("rejects direct manager surcharge mutations", async () => {
		const result = await createSurchargeModel("org-1", {
			name: "Night Premium",
			description: null,
			isActive: true,
			rules: [
				{
					ruleType: "time_window",
					name: "Night",
					description: null,
					percentage: 0.25,
					windowStartTime: "22:00",
					windowEndTime: "06:00",
					priority: 0,
					validFrom: null,
					validUntil: null,
					isActive: true,
				},
			],
		});

		expect(result).toEqual({ success: false, error: "Unauthorized: Admin access required" });
	});

	it("rejects reading a surcharge model from another organization by bare id", async () => {
		mockState.settingsActorAccessTier = "orgAdmin";
		mockState.membershipRole = "admin";
		mockState.authContext.employee = {
			id: "admin-1",
			organizationId: "org-1",
			role: "admin",
			teamId: null,
		};
		mockState.surchargeModelDetail = {
			id: "model-foreign",
			organizationId: "org-2",
			name: "Foreign Model",
			description: null,
			isActive: true,
			createdAt: new Date("2026-01-10T00:00:00.000Z"),
			createdBy: "user-2",
			updatedAt: new Date("2026-01-10T00:00:00.000Z"),
			updatedBy: null,
			rules: [],
		};

		const result = await getSurchargeModel("model-foreign");

		expect(result).toEqual({ success: false, error: "Surcharge model not found" });
	});

	it("rejects cross-organization surcharge model and rule mutations by bare id", async () => {
		mockState.settingsActorAccessTier = "orgAdmin";
		mockState.membershipRole = "admin";
		mockState.authContext.employee = {
			id: "admin-1",
			organizationId: "org-1",
			role: "admin",
			teamId: null,
		};
		mockState.surchargeModelDetail = null;
		mockState.surchargeRuleDetail = null;

		const updateModelResult = await updateSurchargeModel("model-foreign", { name: "Updated" });
		const deleteModelResult = await deleteSurchargeModel("model-foreign");
		const updateRuleResult = await updateSurchargeRule("rule-foreign", { name: "Updated rule" });
		const deleteRuleResult = await deleteSurchargeRule("rule-foreign");

		expect(updateModelResult).toEqual({ success: false, error: "Surcharge model not found" });
		expect(deleteModelResult).toEqual({ success: false, error: "Surcharge model not found" });
		expect(updateRuleResult).toEqual({ success: false, error: "Rule not found" });
		expect(deleteRuleResult).toEqual({ success: false, error: "Rule not found" });
		expect(mockState.updateWhereCalls).toEqual([]);
		expect(mockState.deleteWhereCalls).toEqual([]);
	});

	it("rejects cross-organization surcharge assignment deletion by bare id", async () => {
		mockState.settingsActorAccessTier = "orgAdmin";
		mockState.membershipRole = "admin";
		mockState.authContext.employee = {
			id: "admin-1",
			organizationId: "org-1",
			role: "admin",
			teamId: null,
		};
		mockState.surchargeAssignmentDetail = null;

		const result = await deleteSurchargeAssignment("assignment-foreign");

		expect(result).toEqual({ success: false, error: "Surcharge assignment not found" });
		expect(mockState.updateWhereCalls).toEqual([]);
	});
});
