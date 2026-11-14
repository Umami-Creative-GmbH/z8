import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
	env: {
		BETTER_AUTH_SECRET: "test-secret",
		SCIM_CREDENTIAL_HASH_SECRET: "test-scim-credential-hash-secret-value",
		S3_PUBLIC_BUCKET: "test-bucket",
		S3_PUBLIC_ACCESS_KEY_ID: "test-access-key",
		S3_PUBLIC_SECRET_ACCESS_KEY: "test-secret-key",
		S3_PUBLIC_ENDPOINT: "https://example.com",
		S3_PUBLIC_URL: "https://example.com",
		S3_PUBLIC_REGION: "us-east-1",
		S3_PUBLIC_FORCE_PATH_STYLE: "true",
		NODE_ENV: "test",
	},
}));

// Card decisions themselves are verified against PostgreSQL at the time
// approval decision's interface (time-approval-decision.integration.test.ts)
// and through the bots (telegram/legacy-time-bound-approval.integration.test.ts).
// This suite covers only the card adapter's translation.
const mocks = vi.hoisted(() => ({
	decideTimeApproval: vi.fn(),
	findCommittedInvocationDecision: vi.fn(),
	loadLegacyReviewBinding: vi.fn(),
	loadLegacySubmittedRevisionSource: vi.fn(),
}));
vi.mock("./time-approval-decision", () => ({ decideTimeApproval: mocks.decideTimeApproval }));
vi.mock("../evidence/invocation", async (importOriginal) => ({
	...(await importOriginal<typeof import("../evidence/invocation")>()),
	findCommittedInvocationDecision: mocks.findCommittedInvocationDecision,
}));
vi.mock("../evidence/store", async (importOriginal) => ({
	...(await importOriginal<typeof import("../evidence/store")>()),
	loadLegacyReviewBinding: mocks.loadLegacyReviewBinding,
	loadLegacySubmittedRevisionSource: mocks.loadLegacySubmittedRevisionSource,
}));

import { decideBoundLegacyTimeInvocation } from "./time-bound-decision";

const actor = {
	id: "manager-1",
	organizationId: "org-1",
	userId: "manager-user-1",
	user: { id: "manager-user-1" },
};
const database = {
	select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: "member-1" }] }) }) }),
	query: { employee: { findMany: async () => [actor] } },
};
const legacyEvidence = {
	id: "evidence-1",
	authority: "legacy",
	reviewedBindingId: "binding-1",
	legacy: { approvalRequestId: "request-1" },
};

function press() {
	return decideBoundLegacyTimeInvocation({
		database: database as never,
		organizationId: "org-1",
		actorEmployeeId: "manager-1",
		actorUserId: "manager-user-1",
		bindingId: "binding-1",
		action: "approve",
		invocation: {
			identity: {
				organizationId: "org-1",
				scheme: "telegram_callback_query",
				schemeVersion: 1,
				receiverScope: "telegram-bot:1",
				invocationId: "update-1",
			},
			deliveryId: null,
			providerActorId: "provider-actor-1",
		},
	});
}

describe("legacy time card adapter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findCommittedInvocationDecision.mockResolvedValue(null);
		mocks.loadLegacyReviewBinding.mockResolvedValue({
			id: "binding-1",
			authority: "legacy",
			organizationId: "org-1",
			recipientEmployeeId: "manager-1",
			legacyApprovalRequestId: "request-1",
			submittedRevisionId: "revision-1",
		});
		mocks.loadLegacySubmittedRevisionSource.mockResolvedValue({
			workflowType: "manual_time_submission",
			sourceType: "time_entry",
			sourceId: "period-1",
		});
	});

	it("claims the recipient's right as approver for the binding's exact request", async () => {
		mocks.decideTimeApproval.mockResolvedValue({
			status: "decided",
			kind: "manual_time_submission",
			workPeriodId: "period-1",
			outcome: "approved",
			replayed: false,
			receipt: legacyEvidence,
		});

		expect(await press()).toEqual({ status: "decided", replayed: false, evidence: legacyEvidence });
		expect(mocks.decideTimeApproval).toHaveBeenCalledWith(
			expect.objectContaining({
				approvalId: "request-1",
				right: { as: "approver" },
				card: expect.objectContaining({ reviewedBindingId: "binding-1" }),
			}),
		);
	});

	it("claims covering deputy for the absent approver a deputy card names", async () => {
		mocks.loadLegacyReviewBinding.mockResolvedValue({
			id: "binding-1",
			authority: "legacy",
			organizationId: "org-1",
			recipientEmployeeId: "manager-1",
			legacyApprovalRequestId: "request-1",
			submittedRevisionId: "revision-1",
			actingForEmployeeId: "approver-1",
		});
		mocks.decideTimeApproval.mockResolvedValue({ status: "refused", reason: "right_not_held" });

		await press();

		expect(mocks.decideTimeApproval).toHaveBeenCalledWith(
			expect.objectContaining({ right: { as: "covering_deputy", forEmployeeId: "approver-1" } }),
		);
	});

	it.each([
		["binding_mismatch", { status: "review_required", reason: "binding" }],
		["not_admitted", { status: "review_required", reason: "not_admitted" }],
		["invocation_conflict", { status: "conflict" }],
		["reassigned", { status: "review_required", reason: "reassigned" }],
		["evidence_required", { status: "review_required", reason: "evidence" }],
		["not_found", { status: "review_required", reason: "stale" }],
		["already_decided", { status: "review_required", reason: "stale" }],
		["right_not_held", { status: "review_required", reason: "stale" }],
		["own_request", { status: "review_required", reason: "stale" }],
		["changed", { status: "review_required", reason: "stale" }],
		["month_closed", { status: "review_required", reason: "stale" }],
		["unclassified", { status: "review_required", reason: "stale" }],
	] as const)("shows a %s refusal as %o", async (reason, outcome) => {
		mocks.decideTimeApproval.mockResolvedValue({ status: "refused", reason });

		expect(await press()).toEqual(outcome);
	});

	it("returns an exact committed invocation without deciding again", async () => {
		mocks.findCommittedInvocationDecision.mockResolvedValue(legacyEvidence);

		expect(await press()).toEqual({ status: "decided", replayed: true, evidence: legacyEvidence });
		expect(mocks.decideTimeApproval).not.toHaveBeenCalled();
		expect(mocks.loadLegacyReviewBinding).not.toHaveBeenCalled();
	});
});
