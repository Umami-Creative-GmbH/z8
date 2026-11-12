import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	db: { name: "scoped-db" },
	previewEmploymentDateUpload: vi.fn(),
	commitEmploymentDateUpload: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: mocks.db }));
});
vi.mock("@/lib/employee-lifecycle/employment-date-upload", () => ({
	previewEmploymentDateUpload: mocks.previewEmploymentDateUpload,
	commitEmploymentDateUpload: mocks.commitEmploymentDateUpload,
}));

const actions = await import("./employment-date-upload-actions");

const orgAdmin: StubCaller = {
	userId: "admin-user",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "manager-user",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};

describe("employment date upload actions (#1613)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
	});

	it("previews and commits an org admin's upload in the session's organization", async () => {
		mocks.previewEmploymentDateUpload.mockResolvedValue({ status: "ready", fingerprint: "f" });
		mocks.commitEmploymentDateUpload.mockResolvedValue({ status: "committed", corrected: 2 });

		await expect(actions.previewEmploymentDateUploadAction({ csv: "a,b" })).resolves.toEqual({
			success: true,
			data: { status: "ready", fingerprint: "f" },
		});
		expect(mocks.previewEmploymentDateUpload).toHaveBeenCalledWith(
			mocks.db,
			expect.objectContaining({ organizationId: "org-1", actorUserId: "admin-user", csv: "a,b" }),
		);
		await expect(
			actions.commitEmploymentDateUploadAction({ csv: "a,b", fingerprint: "f" }),
		).resolves.toMatchObject({ success: true, data: { corrected: 2 } });
		expect(mocks.commitEmploymentDateUpload).toHaveBeenCalledWith(
			mocks.db,
			expect.objectContaining({ organizationId: "org-1", fingerprint: "f" }),
		);
	});

	it("refuses a scoped manager, one level below an org admin", async () => {
		mocks.caller = scopedManager;

		await expect(actions.previewEmploymentDateUploadAction({ csv: "a,b" })).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		await expect(
			actions.commitEmploymentDateUploadAction({ csv: "a,b", fingerprint: "f" }),
		).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.previewEmploymentDateUpload).not.toHaveBeenCalled();
		expect(mocks.commitEmploymentDateUpload).not.toHaveBeenCalled();
	});

	it("refuses a file that is not text with the readable-file message", async () => {
		await expect(
			actions.previewEmploymentDateUploadAction({ csv: null as unknown as string }),
		).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Choose a readable CSV file.",
		});
	});
});
