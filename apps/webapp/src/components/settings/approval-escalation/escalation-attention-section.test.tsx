/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EscalationAttentionView } from "@/lib/approvals/escalation/management-overview";
import { EscalationAttentionCard } from "./escalation-attention-section";
import {
	attemptKindLabel,
	attemptOutcomeLabel,
	evidenceKeyLabel,
} from "./escalation-labels";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (
			_key: string,
			defaultValue?: string,
			params?: Record<string, string | number>,
		) => {
			let text = defaultValue ?? _key;
			for (const [name, value] of Object.entries(params ?? {})) {
				text = text.replace(`{${name}}`, String(value));
			}
			return text;
		},
	}),
}));

vi.mock("@/hooks/use-display-context", () => ({
	useDisplayContext: () => ({
		locale: "en",
		timezone: "Europe/Berlin",
		timeFormat: "24h",
	}),
}));

vi.mock("@/app/[locale]/(app)/settings/approval-policies/escalation-actions", () => ({
	listApprovalEscalationCandidates: vi.fn(),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

const t = (_key: string, defaultValue?: string) => defaultValue ?? _key;

const item: EscalationAttentionView = {
	id: "attention-1111",
	reason: "delivery_unavailable",
	status: "open",
	approvalType: "absence",
	approvalRequestId: "request-2222",
	workflowId: "workflow-3333",
	assignmentId: null,
	deliveryChannel: "slack",
	currentApprover: { employeeId: "employee-1", name: "Ada Lovelace" },
	evidence: { workId: "work-4444", attemptCount: 3, customKey: "kept" },
	attempts: [
		{
			kind: "delivery",
			channel: "slack",
			reference: "work-4444",
			outcome: "unavailable:bot_unavailable",
			at: "2026-11-18T08:00:00Z",
		},
	],
	policyRevision: null,
	observationCount: 1,
	firstRaisedAt: "2026-11-18T08:00:00Z",
	lastObservedAt: "2026-11-18T08:00:00Z",
	adminAlertedAt: null,
	closedAt: null,
	closureNote: null,
	disposedByName: null,
	approvalHref: "/approvals",
	events: [],
};

function renderCard() {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	return render(
		<QueryClientProvider client={queryClient}>
			<EscalationAttentionCard
				openAttention={[item]}
				closedAttention={[]}
				isRechecking={false}
				isDisposing={false}
				isTransferring={false}
				isRetryingDelivery={false}
				onRecheck={vi.fn()}
				onDispose={vi.fn()}
				onTransfer={vi.fn()}
				onRetryDelivery={vi.fn()}
			/>
		</QueryClientProvider>,
	);
}

describe("escalation attention labels", () => {
	it("labels known attempt kinds and keeps unknown kinds as recorded", () => {
		expect(attemptKindLabel("delivery", t)).toBe("Delivery");
		expect(attemptKindLabel("retirement", t)).toBe("Message update");
		expect(attemptKindLabel("future_kind", t)).toBe("future_kind");
	});

	it("labels delivery outcomes and keeps the provider reason code", () => {
		expect(attemptOutcomeLabel("delivered", t)).toBe("Delivered");
		expect(attemptOutcomeLabel("unavailable:bot_unavailable", t)).toBe(
			"Channel unavailable (bot_unavailable)",
		);
		expect(attemptOutcomeLabel("gone:message_deleted", t)).toBe(
			"Message no longer available (message_deleted)",
		);
		expect(attemptOutcomeLabel("mystery:thing", t)).toBe("mystery:thing");
		expect(attemptOutcomeLabel("mystery", t)).toBe("mystery");
	});

	it("labels known evidence keys and keeps unknown keys", () => {
		expect(evidenceKeyLabel("attemptCount", t)).toBe("Attempts made");
		expect(evidenceKeyLabel("route", t)).toBe("Decision path");
		expect(evidenceKeyLabel("customKey", t)).toBe("customKey");
	});
});

describe("EscalationAttentionCard", () => {
	beforeEach(() => vi.clearAllMocks());

	it("shows translated attempts, evidence keys and the approval kind instead of raw codes", () => {
		renderCard();

		const facts = screen.getByText("Approval").closest("div");
		expect(facts?.textContent).toContain("Absence");
		expect(facts?.textContent).not.toContain("request-2222");
		expect(screen.getByText("Attempts made")).toBeTruthy();
		expect(screen.getByText("customKey")).toBeTruthy();
		expect(
			screen.getByText(/Delivery · Slack · Channel unavailable \(bot_unavailable\)/),
		).toBeTruthy();
	});

	it("keeps raw identifiers in a technical details disclosure with copy buttons", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		Object.assign(navigator, { clipboard: { writeText } });
		renderCard();

		const summary = screen.getByText("Technical details");
		const disclosure = summary.closest("details");
		expect(disclosure).toBeTruthy();
		const technical = within(disclosure as HTMLElement);
		expect(technical.getByText("request-2222")).toBeTruthy();
		expect(technical.getByText("workflow-3333")).toBeTruthy();
		expect(technical.getByText("attention-1111")).toBeTruthy();

		fireEvent.click(
			technical.getByRole("button", { name: "Copy Approval request ID" }),
		);
		await waitFor(() => expect(writeText).toHaveBeenCalledWith("request-2222"));
		expect(
			technical.getByRole("button", { name: "Approval request ID copied" }),
		).toBeTruthy();
	});
});
