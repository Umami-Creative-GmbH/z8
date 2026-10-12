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
		findEmployee: vi.fn(async () => ({ id: "emp-1" })),
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

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
}));

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
	employee: {
		userId: "userId",
		organizationId: "organizationId",
	},
}));

// The identifier field store (#821) has its own PostgreSQL suite.
vi.mock("@/lib/payroll-export/personnel-identifier-store", () => ({
	listPayrollIdentifierFields: vi.fn(async () => []),
	savePayrollExportConfig: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	isOrgAdminCasl: mockState.isOrgAdminCasl,
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

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	const AuthService = Context.Service<{
		readonly getSession: () => unknown;
	}>("AuthService");

	return {
		AuthService,
	};
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	const DatabaseService = Context.Service<{
		readonly db: {
			query: {
				employee: {
					findFirst: (input: unknown) => Promise<{ id: string } | null>;
				};
			};
		};
		readonly query: <T>(key: string, fn: () => Promise<T>) => unknown;
	}>("DatabaseService");

	return {
		DatabaseService,
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");

	const authLayer = Layer.succeed(AuthService, {
		getSession: () => Effect.succeed(mockState.session),
	});

	const databaseLayer = Layer.succeed(DatabaseService, {
		db: {
			query: {
				employee: {
					findFirst: mockState.findEmployee,
				},
			},
		},
		query: <T>(_key: string, fn: () => Promise<T>) => Effect.promise(fn),
	});

	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		Layer.merge(authLayer, databaseLayer),
	);
});

vi.mock("@/lib/effect/result", async () => {
	const { runtime } = await import("@/lib/effect/runtime");
	const { Cause, Effect, Exit, Option, Result } = await import("effect");

	const toServerActionResult = <_T>(exit: unknown) =>
		Exit.match(exit as never, {
			onFailure: (cause) => {
				const defect = Result.getOrNull(Cause.findDefect(cause));
				const failure = Option.getOrNull(Cause.findErrorOption(cause));
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
			const exit = await runtime.runPromiseExit(effect);
			return toServerActionResult(exit);
		},
		toServerActionResult,
	};
});

const { startExportAction } = await import("./actions");

describe("startExportAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.isOrgAdminCasl.mockResolvedValue(true);
		mockState.findEmployee.mockResolvedValue({ id: "emp-1" });
		mockState.createExportJob.mockResolvedValue({ jobId: "job-1", isAsync: true });
	});

	it("queues async exports with the organization scope", async () => {
		const result = await startExportAction({
			organizationId: "org-1",
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
			organizationId: "org-1",
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
});
