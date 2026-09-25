import { describe, expect, it, vi } from "vitest";
import type { DecisionEvidenceRecord } from "@/lib/approvals/evidence/store";
import { parseInstant } from "@/lib/datetime/temporal-core";

vi.mock("@/lib/notifications/recipient-display-context", () => ({
	resolveRecipientDisplayContext: async () => ({
		locale: "en",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	}),
}));
vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: async () => (_key: string, fallback: string, params?: Record<string, string>) =>
		fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
}));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async () => "https://org.z8.test",
}));

const { boundDecisionNotice } = await import("./approval-notice");

const recipient = { userId: "u", organizationId: "org" };
const reference = { kind: "compatibility" as const, approvalRequestId: "r" };

function decided(
	outcome: Pick<DecisionEvidenceRecord, "assignmentOutcome" | "requestOutcome">,
	replayed = false,
) {
	return {
		status: "decided" as const,
		replayed,
		evidence: {
			...outcome,
			decidedAt: parseInstant("2026-08-01T08:15:00Z"),
			labels: { actorName: "Morgan Manager" },
		} as DecisionEvidenceRecord,
	};
}

describe("boundDecisionNotice", () => {
	it.each([
		[
			{ assignmentOutcome: "approved", requestOutcome: "approved" },
			"Request approved",
			"Approved by Morgan Manager on Aug 1, 2026, 10:15 (Europe/Berlin). The request is approved.",
		],
		[
			{ assignmentOutcome: "rejected", requestOutcome: "rejected" },
			"Request rejected",
			"Rejected by Morgan Manager on Aug 1, 2026, 10:15 (Europe/Berlin). The request is rejected.",
		],
		[
			{ assignmentOutcome: "approved", requestOutcome: "pending" },
			"Approval recorded",
			"Approved by Morgan Manager on Aug 1, 2026, 10:15 (Europe/Berlin). The request still awaits further approval.",
		],
		[
			{ assignmentOutcome: "rejected", requestOutcome: "pending" },
			"Rejection recorded",
			"Rejected by Morgan Manager on Aug 1, 2026, 10:15 (Europe/Berlin). The request is not final yet; review its current status in Z8.",
		],
		[
			{ assignmentOutcome: null, requestOutcome: "cancelled" },
			"Decision recorded",
			"Recorded by Morgan Manager on Aug 1, 2026, 10:15 (Europe/Berlin). Review the request's current status in Z8.",
		],
	] as const)(
		"reports the step and request outcome truthfully (%o)",
		async (outcome, title, text) => {
			const notice = await boundDecisionNotice(decided(outcome), recipient, reference);
			expect(notice).toMatchObject({ title, text });
		},
	);

	it("labels a replay as the original result", async () => {
		const notice = await boundDecisionNotice(
			decided({ assignmentOutcome: "approved", requestOutcome: "approved" }, true),
			recipient,
			reference,
		);
		expect(notice?.text).toContain("this is its original result");
	});

	it("never reports a decision for review, conflict or not-found results", async () => {
		for (const status of ["review_required", "not_found", "conflict"] as const) {
			const notice = await boundDecisionNotice({ status }, recipient, reference);
			expect(notice?.title).toBe("Review required");
			expect(notice?.text).toContain("No decision was made");
		}
	});
});
