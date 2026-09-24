/* @vitest-environment jsdom */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [key, value]) => text.replaceAll(`{${key}}`, String(value)),
				fallback,
			),
	}),
}));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/components/ui/select", async () => {
	const { createContext, useContext } = await import("react");
	const Choose = createContext<(value: string) => void>(() => {});
	return {
		Select: ({
			onValueChange,
			children,
		}: {
			onValueChange: (value: string) => void;
			children: ReactNode;
		}) => <Choose.Provider value={onValueChange}>{children}</Choose.Provider>,
		SelectTrigger: ({ children, ...props }: { children: ReactNode }) => (
			<button type="button" {...props}>
				{children}
			</button>
		),
		SelectValue: () => null,
		SelectContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
		SelectItem: ({ value, children }: { value: string; children: ReactNode }) => {
			const choose = useContext(Choose);
			return (
				<button type="button" role="option" aria-selected={false} onClick={() => choose(value)}>
					{children}
				</button>
			);
		},
	};
});

import { FollowUpList, type FollowUpListProps } from "./follow-up-list";

const handoverTaskId = "33333333-3333-4333-8333-333333333333";

function renderList(overrides: Partial<FollowUpListProps> = {}) {
	const props: FollowUpListProps = {
		employeeId: "employee-1",
		departureId: "departure-1",
		reviews: [
			{
				id: "review-clock",
				kind: "clock_out",
				status: "open",
				reason: null,
				handoverTaskId: null,
				actionUrl: "/settings/employees/employee-1?review=review-clock",
			},
			{
				id: "review-handover",
				kind: "approval_handover",
				status: "open",
				reason: "no_replacement",
				handoverTaskId,
				actionUrl: "/settings/employees/employee-1?review=review-handover",
			},
			{
				id: "review-done",
				kind: "employment_terms",
				status: "resolved",
				reason: null,
				handoverTaskId: null,
				actionUrl: "/settings/employees/employee-1?review=review-done",
			},
		],
		failedTasks: [{ id: "task-billing", kind: "billing_sync" }],
		canResolve: true,
		timeCorrectionHref: "/calendar/employee-1?date=2026-10-01",
		highlightedReviewId: null,
		replacementOptions: [{ id: "replacement-1", name: "Robin Admin" }],
		resolveReview: vi.fn().mockResolvedValue({ success: true, data: undefined }),
		retryTask: vi.fn().mockResolvedValue({ success: true, data: undefined }),
		assignReplacement: vi.fn().mockResolvedValue({ success: true, data: undefined }),
		...overrides,
	};
	render(<FollowUpList {...props} />);
	return props;
}

function reviewItem(label: string) {
	const item = screen.getByText(label).closest("li");
	if (!item) throw new Error(`review ${label} not rendered`);
	return within(item);
}

describe("FollowUpList", () => {
	it("links a clock review to the canonical time correction instead of clearing it", () => {
		renderList();

		const clock = reviewItem("Needs review: offboarding clock-out");
		expect(clock.getByRole("link", { name: "Correct time" }).getAttribute("href")).toBe(
			"/calendar/employee-1?date=2026-10-01",
		);
		expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
	});

	it("requires a written resolution and surfaces the server's refusal", async () => {
		const user = userEvent.setup();
		const resolveReview = vi.fn().mockResolvedValue({
			success: false,
			error:
				"The timer is still running. Correct it through time corrections before resolving this review.",
		});
		renderList({ resolveReview });
		const clock = reviewItem("Needs review: offboarding clock-out");

		expect(clock.getByRole("button", { name: "Mark resolved" }).hasAttribute("disabled")).toBe(
			true,
		);
		await user.type(clock.getByLabelText("Resolution note"), "Timer checked");
		await user.click(clock.getByRole("button", { name: "Mark resolved" }));

		expect(resolveReview).toHaveBeenCalledWith({
			reviewId: "review-clock",
			resolution: "Timer checked",
		});
		expect((await clock.findByRole("alert")).textContent).toContain("still running");
	});

	it("assigns a replacement for a handover review with a stable request id across retries", async () => {
		const user = userEvent.setup();
		const assignReplacement = vi
			.fn()
			.mockResolvedValueOnce({ success: false, error: "Try again" })
			.mockResolvedValueOnce({ success: true, data: undefined });
		renderList({ assignReplacement });
		const handover = reviewItem("Approval duties need a replacement");

		expect(handover.getByText("No replacement was chosen.")).toBeTruthy();
		await user.click(handover.getByRole("option", { name: "Robin Admin" }));
		await user.click(handover.getByRole("button", { name: "Assign replacement" }));
		await handover.findByRole("alert");
		await user.click(handover.getByRole("button", { name: "Assign replacement" }));

		await waitFor(() => expect(assignReplacement).toHaveBeenCalledTimes(2));
		const [first, second] = assignReplacement.mock.calls.map(([input]) => input);
		expect(first).toMatchObject({
			departureId: "departure-1",
			handoverTaskId,
			replacementEmployeeId: "replacement-1",
		});
		expect(second.requestId).toBe(first.requestId);
	});

	it("retries failed follow-up work", async () => {
		const user = userEvent.setup();
		const props = renderList();

		await user.click(screen.getByRole("button", { name: "Retry" }));

		expect(props.retryTask).toHaveBeenCalledWith({ taskId: "task-billing" });
		expect(screen.getByText("Billing seat update")).toBeTruthy();
	});

	it("gives managers no resolution, replacement or retry controls", () => {
		renderList({ canResolve: false });

		expect(screen.queryByRole("button", { name: "Mark resolved" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Assign replacement" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(screen.getByRole("link", { name: "Correct time" })).toBeTruthy();
	});

	it("highlights the review a notification linked to and keeps resolved ones apart", () => {
		renderList({ highlightedReviewId: "review-handover" });

		expect(document.getElementById("offboarding-review-review-handover")?.className).toContain(
			"ring-1",
		);
		expect(screen.getByText("Resolved reviews (1)")).toBeTruthy();
	});
});
