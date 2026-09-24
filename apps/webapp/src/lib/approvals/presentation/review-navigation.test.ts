import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	organizationBaseUrl: vi.fn(),
}));

vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: state.organizationBaseUrl,
}));

const { approvalReviewPath, approvalReviewUrl, parseApprovalReviewTarget } = await import(
	"./review-navigation"
);

const APPROVAL_ID = "4b2d8a6e-1f3c-4a5b-9c7d-0e1f2a3b4c5d";

describe("approval review navigation", () => {
	beforeEach(() => {
		state.organizationBaseUrl.mockReset();
		state.organizationBaseUrl.mockResolvedValue("https://acme.z8.example");
	});

	it("builds an organization-scoped path for a compatibility approval", () => {
		expect(
			approvalReviewPath({
				organizationId: "org_1",
				reference: { kind: "compatibility", approvalRequestId: APPROVAL_ID },
			}),
		).toBe(`/approvals/review/org_1/compatibility/${APPROVAL_ID}`);
	});

	it("builds an organization-scoped path for a canonical assignment", () => {
		expect(
			approvalReviewPath({
				organizationId: "org_1",
				reference: { kind: "canonical", assignmentId: APPROVAL_ID },
			}),
		).toBe(`/approvals/review/org_1/canonical/${APPROVAL_ID}`);
	});

	it("encodes path segments instead of trusting identifiers", () => {
		expect(
			approvalReviewPath({
				organizationId: "org/../x",
				reference: { kind: "compatibility", approvalRequestId: "a?b" },
			}),
		).toBe("/approvals/review/org%2F..%2Fx/compatibility/a%3Fb");
	});

	it("builds an absolute URL on the organization's application origin", async () => {
		await expect(
			approvalReviewUrl({
				organizationId: "org_1",
				reference: { kind: "compatibility", approvalRequestId: APPROVAL_ID },
			}),
		).resolves.toBe(`https://acme.z8.example/approvals/review/org_1/compatibility/${APPROVAL_ID}`);
		expect(state.organizationBaseUrl).toHaveBeenCalledWith("org_1");
	});

	it("parses the receiving route parameters back into the exact target", () => {
		expect(
			parseApprovalReviewTarget({
				organizationId: "org_1",
				kind: "canonical",
				id: APPROVAL_ID.toUpperCase(),
			}),
		).toEqual({
			organizationId: "org_1",
			reference: { kind: "canonical", assignmentId: APPROVAL_ID },
		});
		expect(
			parseApprovalReviewTarget({
				organizationId: "org_1",
				kind: "compatibility",
				id: APPROVAL_ID,
			}),
		).toEqual({
			organizationId: "org_1",
			reference: { kind: "compatibility", approvalRequestId: APPROVAL_ID },
		});
	});

	it.each([
		{ organizationId: "org_1", kind: "inbox", id: APPROVAL_ID },
		{ organizationId: "org_1", kind: "compatibility", id: "not-a-uuid" },
		{ organizationId: "", kind: "canonical", id: APPROVAL_ID },
		{ organizationId: "org 1", kind: "canonical", id: APPROVAL_ID },
		{ organizationId: "org_1", kind: "canonical", id: `${APPROVAL_ID}x` },
	])("rejects malformed targets %o", (params) => {
		expect(parseApprovalReviewTarget(params)).toBeNull();
	});
});
