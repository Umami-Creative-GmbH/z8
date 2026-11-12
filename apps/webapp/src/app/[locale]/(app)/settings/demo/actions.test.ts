import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	organizationFindFirst: vi.fn(),
	employeeFindMany: vi.fn(),
	generate: vi.fn(),
	clearOrganizationTimeData: vi.fn(),
	deleteNonAdminEmployeesData: vi.fn(),
	generateDemoEmployees: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				query: {
					organization: { findFirst: mocks.organizationFindFirst },
					employee: { findMany: mocks.employeeFindMany },
				},
			},
		}),
	);
});

vi.mock("@/lib/demo/demo-data.service", () => {
	const step = (name: string) => (options: unknown) => mocks.generate(name, options);
	return {
		assignWorkCategoriesToPeriods: step("assignWorkCategoriesToPeriods"),
		clearOrganizationTimeData: mocks.clearOrganizationTimeData,
		generateDemoAbsences: step("absences"),
		generateDemoChangePolicies: step("changePolicies"),
		generateDemoData: step("all"),
		generateDemoLocations: step("locations"),
		generateDemoManagerAssignments: step("managers"),
		generateDemoPendingAbsenceApprovals: step("pendingAbsenceApprovals"),
		generateDemoPendingTimeCorrectionApprovals: step("pendingTimeCorrectionApprovals"),
		generateDemoProjects: step("projects"),
		generateDemoShifts: step("shifts"),
		generateDemoShiftTemplates: step("shiftTemplates"),
		generateDemoTeams: step("teams"),
		generateDemoTimeEntries: step("timeEntries"),
		generateDemoVehicles: step("vehicles"),
		generateDemoWorkCategories: step("workCategories"),
	};
});
vi.mock("@/lib/demo/demo-vehicle-use-generator", () => ({
	assignDemoVehicleUseToPeriods: (options: unknown) => mocks.generate("vehicleUse", options),
}));
vi.mock("@/lib/demo/delete-non-admin", () => ({
	deleteNonAdminEmployeesData: mocks.deleteNonAdminEmployeesData,
}));
vi.mock("@/lib/demo/employee-generator", () => ({
	generateDemoEmployees: mocks.generateDemoEmployees,
}));

const actions = await import("./actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

const step = { dateRangeType: "last30" as const, employeeIds: ["employee-2"] };

const everyAction: Array<[string, () => Promise<{ success: boolean }>]> = [
	[
		"generateDemoDataAction",
		() =>
			actions.generateDemoDataAction({
				dateRangeType: "last30",
				includeTimeEntries: true,
				includeAbsences: false,
				includeTeams: false,
				includeProjects: false,
			}),
	],
	["generateTeamsStepAction", () => actions.generateTeamsStepAction(step)],
	["generateProjectsStepAction", () => actions.generateProjectsStepAction(step)],
	["generateManagersStepAction", () => actions.generateManagersStepAction(step)],
	["generateTimeEntriesStepAction", () => actions.generateTimeEntriesStepAction(step)],
	["generateAbsencesStepAction", () => actions.generateAbsencesStepAction(step)],
	[
		"generatePendingAbsenceApprovalsStepAction",
		() => actions.generatePendingAbsenceApprovalsStepAction(step),
	],
	[
		"generatePendingTimeCorrectionApprovalsStepAction",
		() => actions.generatePendingTimeCorrectionApprovalsStepAction(step),
	],
	["generateLocationsStepAction", () => actions.generateLocationsStepAction(step)],
	["generateWorkCategoriesStepAction", () => actions.generateWorkCategoriesStepAction(step)],
	["generateChangePoliciesStepAction", () => actions.generateChangePoliciesStepAction(step)],
	["generateShiftTemplatesStepAction", () => actions.generateShiftTemplatesStepAction(step)],
	["generateShiftsStepAction", () => actions.generateShiftsStepAction(step)],
	[
		"assignWorkCategoriesToPeriodsStepAction",
		() => actions.assignWorkCategoriesToPeriodsStepAction(step),
	],
	["assignVehicleUseToPeriodsStepAction", () => actions.assignVehicleUseToPeriodsStepAction(step)],
	["clearTimeDataAction", () => actions.clearTimeDataAction()],
	["getOrganizationEmployees", () => actions.getOrganizationEmployees()],
	[
		"generateDemoEmployeesAction",
		() => actions.generateDemoEmployeesAction({ count: 5, includeManagers: true }),
	],
	["deleteNonAdminDataAction", () => actions.deleteNonAdminDataAction()],
];

function expectNothingRan() {
	expect(mocks.generate).not.toHaveBeenCalled();
	expect(mocks.clearOrganizationTimeData).not.toHaveBeenCalled();
	expect(mocks.deleteNonAdminEmployeesData).not.toHaveBeenCalled();
	expect(mocks.generateDemoEmployees).not.toHaveBeenCalled();
	expect(mocks.employeeFindMany).not.toHaveBeenCalled();
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.organizationFindFirst.mockResolvedValue({ demoDataEnabled: true });
	mocks.employeeFindMany.mockResolvedValue([]);
	mocks.generate.mockResolvedValue({ vehiclesCreated: 0 });
	mocks.clearOrganizationTimeData.mockResolvedValue({});
	mocks.deleteNonAdminEmployeesData.mockResolvedValue({});
	mocks.generateDemoEmployees.mockResolvedValue({});
});

describe("demo data settings actions", () => {
	it.each(everyAction)("%s refuses a scoped manager", async (_name, run) => {
		mocks.caller = scopedManager;

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		expectNothingRan();
	});

	it.each(everyAction)(
		"%s refuses when the organization turned demo data off",
		async (_name, run) => {
			mocks.organizationFindFirst.mockResolvedValue({ demoDataEnabled: false });

			expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
			expectNothingRan();
		},
	);

	it.each(everyAction)("%s runs for an org admin", async (_name, run) => {
		expect(await run()).toMatchObject({ success: true });
	});

	it("generates a step for the session's organization as the caller", async () => {
		await actions.generateTeamsStepAction({ ...step, teamCount: 4 });

		expect(mocks.generate).toHaveBeenCalledWith(
			"teams",
			expect.objectContaining({
				organizationId: "org-1",
				createdBy: "user-1",
				includeTeams: true,
				teamCount: 4,
				employeeIds: ["employee-2"],
			}),
		);
	});

	it("brings the demo vehicles with the demo locations", async () => {
		mocks.generate.mockImplementation(async (name: string) =>
			name === "vehicles"
				? { vehiclesCreated: 2 }
				: { locationsCreated: 1, subareasCreated: 0, supervisorAssignmentsCreated: 0 },
		);

		const result = await actions.generateLocationsStepAction(step);

		expect(result).toEqual({
			success: true,
			data: {
				locationsCreated: 1,
				subareasCreated: 0,
				supervisorAssignmentsCreated: 0,
				vehiclesCreated: 2,
			},
		});
	});

	it("clears the session's organization's time data", async () => {
		await actions.clearTimeDataAction();

		expect(mocks.clearOrganizationTimeData).toHaveBeenCalledWith("org-1", "user-1");
	});

	it("rejects an unknown date range before generating", async () => {
		const result = await actions.generateTeamsStepAction({ dateRangeType: "forever" } as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.generate).not.toHaveBeenCalled();
	});
});
