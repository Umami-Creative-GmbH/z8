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
		getPayrollExportConfig: vi.fn(async () => null),
		getOrgSecret: vi.fn(async () => null),
		storeOrgSecret: vi.fn(async () => undefined),
		deleteOrgSecret: vi.fn(async () => undefined),
		createExportJob: vi.fn(),
		processExportJob: vi.fn(),
		getExportJobHistory: vi.fn(),
		getExportDownloadUrl: vi.fn(),
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
	getOrgSecret: mockState.getOrgSecret,
	storeOrgSecret: mockState.storeOrgSecret,
	deleteOrgSecret: mockState.deleteOrgSecret,
}));

vi.mock("next/cache", () => ({
	revalidatePath: mockState.revalidatePath,
}));

vi.mock("@/lib/payroll-export", () => ({
	createExportJob: mockState.createExportJob,
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

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mockState.caller));
});

const {
	deleteWorkdayCredentialsAction,
	getWorkdayConfigAction,
	saveWorkdayConfigAction,
	saveWorkdayCredentialsAction,
	testWorkdayConnectionAction,
} = await import("./actions");

const WORKDAY_FORMAT_ID = "workday_api";

describe("payroll export workday actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.caller = orgAdmin;
		mockState.getPayrollExportConfig.mockResolvedValue(null);
		mockState.getOrgSecret.mockResolvedValue(null);
	});

	it("exports workday action handlers", () => {
		expect(WORKDAY_FORMAT_ID).toBe("workday_api");
		expect(typeof getWorkdayConfigAction).toBe("function");
		expect(typeof saveWorkdayConfigAction).toBe("function");
		expect(typeof saveWorkdayCredentialsAction).toBe("function");
		expect(typeof deleteWorkdayCredentialsAction).toBe("function");
		expect(typeof testWorkdayConnectionAction).toBe("function");
	});

	it("refuses an org member", async () => {
		mockState.caller = {
			...orgAdmin,
			membershipRole: "member",
			employee: { id: "emp-1", role: "employee", former: false },
		};

		const result = await getWorkdayConfigAction();

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mockState.getPayrollExportConfig).not.toHaveBeenCalled();
	});

	it("stores workday credentials and returns success", async () => {
		const result = await saveWorkdayCredentialsAction({
			clientId: "  client-id  ",
			clientSecret: "  client-secret  ",
		});

		expect(result).toEqual({ success: true, data: { success: true } });
		expect(mockState.storeOrgSecret).toHaveBeenCalledTimes(2);
		expect(mockState.storeOrgSecret).toHaveBeenNthCalledWith(
			1,
			"org-1",
			"payroll/workday/client_id",
			"client-id",
		);
		expect(mockState.storeOrgSecret).toHaveBeenNthCalledWith(
			2,
			"org-1",
			"payroll/workday/client_secret",
			"client-secret",
		);
		expect(mockState.revalidatePath).toHaveBeenCalledWith("/settings/payroll-export");
	});

	it("returns hasCredentials false when only one workday secret exists", async () => {
		mockState.getPayrollExportConfig.mockResolvedValue({
			config: {
				id: "cfg-1",
				formatId: WORKDAY_FORMAT_ID,
				config: {
					tenantId: "tenant-1",
					hostname: "example.workday.com",
					timeEntryType: "time_tracking_event",
				} as unknown,
				isActive: true,
				createdAt: new Date("2026-01-01T00:00:00.000Z"),
				updatedAt: new Date("2026-01-01T00:00:00.000Z"),
			},
		});

		mockState.getOrgSecret.mockImplementation(async (_orgId: string, key: string) => {
			if (key === "payroll/workday/client_id") {
				return "client-id";
			}
			return null;
		});

		const result = await getWorkdayConfigAction();

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data?.hasCredentials).toBe(false);
		}
	});

	it("rejects whitespace-only credentials before storing", async () => {
		const result = await saveWorkdayCredentialsAction({
			clientId: "   ",
			clientSecret: "client-secret",
		});

		expect(result).toMatchObject({
			success: false,
			error: "Workday client ID cannot be empty",
			code: "ValidationError",
		});
		expect(mockState.storeOrgSecret).not.toHaveBeenCalled();
	});
});
