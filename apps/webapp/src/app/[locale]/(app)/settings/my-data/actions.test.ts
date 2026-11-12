import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	resolveMyDataAccess: vi.fn(),
	listPersonalDataExports: vi.fn(),
	requestPersonalDataExport: vi.fn(),
	authorizePersonalDataExportDownload: vi.fn(),
	enqueuePersonalDataExportBuild: vi.fn(),
	isExportS3Configured: vi.fn(),
	getPrivateObjectPresignedUrl: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller));
});

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/personal-data-export/store", () => ({
	resolveMyDataAccess: mocks.resolveMyDataAccess,
	listPersonalDataExports: mocks.listPersonalDataExports,
	requestPersonalDataExport: mocks.requestPersonalDataExport,
	authorizePersonalDataExportDownload: mocks.authorizePersonalDataExportDownload,
}));
vi.mock("@/lib/personal-data-export/enqueue-effect", () => ({
	enqueuePersonalDataExportBuild: mocks.enqueuePersonalDataExportBuild,
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	isExportS3Configured: mocks.isExportS3Configured,
	getPrivateObjectPresignedUrl: mocks.getPrivateObjectPresignedUrl,
}));

const { Effect } = await import("effect");
const { getMyDataOverview, getPersonalDataExportDownloadUrl, requestMyPersonalDataExport } =
	await import("./actions");

const orgMember: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};
const orgAdmin: StubCaller = { ...orgMember, membershipRole: "admin" };
/** One level below org member: no settings access at all. */
const pendingMember: StubCaller = { ...orgMember, membershipRole: null };
/** Their route to their personal data is an admin export (Organization glossary). */
const formerEmployee: StubCaller = {
	...orgMember,
	employee: { id: "employee-1", role: "employee", former: true },
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgMember;
	mocks.resolveMyDataAccess.mockResolvedValue({ status: "available", employeeId: "employee-1" });
	mocks.listPersonalDataExports.mockResolvedValue([]);
	mocks.isExportS3Configured.mockResolvedValue(true);
	mocks.requestPersonalDataExport.mockResolvedValue({ ok: true, exportId: "export-1" });
	mocks.enqueuePersonalDataExportBuild.mockReturnValue(Effect.void);
	mocks.authorizePersonalDataExportDownload.mockResolvedValue({
		ok: true,
		object: { key: "k" },
		fileName: "export.zip",
	});
	mocks.getPrivateObjectPresignedUrl.mockResolvedValue("https://files.example.test/export.zip");
});

describe("getMyDataOverview", () => {
	it("lists the signed-in employee's own exports in the active organization", async () => {
		await expect(getMyDataOverview()).resolves.toEqual({
			success: true,
			data: { status: "available", exports: [] },
		});
		expect(mocks.listPersonalDataExports).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				kind: "employee",
			}),
		);
	});

	it("says when the user has no employee record here", async () => {
		mocks.resolveMyDataAccess.mockResolvedValue({ status: "no_employee_record" });

		await expect(getMyDataOverview()).resolves.toEqual({
			success: true,
			data: { status: "no_employee_record" },
		});
	});

	it.each([
		["a pending membership", pendingMember],
		["a former employee", formerEmployee],
	])("refuses %s", async (_name, caller) => {
		mocks.caller = caller;

		await expect(getMyDataOverview()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.resolveMyDataAccess).not.toHaveBeenCalled();
	});
});

describe("requestMyPersonalDataExport", () => {
	it("starts an employee export of the signed-in employee", async () => {
		await expect(requestMyPersonalDataExport()).resolves.toEqual({
			success: true,
			data: { exportId: "export-1" },
		});
		expect(mocks.requestPersonalDataExport).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: "employee-1",
				kind: "employee",
				requestedByUserId: "user-1",
			}),
		);
	});

	it("refuses a second export within 24 hours with its refusal", async () => {
		mocks.requestPersonalDataExport.mockResolvedValue({ ok: false, reason: "daily_limit" });

		await expect(requestMyPersonalDataExport()).resolves.toMatchObject({
			success: false,
			refusal: "daily_limit",
		});
	});

	it("refuses a pending membership", async () => {
		mocks.caller = pendingMember;

		await expect(requestMyPersonalDataExport()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.requestPersonalDataExport).not.toHaveBeenCalled();
	});
});

describe("getPersonalDataExportDownloadUrl", () => {
	it("signs a short-lived URL for an export the user may download", async () => {
		await expect(getPersonalDataExportDownloadUrl("export-1")).resolves.toEqual({
			success: true,
			data: { url: "https://files.example.test/export.zip" },
		});
		expect(mocks.authorizePersonalDataExportDownload).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "org-1",
				exportId: "export-1",
				actor: { userId: "user-1", isOrganizationAdmin: false },
			}),
		);
	});

	it("lets an org admin download admin exports", async () => {
		mocks.caller = orgAdmin;

		await getPersonalDataExportDownloadUrl("export-1");

		expect(mocks.authorizePersonalDataExportDownload).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ actor: { userId: "user-1", isOrganizationAdmin: true } }),
		);
	});

	it("reads another organization's or someone else's export as not found", async () => {
		mocks.authorizePersonalDataExportDownload.mockResolvedValue({ ok: false, reason: "not_found" });

		await expect(getPersonalDataExportDownloadUrl("export-2")).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("refuses a pending membership", async () => {
		mocks.caller = pendingMember;

		await expect(getPersonalDataExportDownloadUrl("export-1")).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.authorizePersonalDataExportDownload).not.toHaveBeenCalled();
	});
});
