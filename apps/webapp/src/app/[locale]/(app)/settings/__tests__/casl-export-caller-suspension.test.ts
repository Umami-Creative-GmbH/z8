import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	isOrgAdminCasl: vi.fn(async () => false),
	findScheduledExports: vi.fn(),
	getAuditConfig: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	isOrgAdminCasl: mockState.isOrgAdminCasl,
}));

vi.mock("@/db", () => ({
	auditExportPackage: {},
	db: {
		query: {
			scheduledExport: { findMany: mockState.findScheduledExports },
		},
	},
	payrollExportConfig: {},
	scheduledExport: {},
	scheduledExportExecution: {},
}));

vi.mock("@/lib/audit-export", () => ({
	configurationService: { getConfig: mockState.getAuditConfig },
	verificationService: {},
}));

vi.mock("@/lib/audit-logger", () => ({
	AuditAction: {},
	logAudit: vi.fn(),
}));

vi.mock("@/lib/audit-pack/application/audit-pack-service", () => ({
	addAuditPackJob: vi.fn(),
}));

vi.mock("@/lib/audit-pack/application/request-repository", () => ({
	auditPackRequestRepository: {},
}));

vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl: vi.fn(),
}));

vi.mock("next/cache", () => ({
	revalidatePath: vi.fn(),
}));

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	return {
		AuthService: Context.GenericTag<{ readonly getSession: () => unknown }>(
			"AuthService",
		),
	};
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	return {
		AppLayer: Layer.succeed(AuthService, {
			getSession: () => Effect.succeed({ user: { id: "user-1" }, session: {} }),
		}),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");
	return {
		runServerActionSafe: async <T>(
			effect: Parameters<typeof Effect.runPromiseExit<T>>[0],
		) => {
			const exit = await Effect.runPromiseExit(effect);
			return Exit.match(exit as never, {
				onFailure: (cause) => {
					const error =
						[...Cause.defects(cause)][0] ??
						Option.getOrNull(Cause.failureOption(cause));
					return {
						success: false as const,
						error: (error as { message: string }).message,
						code: (error as { _tag: string })._tag,
					};
				},
				onSuccess: (data) => ({ success: true as const, data }),
			});
		},
	};
});

const { getScheduledExportsAction } = await import(
	"../scheduled-exports/actions"
);
const { getAuditConfigAction } = await import("../audit-export/actions");

describe("CASL export callers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.isOrgAdminCasl.mockResolvedValue(false);
	});

	it.each([
		["scheduled export", () => getScheduledExportsAction("org-1")],
		["audit export", () => getAuditConfigAction("org-1")],
	] as const)("denies the %s caller before reading organization data", async (_case, action) => {
		await expect(action()).resolves.toEqual({
			success: false,
			error: "Insufficient permissions - admin role required",
			code: "AuthorizationError",
		});
		expect(mockState.isOrgAdminCasl).toHaveBeenCalledWith("org-1");
		expect(mockState.findScheduledExports).not.toHaveBeenCalled();
		expect(mockState.getAuditConfig).not.toHaveBeenCalled();
	});
});
