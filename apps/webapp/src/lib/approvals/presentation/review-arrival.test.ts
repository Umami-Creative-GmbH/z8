import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	findMember: vi.fn(),
	loadDetail: vi.fn(),
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/db", () => ({
	db: { query: { member: { findFirst: state.findMember } } },
}));
vi.mock("@/lib/approvals/inbox/authorized-detail", () => ({
	loadAuthorizedApprovalDetail: state.loadDetail,
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => state.logger }));

const { resolveApprovalReviewArrival } = await import("./review-arrival");

const ASSIGNMENT_ID = "4b2d8a6e-1f3c-4a5b-9c7d-0e1f2a3b4c5d";
const item = { id: ASSIGNMENT_ID, status: "pending" };

const canonicalTarget = {
	organizationId: "org-1",
	reference: { kind: "canonical" as const, assignmentId: ASSIGNMENT_ID },
};

describe("resolveApprovalReviewArrival", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		state.findMember.mockResolvedValue({
			id: "member-1",
			organization: { name: "Acme" },
		});
		state.loadDetail.mockResolvedValue({
			status: "found",
			detail: { item, sections: [], actions: {} },
		});
	});

	it("opens the exact canonical item after rechecking current entitlement", async () => {
		await expect(
			resolveApprovalReviewArrival({
				userId: "user-1",
				activeOrganizationId: "org-1",
				target: canonicalTarget,
			}),
		).resolves.toEqual({ status: "ready", item });
		expect(state.loadDetail).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
			approvalId: ASSIGNMENT_ID,
			kind: "canonical",
		});
	});

	it("passes a compatibility reference through as its exact kind", async () => {
		await resolveApprovalReviewArrival({
			userId: "user-1",
			activeOrganizationId: "org-1",
			target: {
				organizationId: "org-1",
				reference: { kind: "compatibility", approvalRequestId: ASSIGNMENT_ID },
			},
		});
		expect(state.loadDetail).toHaveBeenCalledWith(
			expect.objectContaining({ kind: "compatibility" }),
		);
	});

	it("asks a member to switch organizations without loading any approval facts", async () => {
		await expect(
			resolveApprovalReviewArrival({
				userId: "user-1",
				activeOrganizationId: "org-2",
				target: canonicalTarget,
			}),
		).resolves.toEqual({
			status: "switch_organization",
			organizationId: "org-1",
			organizationName: "Acme",
		});
		expect(state.loadDetail).not.toHaveBeenCalled();
	});

	it("treats a cross-organization link as unavailable for non-members", async () => {
		state.findMember.mockResolvedValue(undefined);
		await expect(
			resolveApprovalReviewArrival({
				userId: "user-1",
				activeOrganizationId: "org-2",
				target: canonicalTarget,
			}),
		).resolves.toEqual({ status: "unavailable" });
		expect(state.loadDetail).not.toHaveBeenCalled();
	});

	it("treats a malformed target as unavailable without any lookups", async () => {
		await expect(
			resolveApprovalReviewArrival({
				userId: "user-1",
				activeOrganizationId: "org-1",
				target: null,
			}),
		).resolves.toEqual({ status: "unavailable" });
		expect(state.findMember).not.toHaveBeenCalled();
	});

	it.each(["forbidden", "not_found", "no_employee", "unsupported_type"])(
		"reports %s as the same unavailable outcome",
		async (status) => {
			state.loadDetail.mockResolvedValue({ status });
			await expect(
				resolveApprovalReviewArrival({
					userId: "user-1",
					activeOrganizationId: "org-1",
					target: canonicalTarget,
				}),
			).resolves.toEqual({ status: "unavailable" });
		},
	);

	it("propagates infrastructure failures instead of claiming the item is missing", async () => {
		state.loadDetail.mockRejectedValue(new Error("db down"));
		await expect(
			resolveApprovalReviewArrival({
				userId: "user-1",
				activeOrganizationId: "org-1",
				target: canonicalTarget,
			}),
		).rejects.toThrow("db down");
	});
});
