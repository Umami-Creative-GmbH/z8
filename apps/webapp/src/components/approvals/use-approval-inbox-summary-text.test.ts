import { beforeEach, describe, expect, it, vi } from "vitest";

/** Tolgee as a viewer without translations sees it: the fallback, its `{name}`s filled in. */
const t = vi.hoisted(() =>
	vi.fn((_key: string, fallback: string, params?: Record<string, string | number>) =>
		fallback.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
			params && name in params ? String(params[name]) : placeholder,
		),
	),
);

vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t }) }));

const { useApprovalInboxSummaryText } = await import("./use-approval-inbox-summary-text");

beforeEach(() => {
	t.mockClear();
});

describe("useApprovalInboxSummaryText", () => {
	it("shows a plain text as it is, without translating it", () => {
		const text = useApprovalInboxSummaryText("de");

		expect(text("Absence request")).toBe("Absence request");
		expect(t).not.toHaveBeenCalled();
	});

	it("translates a localized text by its key, with no params when it has none", () => {
		const text = useApprovalInboxSummaryText("de");

		expect(
			text({ key: "approvals.inbox.warning.unavailable", fallback: "Could not load requests" }),
		).toBe("Could not load requests");
		expect(t).toHaveBeenCalledWith(
			"approvals.inbox.warning.unavailable",
			"Could not load requests",
		);
	});

	it("formats a typed value in the viewer's locale", () => {
		const text = useApprovalInboxSummaryText("de");

		expect(
			text({
				key: "approvals.inbox.summary.expense",
				fallback: "Expense report of {amount}",
				params: { amount: { kind: "money", amount: "12.50", currency: "EUR" } },
			}),
		).toBe("Expense report of 12,50 €");
	});

	it("keeps a typed value canonical without a locale", () => {
		const text = useApprovalInboxSummaryText();

		expect(
			text({
				key: "approvals.inbox.summary.expense",
				fallback: "Expense report of {amount}",
				params: { amount: { kind: "money", amount: "12.50", currency: "EUR" } },
			}),
		).toBe("Expense report of 12.50 EUR");
	});

	it("names a per diem place by its stored label, without the travel expense catalog", () => {
		const text = useApprovalInboxSummaryText("de");

		expect(
			text({
				key: "approvals.inbox.summary.perDiem",
				fallback: "Per diem in {place}",
				params: {
					place: { perDiemLocation: { country: "FR", place: "paris", label: "Paris" } },
				},
			}),
		).toBe("Per diem in Paris");
	});
});
