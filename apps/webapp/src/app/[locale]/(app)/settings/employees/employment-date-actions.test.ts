import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	db: { name: "scoped-db" },
	previewEmploymentDateCorrection: vi.fn(),
	commitEmploymentDateCorrection: vi.fn(),
	refreshEmploymentDateResults: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db: mocks.db }));
});
vi.mock("@/lib/employee-lifecycle/employment-date-correction", () => ({
	previewEmploymentDateCorrection: mocks.previewEmploymentDateCorrection,
	commitEmploymentDateCorrection: mocks.commitEmploymentDateCorrection,
}));
vi.mock("@/lib/employee-lifecycle/employment-date-refresh", () => ({
	refreshEmploymentDateResults: mocks.refreshEmploymentDateResults,
}));

const { TrackingDateRefusal } = await import("@/lib/time-tracking/tracking-date-review-types");
const actions = await import("./employment-date-actions");

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";
const orgAdmin: StubCaller = {
	userId: "admin-user",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "manager-user",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};
const correction = { employeeId: EMPLOYEE_ID, employmentStartDate: "2024-01-01" };
const commit = { ...correction, fingerprint: "f", reason: "Signed contract" };

describe("employment date correction actions (#1613)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
	});

	it("previews and commits an org admin's correction in the session's organization", async () => {
		mocks.previewEmploymentDateCorrection.mockResolvedValue({ fingerprint: "f" });
		mocks.commitEmploymentDateCorrection.mockResolvedValue({ employees: [] });
		mocks.refreshEmploymentDateResults.mockResolvedValue(true);

		await expect(actions.previewEmploymentDateCorrectionAction(correction)).resolves.toEqual({
			success: true,
			data: { fingerprint: "f" },
		});
		expect(mocks.previewEmploymentDateCorrection).toHaveBeenCalledWith(
			mocks.db,
			expect.objectContaining({
				...correction,
				organizationId: "org-1",
				actorUserId: "admin-user",
			}),
		);
		await expect(actions.commitEmploymentDateCorrectionAction(commit)).resolves.toEqual({
			success: true,
			data: { status: "committed", refreshPending: true },
		});
		expect(mocks.refreshEmploymentDateResults).toHaveBeenCalledWith("org-1", { employees: [] });
	});

	it("refuses a scoped manager, one level below an org admin", async () => {
		mocks.caller = scopedManager;

		await expect(actions.previewEmploymentDateCorrectionAction(correction)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		await expect(actions.commitEmploymentDateCorrectionAction(commit)).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.previewEmploymentDateCorrection).not.toHaveBeenCalled();
		expect(mocks.commitEmploymentDateCorrection).not.toHaveBeenCalled();
	});

	it("returns a blocked correction as its refusal", async () => {
		mocks.previewEmploymentDateCorrection.mockRejectedValue(
			new TrackingDateRefusal("blocked", "Activate reviewed tracking dates first."),
		);

		await expect(actions.previewEmploymentDateCorrectionAction(correction)).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "blocked",
		});
	});
});
