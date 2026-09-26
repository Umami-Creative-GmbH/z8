/* @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprovalInboxItem } from "@/lib/approvals/inbox/types";

const state = vi.hoisted(() => ({
	push: vi.fn(),
	panel: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, string>) =>
			Object.entries(params ?? {}).reduce(
				(value, [key, replacement]) => value.replace(`{${key}}`, replacement),
				fallback,
			),
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
	useRouter: () => ({ push: state.push }),
}));

vi.mock("../../../../inbox/components/approval-detail-panel", () => ({
	ApprovalDetailPanel: (props: {
		approval: ApprovalInboxItem;
		open: boolean;
		onOpenChange: (open: boolean) => void;
		onActioned: () => void;
	}) => {
		state.panel(props);
		return props.open ? (
			<div role="dialog">
				<button type="button" onClick={() => props.onOpenChange(false)}>
					close
				</button>
				<button type="button" onClick={props.onActioned}>
					decide
				</button>
			</div>
		) : null;
	},
}));

const { ApprovalReviewOutcome } = await import("./approval-review-view");

const item = {
	id: "4b2d8a6e-1f3c-4a5b-9c7d-0e1f2a3b4c5d",
	summary: { detail: "Vacation · 3 days" },
} as ApprovalInboxItem;

const reviewPath = `/approvals/review/org-1/canonical/${item.id}`;

describe("ApprovalReviewOutcome", () => {
	beforeEach(() => vi.clearAllMocks());

	it("opens the exact authorized item in the inbox detail panel", () => {
		render(<ApprovalReviewOutcome arrival={{ status: "ready", item }} reviewPath={reviewPath} />);
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(state.panel).toHaveBeenCalledWith(
			expect.objectContaining({ approval: item, open: true }),
		);
		expect(screen.getByText("Vacation · 3 days")).toBeTruthy();
	});

	it("reopens the panel after closing and returns to the inbox after a decision", () => {
		render(<ApprovalReviewOutcome arrival={{ status: "ready", item }} reviewPath={reviewPath} />);
		fireEvent.click(screen.getByText("close"));
		expect(screen.queryByRole("dialog")).toBeNull();
		fireEvent.click(screen.getByText("Show details"));
		fireEvent.click(screen.getByText("decide"));
		expect(state.push).toHaveBeenCalledWith("/approvals/inbox");
	});

	it("switches organization and returns to this exact review", () => {
		render(
			<ApprovalReviewOutcome
				arrival={{
					status: "switch_organization",
					organizationId: "org-1",
					organizationName: "Acme",
				}}
				reviewPath={reviewPath}
			/>,
		);
		const link = screen.getByText("Switch to Acme").closest("a");
		const href = new URL(link?.getAttribute("href") ?? "", "https://z8.test");
		expect(href.pathname).toBe("/init");
		expect(href.searchParams.get("organizationId")).toBe("org-1");
		expect(href.searchParams.get("callbackUrl")).toBe(reviewPath);
		expect(state.panel).not.toHaveBeenCalled();
	});

	it("explains an unavailable item without approval facts", () => {
		const { container } = render(
			<ApprovalReviewOutcome arrival={{ status: "unavailable" }} reviewPath={reviewPath} />,
		);
		expect(screen.getByText("This approval is not available")).toBeTruthy();
		expect(screen.getByText("Open Inbox").closest("a")?.getAttribute("href")).toBe(
			"/approvals/inbox",
		);
		expect(container.textContent).not.toContain(item.id);
		expect(state.panel).not.toHaveBeenCalled();
	});
});
