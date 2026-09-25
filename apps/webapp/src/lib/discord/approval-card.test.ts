import { describe, expect, it } from "vitest";
import { discordApprovalNotice } from "@/lib/bot-platform/approval-notice";
import { discordActionableCard, fitsDiscordMessage } from "./approval-card";
import { parseBoundApprovalCustomId } from "./bound-approval";

const bindingId = "b2920000-0000-4000-8000-000000000001";
const reviewUrl = "https://org.z8.test/approvals/review/org/compatibility/r";

const card = {
	status: "actionable" as const,
	recipientUserId: "user",
	title: "Absence approval request",
	facts: [
		{ label: "Employee", value: "[Avery](https://evil.test) @everyone" },
		{ label: "Dates", value: "5 Oct 2026 – 6 Oct 2026" },
	],
	text: "Approve or reject the request shown above.",
	reviewLabel: "Review in Z8",
	reviewUrl,
	bindingId,
	approveLabel: "Approve",
	rejectLabel: "Reject",
};

describe("Discord bound card layout", () => {
	it("renders controls that carry only the binding handle, plus a review link", () => {
		const payload = discordActionableCard(card);
		const buttons = payload.components?.flatMap((row) => row.components) ?? [];
		expect(buttons.map((button) => button.label)).toEqual(["Approve", "Reject", "Review in Z8"]);
		expect(parseBoundApprovalCustomId(buttons[0]?.custom_id ?? "")).toEqual({
			action: "approve",
			bindingId,
		});
		expect(parseBoundApprovalCustomId(buttons[1]?.custom_id ?? "")).toEqual({
			action: "reject",
			bindingId,
		});
		expect(buttons[2]).toMatchObject({ style: 5, url: reviewUrl });
		expect(buttons[2]?.custom_id).toBeUndefined();
		expect(payload.allowed_mentions).toEqual({ parse: [] });
	});

	it("shows provider-visible text literally, never as markdown links", () => {
		const content = discordActionableCard(card).content ?? "";
		expect(content).toContain("\\[Avery\\]\\(https://evil.test\\) @everyone");
		expect(content).not.toContain("[Avery](");
	});

	it("keeps an oversized card or control label out of the actionable layout", () => {
		expect(fitsDiscordMessage(card)).toBe(true);
		expect(fitsDiscordMessage({ ...card, text: "x".repeat(2000) })).toBe(false);
		expect(fitsDiscordMessage({ ...card, approveLabel: "A".repeat(81) })).toBe(false);
		expect(fitsDiscordMessage({ ...card, reviewUrl: `${reviewUrl}${"x".repeat(512)}` })).toBe(
			false,
		);
	});
});

describe("Discord status notice", () => {
	it("replaces every control with the review link only", () => {
		const notice = discordApprovalNotice({
			title: "Request approved",
			text: "Approved by Morgan_Manager on 1 Aug 2026, 10:15 (Europe/Berlin).",
			reviewLabel: "Review in Z8",
			reviewUrl,
		});
		const buttons = notice.components.flatMap((row) => row.components);
		expect(buttons).toEqual([{ type: 2, style: 5, label: "Review in Z8", url: reviewUrl }]);
		expect(notice.content).toContain("Morgan\\_Manager");
		expect(notice.allowed_mentions).toEqual({ parse: [] });
	});
});
