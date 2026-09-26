import { describe, expect, it } from "vitest";
import { fitsSlackApprovalCard, slackApprovalCard } from "./approval-card";

const notice = {
	title: "Request approved",
	text: "Approved by Morgan Manager on Oct 5, 2026, 10:00 (Europe/Berlin). The request is approved.",
	reviewLabel: "Review in Z8",
	reviewUrl: "https://z8.example.test/approvals/inbox?item=r-1",
};

const summary = {
	...notice,
	title: "Absence approval request",
	facts: [
		{ label: "Employee", value: "Avery <!channel> Requester" },
		{ label: "Category", value: "Vacation & *travel*" },
	],
	text: "Decide this request in Z8. Slack cannot approve or reject it.",
};

type Block = { type: string; text?: { type: string; text: string }; elements?: unknown[] };

describe("Slack approval card", () => {
	it("renders the submitted facts as plain text with only a review link", () => {
		const card = slackApprovalCard(summary);
		const blocks = card.blocks as Block[];
		expect(blocks.map((block) => block.type)).toEqual(["header", "section", "section", "actions"]);
		expect(blocks[1]?.text).toEqual({
			type: "plain_text",
			text: "Employee: Avery <!channel> Requester\nCategory: Vacation & *travel*",
		});
		// No approve/reject controls: the one element opens the exact item.
		expect(blocks[3]?.elements).toEqual([
			{
				type: "button",
				text: { type: "plain_text", text: "Review in Z8" },
				url: notice.reviewUrl,
				action_id: "approval_review",
			},
		]);
		expect(JSON.stringify(card)).not.toContain("approval_approve");
	});

	it("escapes the notification fallback so user text cannot mention or link", () => {
		const { text } = slackApprovalCard(summary);
		expect(text).toContain("Avery &lt;!channel&gt; Requester");
		expect(text).toContain("Vacation &amp; *travel*");
		expect(text).not.toContain("<!channel>");
	});

	it("renders a status notice without facts", () => {
		const blocks = slackApprovalCard(notice).blocks as Block[];
		expect(blocks.map((block) => block.type)).toEqual(["header", "section", "actions"]);
		expect(blocks[1]?.text?.text).toBe(notice.text);
	});

	it("does not fit when any essential field would be truncated by Slack", () => {
		expect(fitsSlackApprovalCard(summary)).toBe(true);
		expect(fitsSlackApprovalCard({ ...summary, title: "x".repeat(151) })).toBe(false);
		expect(
			fitsSlackApprovalCard({
				...summary,
				facts: [{ label: "Employee", value: "y".repeat(3000) }],
			}),
		).toBe(false);
		expect(fitsSlackApprovalCard({ ...summary, reviewLabel: "z".repeat(76) })).toBe(false);
		expect(
			fitsSlackApprovalCard({ ...summary, reviewUrl: `https://z8.test/${"a".repeat(3000)}` }),
		).toBe(false);
	});
});
