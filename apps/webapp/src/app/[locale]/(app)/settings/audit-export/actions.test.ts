import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	packageFindMany: vi.fn(),
	getConfig: vi.fn(),
	initialize: vi.fn(),
	updateConfig: vi.fn(),
	rotateSigningKey: vi.fn(),
	getSigningKeyHistory: vi.fn(),
	exportPublicKey: vi.fn(),
	verifyPackage: vi.fn(),
	getVerificationHistory: vi.fn(),
	createRequest: vi.fn(),
	listRequests: vi.fn(),
	getRequest: vi.fn(),
	addAuditPackJob: vi.fn(),
	getPresignedUrl: vi.fn(),
	logAudit: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { query: { auditExportPackage: { findMany: mocks.packageFindMany } } },
		}),
	);
});

vi.mock("@/lib/audit-export", () => ({
	configurationService: {
		getConfig: mocks.getConfig,
		initialize: mocks.initialize,
		updateConfig: mocks.updateConfig,
		rotateSigningKey: mocks.rotateSigningKey,
		getSigningKeyHistory: mocks.getSigningKeyHistory,
		exportPublicKey: mocks.exportPublicKey,
	},
	verificationService: {
		verifyPackage: mocks.verifyPackage,
		getVerificationHistory: mocks.getVerificationHistory,
	},
}));

vi.mock("@/lib/audit-pack/application/request-repository", () => ({
	auditPackRequestRepository: {
		createRequest: mocks.createRequest,
		listRequests: mocks.listRequests,
		getRequest: mocks.getRequest,
	},
}));

vi.mock("@/lib/audit-pack/application/audit-pack-service", () => ({
	addAuditPackJob: mocks.addAuditPackJob,
}));

vi.mock("@/lib/storage/export-s3-client", () => ({ getPresignedUrl: mocks.getPresignedUrl }));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: mocks.logAudit,
}));

const actions = await import("./actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.packageFindMany.mockResolvedValue([]);
	mocks.getConfig.mockResolvedValue(null);
	mocks.updateConfig.mockResolvedValue({ retentionYears: 12 });
	mocks.createRequest.mockResolvedValue({ id: "request-1" });
	mocks.addAuditPackJob.mockResolvedValue({ id: "job-1" });
	mocks.getPresignedUrl.mockResolvedValue("https://storage.example.test/pack");
	mocks.logAudit.mockResolvedValue(undefined);
});

const services = () => [
	mocks.packageFindMany,
	mocks.getConfig,
	mocks.initialize,
	mocks.updateConfig,
	mocks.rotateSigningKey,
	mocks.getSigningKeyHistory,
	mocks.exportPublicKey,
	mocks.verifyPackage,
	mocks.getVerificationHistory,
	mocks.createRequest,
	mocks.listRequests,
	mocks.getRequest,
];

describe("audit export actions", () => {
	it.each([
		["getAuditConfigAction", () => actions.getAuditConfigAction()],
		["initializeAuditExportAction", () => actions.initializeAuditExportAction()],
		["updateAuditConfigAction", () => actions.updateAuditConfigAction({ retentionYears: 12 })],
		["rotateSigningKeyAction", () => actions.rotateSigningKeyAction()],
		["getSigningKeyHistoryAction", () => actions.getSigningKeyHistoryAction()],
		["exportPublicKeyAction", () => actions.exportPublicKeyAction()],
		["getAuditPackagesAction", () => actions.getAuditPackagesAction({})],
		[
			"createAuditPackAction",
			() => actions.createAuditPackAction({ startDateIso: "2026-01-01", endDateIso: "2026-01-31" }),
		],
		["getAuditPackRequestsAction", () => actions.getAuditPackRequestsAction({})],
		[
			"getAuditPackDownloadUrlAction",
			() => actions.getAuditPackDownloadUrlAction({ requestId: "request-1" }),
		],
		["verifyAuditPackageAction", () => actions.verifyAuditPackageAction({ packageId: "pkg-1" })],
		[
			"getVerificationHistoryAction",
			() => actions.getVerificationHistoryAction({ packageId: "pkg-1" }),
		],
	])("%s refuses a scoped manager", async (_name, run) => {
		mocks.caller = scopedManager;

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		for (const service of services()) expect(service).not.toHaveBeenCalled();
	});

	it("updates the active organization's configuration as the caller", async () => {
		const result = await actions.updateAuditConfigAction({
			retentionYears: 12,
			retentionMode: "compliance",
		});

		expect(result).toEqual({ success: true, data: { retentionYears: 12 } });
		expect(mocks.updateConfig).toHaveBeenCalledWith({
			organizationId: "org-1",
			updatedBy: "user-1",
			retentionYears: 12,
			retentionMode: "compliance",
			autoEnableDataExports: undefined,
			autoEnablePayrollExports: undefined,
		});
	});

	it("rejects an unknown retention mode before updating", async () => {
		const result = await actions.updateAuditConfigAction({ retentionMode: "forever" } as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.updateConfig).not.toHaveBeenCalled();
	});

	it("queues an audit pack for the active organization and audits it", async () => {
		const result = await actions.createAuditPackAction({
			startDateIso: "2026-01-01",
			endDateIso: "2026-01-31",
		});

		expect(result).toEqual({ success: true, data: { requestId: "request-1", jobId: "job-1" } });
		expect(mocks.createRequest).toHaveBeenCalledWith({
			organizationId: "org-1",
			requestedById: "user-1",
			// Whole UTC days, first to last.
			startDate: new Date("2026-01-01T00:00:00.000Z"),
			endDate: new Date("2026-01-31T23:59:59.999Z"),
		});
		expect(mocks.logAudit).toHaveBeenCalledWith(
			expect.objectContaining({
				actorId: "user-1",
				actorEmail: "user-1@example.test",
				organizationId: "org-1",
				metadata: expect.objectContaining({
					startDateIso: "2026-01-01",
					endDateIso: "2026-01-31",
				}),
			}),
		);
	});

	it("refuses an audit pack whose range ends before it starts", async () => {
		const result = await actions.createAuditPackAction({
			startDateIso: "2026-02-01",
			endDateIso: "2026-01-01",
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.createRequest).not.toHaveBeenCalled();
	});

	it("looks the download up in the active organization and reports another's as not found", async () => {
		mocks.getRequest.mockResolvedValue(null);

		const result = await actions.getAuditPackDownloadUrlAction({ requestId: "request-1" });

		expect(result).toMatchObject({ success: false, code: "NotFoundError" });
		expect(mocks.getRequest).toHaveBeenCalledWith({
			requestId: "request-1",
			organizationId: "org-1",
		});
		expect(mocks.getPresignedUrl).not.toHaveBeenCalled();
	});
});
