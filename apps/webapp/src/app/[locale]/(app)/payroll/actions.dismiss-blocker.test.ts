import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import type {
	PayrollBlockerType,
	PayrollWorkspaceSummary,
} from "@/lib/payroll-workspace/types";

const mockState = vi.hoisted(() => {
	const returning = vi.fn(async () => [{ id: "dismissal-1" }]);
	const onConflictDoNothing = vi.fn(() => ({ returning }));
	const values = vi.fn(() => ({ onConflictDoNothing }));

	return {
		findFirst: vi.fn(),
		getAuthContext: vi.fn(async () => ({
			user: {
				id: "user-1",
				email: "payroll@example.com",
				name: "Payroll User",
			},
			session: { activeOrganizationId: "org-1" },
			employee: {
				id: "11111111-1111-4111-8111-111111111111",
				organizationId: "org-1",
				role: "manager",
			},
		})),
		getPayrollWorkspaceSummary: vi.fn(),
		insert: vi.fn(() => ({ values })),
		onConflictDoNothing,
		resolvePayrollAccessibleEmployeeIds: vi.fn(async () => [
			"22222222-2222-4222-8222-222222222222",
		]),
		returning,
		values,
	};
});

vi.mock("@/db", () => ({
	db: {
		insert: mockState.insert,
		query: { payrollBlockerDismissal: { findFirst: mockState.findFirst } },
	},
	payrollExportConfig: {},
	payrollExportFormat: {},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: mockState.getAuthContext,
}));

vi.mock("@/lib/payroll-access/permissions", () => ({
	resolvePayrollAccessibleEmployeeIds:
		mockState.resolvePayrollAccessibleEmployeeIds,
	intersectPayrollScope: ({
		allowedEmployeeIds,
		requestedEmployeeIds,
	}: {
		allowedEmployeeIds: string[];
		requestedEmployeeIds?: string[];
	}) =>
		(requestedEmployeeIds ?? allowedEmployeeIds)
			.filter((employeeId) => allowedEmployeeIds.includes(employeeId))
			.sort(),
}));

vi.mock("@/lib/payroll-export", () => ({
	createExportJob: vi.fn(),
	enqueuePayrollExportJob: vi.fn(),
	getFormatter: vi.fn(() => ({})),
	getPayrollExportConfig: vi.fn(),
	processExportJob: vi.fn(),
}));

vi.mock("@/lib/payroll-workspace/pdf-exporter", () => ({
	exportPayrollSummaryToPDF: vi.fn(),
	generatePayrollPDFFilename: vi.fn(),
}));

vi.mock("@/lib/payroll-workspace/summary", () => ({
	getPayrollWorkspaceSummary: mockState.getPayrollWorkspaceSummary,
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => (_key: string, fallback: string) => fallback),
}));

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	return {
		runServerActionSafe: async <T>(
			effect: Parameters<typeof Effect.runPromise<T>>[0],
		) => {
			const exit = await Effect.runPromiseExit(effect);
			if (Exit.isSuccess(exit))
				return { success: true as const, data: exit.value };

			const appError = Option.getOrUndefined(Cause.failureOption(exit.cause)) as
				| { _tag?: string; message?: string }
				| undefined;
			return {
				success: false as const,
				error: appError?.message ?? "Unknown error",
				code: appError?._tag,
			};
		},
	};
});

const { dismissPayrollBlockerAction } = await import("./actions");
type DismissPayrollBlockerRequest =
	import("./actions").DismissPayrollBlockerRequest;

const sourceId = "33333333-3333-4333-8333-333333333333";
const employeeId = "22222222-2222-4222-8222-222222222222";
const actorEmployeeId = "11111111-1111-4111-8111-111111111111";
const baseRequest: DismissPayrollBlockerRequest = {
	startDate: "2026-01-01",
	endDate: "2026-01-31",
	label: "January 2026",
	employeeIds: [employeeId],
	blockerId: sourceId,
	blockerType: "missing_clock_out",
};

function summaryWithBlocker(
	type: PayrollBlockerType,
	blockerEmployeeId = employeeId,
) {
	return {
		blockers: [
			{
				id: sourceId,
				employeeId: blockerEmployeeId,
				type,
				label: "Blocker",
				date: "2026-01-10",
				time: null,
			},
		],
	} as PayrollWorkspaceSummary;
}

describe("dismissPayrollBlockerAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findFirst.mockResolvedValue(undefined);
		mockState.getPayrollWorkspaceSummary.mockResolvedValue(
			summaryWithBlocker("missing_clock_out"),
		);
		mockState.resolvePayrollAccessibleEmployeeIds.mockResolvedValue([
			employeeId,
		]);
		mockState.returning.mockResolvedValue([{ id: "dismissal-1" }]);
	});

	it("inserts only server-resolved values for an in-scope live blocker", async () => {
		const result = await dismissPayrollBlockerAction(baseRequest);

		expect(result).toEqual({ success: true, data: { dismissed: true } });
		expect(
			mockState.getPayrollWorkspaceSummary,
		).toHaveBeenCalledExactlyOnceWith({
			organizationId: "org-1",
			allowedEmployeeIds: [employeeId],
			period: expect.objectContaining({ label: "January 2026" }),
			generatedBy: { id: actorEmployeeId, name: "Payroll User" },
		});
		expect(mockState.values).toHaveBeenCalledExactlyOnceWith({
			organizationId: "org-1",
			blockerType: "missing_clock_out",
			sourceId,
			employeeId,
			dismissedByEmployeeId: actorEmployeeId,
		});
		expect(mockState.onConflictDoNothing).toHaveBeenCalledOnce();
		expect(mockState.returning).toHaveBeenCalledOnce();

		const query = mockState.findFirst.mock.calls[0]?.[0];
		const compiled = new PgDialect().sqlToQuery(query.where);
		expect(compiled.sql).toContain('"organization_id" = $1');
		expect(compiled.sql).toContain('"blocker_type" = $2');
		expect(compiled.sql).toContain('"source_id" = $3');
		expect(compiled.params).toEqual(["org-1", "missing_clock_out", sourceId]);
	});

	it("returns idempotent success for an exact dismissal still in resolved scope", async () => {
		mockState.findFirst.mockResolvedValue({
			organizationId: "org-1",
			blockerType: "missing_clock_out",
			sourceId,
			employeeId,
		});

		await expect(dismissPayrollBlockerAction(baseRequest)).resolves.toEqual({
			success: true,
			data: { dismissed: true },
		});
		expect(mockState.getPayrollWorkspaceSummary).not.toHaveBeenCalled();
		expect(mockState.insert).not.toHaveBeenCalled();
	});

	it("rejects an existing dismissal outside the currently resolved employee scope", async () => {
		mockState.findFirst.mockResolvedValue({
			organizationId: "org-1",
			blockerType: "missing_clock_out",
			sourceId,
			employeeId: "44444444-4444-4444-8444-444444444444",
		});

		const result = await dismissPayrollBlockerAction(baseRequest);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.insert).not.toHaveBeenCalled();
	});

	it.each([
		["unknown or stale source", []],
		["type mismatch", summaryWithBlocker("pending_absence").blockers],
	])("rejects %s", async (_case, blockers) => {
		mockState.getPayrollWorkspaceSummary.mockResolvedValue({
			blockers,
		} as PayrollWorkspaceSummary);

		const result = await dismissPayrollBlockerAction(baseRequest);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.insert).not.toHaveBeenCalled();
	});

	it("rejects a source whose affected employee is outside the requested and allowed scope", async () => {
		mockState.getPayrollWorkspaceSummary.mockResolvedValue(
			summaryWithBlocker(
				"missing_clock_out",
				"44444444-4444-4444-8444-444444444444",
			),
		);

		const result = await dismissPayrollBlockerAction(baseRequest);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.insert).not.toHaveBeenCalled();
	});

	it("does not let a cross-organization existing dismissal authorize a write", async () => {
		mockState.findFirst.mockResolvedValue({
			organizationId: "org-2",
			blockerType: "missing_clock_out",
			sourceId,
			employeeId,
		});
		mockState.getPayrollWorkspaceSummary.mockResolvedValue({
			blockers: [],
		} as PayrollWorkspaceSummary);

		const result = await dismissPayrollBlockerAction(baseRequest);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.insert).not.toHaveBeenCalled();
	});

	it.each([
		[{ ...baseRequest, blockerId: "not-a-uuid" }, "blockerId"],
		[{ ...baseRequest, blockerType: "arbitrary" }, "blockerType"],
	])(
		"rejects invalid blocker input before database access",
		async (request, _field) => {
			const result = await dismissPayrollBlockerAction(
				request as DismissPayrollBlockerRequest,
			);

			expect(result).toMatchObject({ success: false, code: "ValidationError" });
			expect(mockState.getAuthContext).toHaveBeenCalledOnce();
			expect(
				mockState.resolvePayrollAccessibleEmployeeIds,
			).not.toHaveBeenCalled();
			expect(mockState.findFirst).not.toHaveBeenCalled();
			expect(mockState.getPayrollWorkspaceSummary).not.toHaveBeenCalled();
			expect(mockState.insert).not.toHaveBeenCalled();
		},
	);

	it("ignores malicious runtime organization, employee, actor, and timestamp fields", async () => {
		type ForbiddenClientFields = Extract<
			keyof DismissPayrollBlockerRequest,
			| "organizationId"
			| "employeeId"
			| "affectedEmployeeId"
			| "actorId"
			| "dismissedByEmployeeId"
			| "timestamp"
			| "dismissedAt"
		>;
		expectTypeOf<ForbiddenClientFields>().toEqualTypeOf<never>();

		await dismissPayrollBlockerAction({
			...baseRequest,
			organizationId: "org-2",
			employeeId: "44444444-4444-4444-8444-444444444444",
			affectedEmployeeId: "44444444-4444-4444-8444-444444444444",
			actorId: "55555555-5555-4555-8555-555555555555",
			dismissedByEmployeeId: "55555555-5555-4555-8555-555555555555",
			timestamp: "2000-01-01T00:00:00.000Z",
			dismissedAt: "2000-01-01T00:00:00.000Z",
		} as DismissPayrollBlockerRequest);

		expect(mockState.values).toHaveBeenCalledExactlyOnceWith({
			organizationId: "org-1",
			blockerType: "missing_clock_out",
			sourceId,
			employeeId,
			dismissedByEmployeeId: actorEmployeeId,
		});
	});

	it("returns idempotent success when a concurrent conflict row remains in scope", async () => {
		mockState.returning.mockResolvedValueOnce([]);
		mockState.findFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			organizationId: "org-1",
			blockerType: "missing_clock_out",
			sourceId,
			employeeId,
		});

		await expect(dismissPayrollBlockerAction(baseRequest)).resolves.toEqual({
			success: true,
			data: { dismissed: true },
		});
		expect(mockState.insert).toHaveBeenCalledOnce();
		expect(mockState.onConflictDoNothing).toHaveBeenCalledOnce();
		expect(mockState.returning).toHaveBeenCalledOnce();
		expect(mockState.findFirst).toHaveBeenCalledTimes(2);
	});

	it("rejects a concurrent conflict row outside the freshly resolved scope", async () => {
		mockState.returning.mockResolvedValueOnce([]);
		mockState.findFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			organizationId: "org-1",
			blockerType: "missing_clock_out",
			sourceId,
			employeeId: "44444444-4444-4444-8444-444444444444",
		});

		const result = await dismissPayrollBlockerAction(baseRequest);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.insert).toHaveBeenCalledOnce();
		expect(mockState.findFirst).toHaveBeenCalledTimes(2);
	});

	it("rejects a reported conflict when the exact dismissal row is absent", async () => {
		mockState.returning.mockResolvedValueOnce([]);

		const result = await dismissPayrollBlockerAction(baseRequest);

		expect(result).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mockState.insert).toHaveBeenCalledOnce();
		expect(mockState.findFirst).toHaveBeenCalledTimes(2);
	});

	it("returns idempotent success when a concurrent dismissal hides the rebuilt blocker", async () => {
		mockState.findFirst.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
			organizationId: "org-1",
			blockerType: "missing_clock_out",
			sourceId,
			employeeId,
		});
		mockState.getPayrollWorkspaceSummary.mockResolvedValue({
			blockers: [],
		} as PayrollWorkspaceSummary);

		await expect(dismissPayrollBlockerAction(baseRequest)).resolves.toEqual({
			success: true,
			data: { dismissed: true },
		});
		expect(mockState.findFirst).toHaveBeenCalledTimes(2);
		expect(mockState.insert).not.toHaveBeenCalled();
	});

	it.each<PayrollBlockerType>([
		"missing_clock_out",
		"pending_absence",
		"pending_time_correction",
	])("matches and dismisses supported blocker type %s", async (blockerType) => {
		mockState.getPayrollWorkspaceSummary.mockResolvedValue(
			summaryWithBlocker(blockerType),
		);

		const result = await dismissPayrollBlockerAction({
			...baseRequest,
			blockerType,
		});

		expect(result).toEqual({ success: true, data: { dismissed: true } });
		expect(mockState.values).toHaveBeenCalledWith(
			expect.objectContaining({ blockerType, sourceId }),
		);
	});
});
