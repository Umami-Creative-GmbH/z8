import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

const { telegramActionableCard } = await import("@/lib/telegram/approval-handler");
const { teamsActionableCard } = await import("@/lib/teams/approval-handler");

const reviewUrl = "https://org.z8.test/approvals/review/org/canonical/assignment";

const card = {
	status: "actionable" as const,
	recipientUserId: "user",
	title: "Period submission",
	facts: [{ label: "Employee", value: "Avery" }],
	text: "Approve decides exactly the period shown above.",
	reviewLabel: "Review in Z8",
	reviewUrl,
	bindingId: "b2920000-0000-4000-8000-000000000001",
	approveLabel: "Approve",
	rejectLabel: "Reject in Z8",
	rejectInReview: true as const,
};

describe("a card whose rejection needs a reason", () => {
	it("links Reject to the review on Telegram, keeping Approve bound", () => {
		const [controls] = telegramActionableCard(card).reply_markup?.inline_keyboard ?? [];
		expect(controls?.[0]).toMatchObject({ text: "Approve", callback_data: expect.any(String) });
		expect(controls?.[1]).toEqual({ text: "Reject in Z8", url: reviewUrl });
	});

	it("opens the review from Reject on Teams, keeping Approve bound", () => {
		const { actions } = teamsActionableCard(card) as { actions: Array<Record<string, unknown>> };
		expect(actions[0]).toMatchObject({ type: "Action.Execute", title: "Approve" });
		expect(actions[1]).toEqual({ type: "Action.OpenUrl", title: "Reject in Z8", url: reviewUrl });
	});
});
