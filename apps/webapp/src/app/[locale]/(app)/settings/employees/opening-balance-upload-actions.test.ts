import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	db: { name: "scoped-db" },
	previewOpeningBalanceUpload: vi.fn(),
	commitOpeningBalanceUpload: vi.fn(),
	revalidateWorkBalancePaths: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: mocks.db }));
});
vi.mock("@/lib/work-balance/adjustments/opening-balance-upload", () => ({
	previewOpeningBalanceUpload: mocks.previewOpeningBalanceUpload,
	commitOpeningBalanceUpload: mocks.commitOpeningBalanceUpload,
}));
vi.mock("./work-balance-paths", () => ({
	revalidateWorkBalancePaths: mocks.revalidateWorkBalancePaths,
}));

const actions = await import("./opening-balance-upload-actions");

const orgAdmin: StubCaller = {
	userId: "admin-user",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
/** One level below an org member: a membership that is not approved yet. */
const pendingMember: StubCaller = { ...orgAdmin, userId: "pending-user", membershipRole: null };

describe("opening balance upload actions (#999, #1613)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
	});

	it("previews an org admin's upload in the session's organization", async () => {
		mocks.previewOpeningBalanceUpload.mockResolvedValue({ status: "ready", rows: [] });

		await expect(actions.previewOpeningBalanceUploadAction({ csv: "a,b" })).resolves.toEqual({
			success: true,
			data: { status: "ready", rows: [] },
		});
		expect(mocks.previewOpeningBalanceUpload).toHaveBeenCalledWith(
			mocks.db,
			expect.objectContaining({
				organizationId: "org-1",
				actorUserId: "admin-user",
				authority: { via: "organization_admin" },
				csv: "a,b",
			}),
		);
	});

	it("commits and refreshes the written employees' work balances", async () => {
		mocks.commitOpeningBalanceUpload.mockResolvedValue({
			status: "committed",
			rows: [{ employee: { id: "employee-1" } }, { employee: null }],
		});

		await expect(actions.commitOpeningBalanceUploadAction({ csv: "a,b" })).resolves.toMatchObject({
			success: true,
		});
		expect(mocks.revalidateWorkBalancePaths).toHaveBeenCalledWith(["employee-1"]);
	});

	it("refuses a pending membership, one level below an org member", async () => {
		mocks.caller = pendingMember;

		await expect(actions.previewOpeningBalanceUploadAction({ csv: "a,b" })).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		await expect(actions.commitOpeningBalanceUploadAction({ csv: "a,b" })).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.previewOpeningBalanceUpload).not.toHaveBeenCalled();
		expect(mocks.commitOpeningBalanceUpload).not.toHaveBeenCalled();
	});

	it("refuses a file that is not text", async () => {
		await expect(
			actions.previewOpeningBalanceUploadAction({ csv: 1 as unknown as string }),
		).resolves.toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.previewOpeningBalanceUpload).not.toHaveBeenCalled();
	});
});
