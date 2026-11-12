import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mockState = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	findScheduledExports: vi.fn(),
	getAuditConfig: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mockState.caller, {
			db: { query: { scheduledExport: { findMany: mockState.findScheduledExports } } },
		}),
	);
});

vi.mock("@/lib/audit-export", () => ({
	configurationService: { getConfig: mockState.getAuditConfig },
	verificationService: {},
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

const { getScheduledExportsAction } = await import("../scheduled-exports/actions");
const { getAuditConfigAction } = await import("../audit-export/actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};

describe("export settings callers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it.each([
		["scheduled export", () => getScheduledExportsAction()],
		["audit export", () => getAuditConfigAction()],
	] as const)(
		"denies the %s to a caller without org-admin settings access before reading organization data",
		async (_case, action) => {
			for (const caller of [
				{
					...orgAdmin,
					membershipRole: "member",
					employee: { ...orgAdmin.employee!, role: "manager" as const },
				},
				{ ...orgAdmin, membershipRole: null },
				{ ...orgAdmin, employee: { ...orgAdmin.employee!, former: true } },
			]) {
				mockState.caller = caller;

				await expect(action()).resolves.toMatchObject({
					success: false,
					code: "AuthorizationError",
				});
			}
			expect(mockState.findScheduledExports).not.toHaveBeenCalled();
			expect(mockState.getAuditConfig).not.toHaveBeenCalled();
		},
	);
});
