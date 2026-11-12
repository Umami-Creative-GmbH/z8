import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "emp-1", role: "admin", former: false },
};

const mockState = vi.hoisted(() => {
	return {
		caller: null as StubCaller | null,
		createExportJob: vi.fn(async () => ({ jobId: "job-1", isAsync: true })),
		enqueuePayrollExportJob: vi.fn(async () => undefined),
		processExportJob: vi.fn(),
		getExportJobHistory: vi.fn(),
		getExportDownloadUrl: vi.fn(),
		getPayrollExportConfig: vi.fn(),
		getWageTypeMappings: vi.fn(),
		getWorkCategories: vi.fn(),
		getAbsenceCategories: vi.fn(),
		getEmployeesForFilter: vi.fn(),
		getTeamsForFilter: vi.fn(),
		getProjectsForFilter: vi.fn(),
		revalidatePath: vi.fn(),
	};
});

vi.mock("@/db", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/db")>()),
	db: {
		query: {
			payrollExportFormat: { findFirst: vi.fn() },
			payrollExportConfig: { findFirst: vi.fn() },
		},
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	},
}));

// The identifier field store (#821) has its own PostgreSQL suite.
vi.mock("@/lib/payroll-export/personnel-identifier-store", () => ({
	listPayrollIdentifierFields: vi.fn(async () => []),
	savePayrollExportConfig: vi.fn(),
}));

vi.mock("@/lib/vault/secrets", () => ({
	getOrgSecret: vi.fn(),
	storeOrgSecret: vi.fn(),
	deleteOrgSecret: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockState.revalidatePath,
}));

vi.mock("@/lib/payroll-export", () => ({
	createExportJob: mockState.createExportJob,
	enqueuePayrollExportJob: mockState.enqueuePayrollExportJob,
	processExportJob: mockState.processExportJob,
	getExportJobHistory: mockState.getExportJobHistory,
	getExportDownloadUrl: mockState.getExportDownloadUrl,
	getPayrollExportConfig: mockState.getPayrollExportConfig,
	getWageTypeMappings: mockState.getWageTypeMappings,
	getWorkCategories: mockState.getWorkCategories,
	getAbsenceCategories: mockState.getAbsenceCategories,
	getEmployeesForFilter: mockState.getEmployeesForFilter,
	getTeamsForFilter: mockState.getTeamsForFilter,
	getProjectsForFilter: mockState.getProjectsForFilter,
}));

vi.mock("@/lib/travel-expenses/payroll-run", () => ({ discardPayrollRun: vi.fn() }));

// Marks the key so the test sees the refusal went through translation.
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (key: string, fallback: string, params?: Record<string, string>) =>
		`${key}|${fallback.replace(/\{(\w+)\}/g, (_, name: string) => params?.[name] ?? `{${name}}`)}`,
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mockState.caller));
});

const actions = await import("./actions");
const { startExportAction } = actions;
const { PayrollIdentifierDuplicateError } = await import(
	"@/lib/payroll-export/personnel-identifier"
);

describe("startExportAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.caller = orgAdmin;
		mockState.createExportJob.mockResolvedValue({ jobId: "job-1", isAsync: true });
	});

	it("queues async exports with the organization scope", async () => {
		const result = await startExportAction({
			formatId: "workday_api",
			startDate: "2026-01-01",
			endDate: "2026-01-31",
		});

		expect(result).toEqual({
			success: true,
			data: { jobId: "job-1", isAsync: true },
		});

		expect(mockState.createExportJob).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				formatId: "workday_api",
				requestedById: "emp-1",
			}),
		);

		expect(mockState.createExportJob).not.toHaveBeenCalledWith(
			expect.objectContaining({ formatId: "datev_lohn" }),
		);
		expect(mockState.enqueuePayrollExportJob).toHaveBeenCalledExactlyOnceWith({
			jobId: "job-1",
			organizationId: "org-1",
		});
		expect(mockState.processExportJob).not.toHaveBeenCalled();
	});

	it("processes synchronous exports inline with the organization scope", async () => {
		mockState.createExportJob.mockResolvedValueOnce({ jobId: "job-sync", isAsync: false });
		mockState.processExportJob.mockResolvedValueOnce({
			result: {
				content: "sync-content",
				metadata: {
					unmappedOvertimePayouts: [
						{ id: "payout-1", employeeId: "employee-1", day: "2026-01-15", minutes: 300 },
						{ id: "payout-2", employeeId: "employee-2", day: "2026-01-20", minutes: 60 },
					],
				},
			},
			downloadUrl: "https://example.com/export.csv",
		});

		const result = await startExportAction({
			formatId: "workday_api",
			startDate: "2026-01-01",
			endDate: "2026-01-31",
		});

		expect(result).toEqual({
			success: true,
			data: {
				jobId: "job-sync",
				isAsync: false,
				downloadUrl: "https://example.com/export.csv",
				fileContent: "sync-content",
				// #1001: the export reports the overtime payouts it could not carry.
				unmappedOvertimePayoutCount: 2,
			},
		});
		expect(mockState.processExportJob).toHaveBeenCalledExactlyOnceWith({
			jobId: "job-sync",
			organizationId: "org-1",
		});
		expect(mockState.enqueuePayrollExportJob).not.toHaveBeenCalled();
	});

	it("refuses a synchronous export with a translated message naming employees sharing an identifier", async () => {
		mockState.createExportJob.mockResolvedValueOnce({ jobId: "job-sync", isAsync: false });
		mockState.processExportJob.mockRejectedValueOnce(
			new PayrollIdentifierDuplicateError(
				[
					{
						employees: [
							{ employeeId: "employee-1", identifier: "LG-7", name: "Anna Muster" },
							{ employeeId: "employee-2", identifier: "lg-7", name: "Ben Beispiel" },
						],
					},
				],
				"org-1",
			),
		);

		const result = await startExportAction({
			formatId: "personio",
			startDate: "2026-01-01",
			endDate: "2026-01-31",
		});

		expect(result).toMatchObject({
			success: false,
			code: "ConflictError",
			error:
				"payroll.errors.exportBlockedByDuplicateIdentifier|Export blocked: several employees share a personnel identifier. Give each employee their own: Anna Muster (LG-7), Ben Beispiel (lg-7)",
		});
	});

	it("keeps other synchronous export failures as before", async () => {
		mockState.createExportJob.mockResolvedValueOnce({ jobId: "job-sync", isAsync: false });
		mockState.processExportJob.mockRejectedValueOnce(new Error("connector unreachable"));

		const result = await startExportAction({
			formatId: "personio",
			startDate: "2026-01-01",
			endDate: "2026-01-31",
		});

		expect(result).toMatchObject({
			success: false,
			code: "UNKNOWN_ERROR",
			error: "connector unreachable",
		});
	});

	it("refuses an org admin without an employee record, who cannot request an export", async () => {
		mockState.caller = { ...orgAdmin, membershipRole: "owner", employee: null };

		const result = await startExportAction({
			formatId: "personio",
			startDate: "2026-01-01",
			endDate: "2026-01-31",
		});

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mockState.createExportJob).not.toHaveBeenCalled();
	});
});

const config = { config: {} as never };
const credentials = { clientId: "client", clientSecret: "secret" };
const exportRequest = { formatId: "personio", startDate: "2026-01-01", endDate: "2026-01-31" };

/** Every payroll export settings action with input it accepts. */
const everyAction: Array<[string, () => Promise<{ success: boolean }>]> = [
	["getPayrollIdentifierFieldsAction", () => actions.getPayrollIdentifierFieldsAction()],
	["getDatevConfigAction", () => actions.getDatevConfigAction()],
	["saveDatevConfigAction", () => actions.saveDatevConfigAction(config)],
	["getLexwareConfigAction", () => actions.getLexwareConfigAction()],
	["saveLexwareConfigAction", () => actions.saveLexwareConfigAction(config)],
	["getSageConfigAction", () => actions.getSageConfigAction()],
	["saveSageConfigAction", () => actions.saveSageConfigAction(config)],
	["getSuccessFactorsConfigAction", () => actions.getSuccessFactorsConfigAction()],
	["saveSuccessFactorsConfigAction", () => actions.saveSuccessFactorsConfigAction(config)],
	["testSuccessFactorsConnectionAction", () => actions.testSuccessFactorsConnectionAction(config)],
	[
		"saveSuccessFactorsCredentialsAction",
		() => actions.saveSuccessFactorsCredentialsAction(credentials),
	],
	["deleteSuccessFactorsCredentialsAction", () => actions.deleteSuccessFactorsCredentialsAction()],
	["getWorkdayConfigAction", () => actions.getWorkdayConfigAction()],
	["saveWorkdayConfigAction", () => actions.saveWorkdayConfigAction(config)],
	["saveWorkdayCredentialsAction", () => actions.saveWorkdayCredentialsAction(credentials)],
	["deleteWorkdayCredentialsAction", () => actions.deleteWorkdayCredentialsAction()],
	["testWorkdayConnectionAction", () => actions.testWorkdayConnectionAction(config)],
	["getMappingsAction", () => actions.getMappingsAction()],
	["saveMappingAction", () => actions.saveMappingAction({ specialCategory: "overtime" })],
	["deleteMappingAction", () => actions.deleteMappingAction({ mappingId: "mapping-1" })],
	["getWorkCategoriesAction", () => actions.getWorkCategoriesAction()],
	["getAbsenceCategoriesAction", () => actions.getAbsenceCategoriesAction()],
	["getFilterOptionsAction", () => actions.getFilterOptionsAction()],
	["startExportAction", () => actions.startExportAction(exportRequest)],
	["getExportHistoryAction", () => actions.getExportHistoryAction()],
	["getExportDownloadUrlAction", () => actions.getExportDownloadUrlAction({ jobId: "job-1" })],
	["discardPayrollRunAction", () => actions.discardPayrollRunAction({ jobId: "job-1" })],
	["getPersonioConfigAction", () => actions.getPersonioConfigAction()],
	["savePersonioConfigAction", () => actions.savePersonioConfigAction(config)],
	["savePersonioCredentialsAction", () => actions.savePersonioCredentialsAction(credentials)],
	["deletePersonioCredentialsAction", () => actions.deletePersonioCredentialsAction()],
	["testPersonioConnectionAction", () => actions.testPersonioConnectionAction()],
];

describe("payroll export settings access", () => {
	it("lists every exported action", () => {
		const exported = Object.entries(actions)
			.filter(([, value]) => typeof value === "function")
			.map(([name]) => name);

		expect(everyAction.map(([name]) => name).toSorted()).toEqual(exported.toSorted());
	});

	it.each(everyAction)("%s refuses a scoped manager before doing anything", async (_name, call) => {
		vi.clearAllMocks();
		mockState.caller = {
			...orgAdmin,
			membershipRole: "member",
			employee: { id: "emp-2", role: "manager", former: false },
		};

		expect(await call()).toMatchObject({ success: false, code: "AuthorizationError" });
		for (const mock of Object.values(mockState)) {
			if (typeof mock === "function" && "mock" in mock) expect(mock).not.toHaveBeenCalled();
		}
	});

	it("reads configuration from the session's organization", async () => {
		mockState.caller = orgAdmin;
		mockState.getPayrollExportConfig.mockResolvedValue(null);

		expect(await actions.getDatevConfigAction()).toEqual({ success: true, data: null });
		expect(mockState.getPayrollExportConfig).toHaveBeenCalledWith("org-1", "datev_lohn");
	});
});
