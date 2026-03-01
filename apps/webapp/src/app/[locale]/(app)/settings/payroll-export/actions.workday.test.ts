import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const session = {
		user: {
			id: "user-1",
			email: "test@example.com",
			name: "Test User",
		},
		session: {
			id: "session-1",
			userId: "user-1",
			expiresAt: new Date("2099-01-01T00:00:00.000Z"),
			token: "token",
		},
	};

	return {
		session,
		isOrgAdminCasl: vi.fn(async () => true),
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

vi.mock("@/db", () => ({
	absenceCategory: {},
	db: {
		query: {
			payrollExportFormat: { findFirst: vi.fn() },
			payrollExportConfig: { findFirst: vi.fn() },
		},
		insert: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
	},
	payrollExportConfig: {},
	payrollExportFormat: {},
	payrollWageTypeMapping: {},
	workCategory: {},
}));

vi.mock("@/db/schema", () => ({
	employee: {},
}));

vi.mock("@/lib/auth-helpers", () => ({
	isOrgAdminCasl: mockState.isOrgAdminCasl,
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

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	const AuthService = Context.GenericTag<{
		readonly getSession: () => unknown;
	}>("AuthService");

	return {
		AuthService,
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");

	return {
		AppLayer: Layer.succeed(AuthService, {
			getSession: () => Effect.succeed(mockState.session),
		}),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	const toServerActionResult = <T>(exit: unknown) =>
		Exit.match(exit as never, {
			onFailure: (cause) => {
				const defects = Cause.defects(cause);
				const defect = [...defects][0] ?? null;
				const failure = Option.getOrNull(Cause.failureOption(cause));
				const error = defect ?? failure ?? cause;

				if (error && typeof error === "object" && "_tag" in error) {
					return {
						success: false as const,
						error: (error as { message: string }).message,
						code: (error as { _tag: string })._tag,
					};
				}

				if (error instanceof Error) {
					return {
						success: false as const,
						error: error.message || "An unexpected error occurred",
						code: "UNKNOWN_ERROR",
					};
				}

				return {
					success: false as const,
					error: "An unexpected error occurred",
					code: "UNKNOWN_ERROR",
				};
			},
			onSuccess: (data) => ({ success: true as const, data }),
		});

	return {
		runServerActionSafe: async <T>(effect: Parameters<typeof Effect.runPromiseExit<T>>[0]) => {
			const exit = await Effect.runPromiseExit(effect);
			return toServerActionResult(exit);
		},
		toServerActionResult,
	};
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
		mockState.isOrgAdminCasl.mockResolvedValue(true);
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

	it("returns authorization error when user lacks access", async () => {
		mockState.isOrgAdminCasl.mockResolvedValue(false);

		const result = await getWorkdayConfigAction("org-1");

		expect(result).toEqual({
			success: false,
			error: "Insufficient permissions - admin role required",
			code: "AuthorizationError",
		});
	});

	it("stores workday credentials and returns success", async () => {
		const result = await saveWorkdayCredentialsAction({
			organizationId: "org-1",
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

		const result = await getWorkdayConfigAction("org-1");

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data?.hasCredentials).toBe(false);
		}
	});

	it("rejects whitespace-only credentials before storing", async () => {
		const result = await saveWorkdayCredentialsAction({
			organizationId: "org-1",
			clientId: "   ",
			clientSecret: "client-secret",
		});

		expect(result).toEqual({
			success: false,
			error: "Workday client ID cannot be empty",
			code: "ValidationError",
		});
		expect(mockState.storeOrgSecret).not.toHaveBeenCalled();
	});
});
