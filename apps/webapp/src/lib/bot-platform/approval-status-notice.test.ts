import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

vi.mock("@/lib/bot-platform/i18n", () => ({
	getBotTranslate: async () => (_key: string, fallback: string, params?: Record<string, string>) =>
		fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
}));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async () => "https://org.z8.test",
}));

const { approvalStatusNotice } = await import("./approval-notice");

const display = { locale: "en", timezone: "Europe/Berlin", timeFormat: "24h" as const };
const reference = { kind: "compatibility" as const, approvalRequestId: "r" };

function evidence(
	assignmentOutcome: "approved" | "rejected",
	requestOutcome: "approved" | "rejected" | "pending",
) {
	return {
		assignmentOutcome,
		requestOutcome,
		decidedAt: parseInstant("2026-08-01T08:15:00Z"),
		labels: { actorName: "Morgan Manager" },
	};
}

describe("approvalStatusNotice", () => {
	it("reports the recipient's own committed outcome", async () => {
		const notice = await approvalStatusNotice(
			{ workflowStatus: "approved", evidence: evidence("approved", "approved") },
			display,
			"org",
			reference,
		);
		expect(notice).toEqual({
			title: "Request approved",
			text: "Approved by Morgan Manager on Aug 1, 2026, 10:15 (Europe/Berlin). The request is approved.",
			reviewLabel: "Review in Z8",
			reviewUrl: "https://org.z8.test/approvals/review/org/compatibility/r",
		});
	});

	it("states a later request result separately from the recorded step", async () => {
		const notice = await approvalStatusNotice(
			{ workflowStatus: "rejected", evidence: evidence("approved", "pending") },
			display,
			"org",
			reference,
		);
		expect(notice.title).toBe("Approval recorded");
		expect(notice.text).toBe(
			"Approved by Morgan Manager on Aug 1, 2026, 10:15 (Europe/Berlin). The request still awaits further approval.\n\nCurrent request status: rejected.",
		);
	});

	it("reports a withdrawn request without its facts", async () => {
		const notice = await approvalStatusNotice(
			{ workflowStatus: "cancelled", evidence: null },
			display,
			"org",
			reference,
		);
		expect(notice.title).toBe("Request withdrawn");
	});

	it("tells a recipient whose assignment ended elsewhere only that the card is inactive", async () => {
		const notice = await approvalStatusNotice(
			{ workflowStatus: "approved", evidence: null },
			display,
			"org",
			reference,
		);
		expect(notice.title).toBe("No longer actionable");
		expect(notice.text).not.toContain("approved");
	});

	it("discloses no outcome to a recipient who is no longer entitled", async () => {
		const notice = await approvalStatusNotice(
			{ workflowStatus: "approved", evidence: evidence("approved", "approved") },
			null,
			"org",
			reference,
		);
		expect(notice.title).toBe("No longer actionable");
		expect(notice.text).not.toContain("Morgan");
	});
});
