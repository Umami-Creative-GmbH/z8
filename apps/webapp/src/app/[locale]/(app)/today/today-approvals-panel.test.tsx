/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Activity, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefingApprovalActionItem } from "@/lib/manager-daily-briefing/types";
import { TodayApprovalsPanel } from "./today-approvals-panel";
import {
	TodayDecisionReservations,
	useTodayDecisionReservation,
} from "./today-decision-reservations";

const { refreshMock, toastErrorMock, toastSuccessMock, translations } = vi.hoisted(() => ({
	refreshMock: vi.fn(),
	toastErrorMock: vi.fn(),
	toastSuccessMock: vi.fn(),
	// The viewer's catalog: a key found here is translated, any other falls back to English.
	translations: new Map<string, string>(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
vi.mock("@/navigation", () => ({
	Link: ({
		children,
		href,
		...props
	}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
		<a href={href} {...props}>
			{children}
		</a>
	),
}));
vi.mock("sonner", () => ({ toast: { success: toastSuccessMock, error: toastErrorMock } }));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (key: string, fallback: string, params?: Record<string, string | number>) =>
			Object.entries(params ?? {}).reduce(
				(text, [name, value]) =>
					text
						// A minimal ICU plural: `{name, plural, one {…} other {…}}`, `#` is the value.
						.replace(
							new RegExp(`\\{${name}, plural, one \\{([^}]*)\\} other \\{([^}]*)\\}\\}`, "g"),
							(_match, one: string, other: string) =>
								(Number(value) === 1 ? one : other).replaceAll("#", String(value)),
						)
						.replaceAll(`{${name}}`, String(value)),
				translations.get(key) ?? fallback,
			),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => (translations.size > 0 ? "de" : "en") }));

describe("TodayApprovalsPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		translations.clear();
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: true }),
		}) as unknown as typeof fetch;
	});
	it("ignores a decision completion from before Activity was hidden", async () => {
		let complete!: (value: unknown) => void;
		vi.mocked(global.fetch).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const items = [approvalItem()];
		const view = render(
			<Activity mode="visible">
				<TodayApprovalsPanel items={items} />
			</Activity>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Approve Vacation request" }));
		view.rerender(
			<Activity mode="hidden">
				<TodayApprovalsPanel items={items} />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<TodayApprovalsPanel items={items} />
			</Activity>,
		);
		await act(async () => complete({ ok: true, json: async () => ({ success: true }) }));
		expect(toastSuccessMock).not.toHaveBeenCalled();
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("closes the reject panel when its rejection settles after Activity retired the view", async () => {
		let complete!: (value: unknown) => void;
		vi.mocked(global.fetch).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		const items = [approvalItem()];
		const view = render(
			<Activity mode="visible">
				<TodayApprovalsPanel items={items} />
			</Activity>,
		);
		const panel = startRejection();
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));
		await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
		view.rerender(
			<Activity mode="hidden">
				<TodayApprovalsPanel items={items} />
			</Activity>,
		);
		view.rerender(
			<Activity mode="visible">
				<TodayApprovalsPanel items={items} />
			</Activity>,
		);

		// The server may well have accepted it: the stale result must not be confirmable again.
		await act(async () => complete({ ok: true, json: async () => ({ success: true }) }));

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(global.fetch).toHaveBeenCalledTimes(1);
	});

	it("approves an item inline and refreshes the briefing", async () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith("/api/approvals/inbox/approval-1/approve", {
				method: "POST",
			}),
		);
		expect(toastSuccessMock).toHaveBeenCalledWith("Request approved");
		expect(refreshMock).toHaveBeenCalledTimes(1);
	});

	it("asks for a rejection reason in an action panel before sending anything", () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));

		const panel = screen.getByRole("dialog", { name: "Reject request" });
		expect(within(panel).getByText("Vacation request")).toBeTruthy();
		expect(within(panel).getByLabelText("Reason for rejection")).toBeTruthy();
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("refuses a blank or whitespace-only rejection reason", async () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		const confirm = within(panel).getByRole("button", { name: "Confirm Rejection" });

		expect(confirm.hasAttribute("disabled")).toBe(true);
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "   " },
		});

		expect(await within(panel).findByText("A reason is required")).toBeTruthy();
		expect(confirm.hasAttribute("disabled")).toBe(true);
		fireEvent.submit(confirm.closest("form") as HTMLFormElement);
		await act(async () => {});
		expect(global.fetch).not.toHaveBeenCalled();
	});

	it("rejects with the manager's trimmed reason, closes the panel and refreshes the briefing", async () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });

		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "  Overlaps the inventory week.  " },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));

		await waitFor(() =>
			expect(global.fetch).toHaveBeenCalledWith("/api/approvals/inbox/approval-1/reject", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ reason: "Overlaps the inventory week." }),
			}),
		);
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(toastSuccessMock).toHaveBeenCalledWith("Request rejected");
		expect(refreshMock).toHaveBeenCalledTimes(1);
	});

	it("keeps the panel and the manager's reason when the rejection fails", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: async () => ({ success: false, error: "Already decided" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });

		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));

		await waitFor(() => expect(toastErrorMock).toHaveBeenCalledWith("Already decided"));
		const stillOpen = screen.getByRole("dialog", { name: "Reject request" });
		expect(
			(within(stillOpen).getByLabelText("Reason for rejection") as HTMLTextAreaElement).value,
		).toBe("Overlaps the inventory week.");
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("holds every other decision while a rejection is pending", async () => {
		let complete!: (value: unknown) => void;
		vi.mocked(global.fetch).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		render(
			<TodayApprovalsPanel
				items={[
					approvalItem(),
					approvalItem({ id: "approval:approval-2", approvalId: "approval-2", title: "Sick day" }),
				]}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));
		await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

		expect(
			screen
				.getByRole("button", { name: "Approve Sick day", hidden: true })
				.hasAttribute("disabled"),
		).toBe(true);

		await act(async () => complete({ ok: true, json: async () => ({ success: true }) }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("sends a manager to the inbox instead of approving an item that needs detail review", () => {
		render(
			<TodayApprovalsPanel
				items={[
					approvalItem({
						title: "Expense report",
						href: "/approvals/inbox?types=travel_expense_report",
						requiresDetailReview: true,
					}),
				]}
			/>,
		);

		expect(screen.queryByRole("button", { name: /approve expense report/i })).toBeNull();
		expect(
			screen.getByRole("link", { name: "Review in inbox: Expense report" }).getAttribute("href"),
		).toBe("/approvals/inbox?types=travel_expense_report");
		expect(screen.getByRole("button", { name: "Reject Expense report" })).toBeTruthy();
	});

	it("names the Review in inbox link starting with its visible text (WCAG 2.5.3)", () => {
		render(<TodayApprovalsPanel items={[approvalItem({ requiresDetailReview: true })]} />);

		const link = screen.getByRole("link", { name: /^Review in inbox/ });
		expect(link.textContent).toBe("Review in inbox");
		expect(link.getAttribute("aria-label")?.startsWith(link.textContent ?? "")).toBe(true);
	});

	it("sends a manager to the inbox for an item the inbox will not approve from the list", () => {
		render(
			<TodayApprovalsPanel
				items={[approvalItem({ title: "Blocked absence", canApprove: false, canReject: true })]}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Approve Blocked absence" })).toBeNull();
		expect(screen.getByRole("link", { name: "Review in inbox: Blocked absence" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reject Blocked absence" })).toBeTruthy();
	});

	it("offers no decision at all on an item the inbox lets no one decide from the list", () => {
		render(
			<TodayApprovalsPanel
				items={[
					approvalItem({
						title: "Time correction",
						approvalType: "time_entry",
						href: "/approvals/inbox?types=time_entry",
						canApprove: false,
						canReject: false,
					}),
				]}
			/>,
		);

		expect(screen.queryByRole("button", { name: "Approve Time correction" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Reject Time correction" })).toBeNull();
		expect(
			screen.getByRole("link", { name: "Review in inbox: Time correction" }).getAttribute("href"),
		).toBe("/approvals/inbox?types=time_entry");
	});

	it("offers Approve but no Reject when the inbox refuses only the rejection", () => {
		render(
			<TodayApprovalsPanel
				items={[approvalItem({ title: "Sick day", canApprove: true, canReject: false })]}
			/>,
		);

		expect(screen.getByRole("button", { name: "Approve Sick day" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Reject Sick day" })).toBeNull();
	});

	it("holds the rejection confirm while another approval's decision is pending", () => {
		const other = renderWithSharedReservations([approvalItem()]);
		const panel = startRejection();
		const confirm = within(panel).getByRole("button", { name: "Confirm Rejection" });
		expect(confirm.hasAttribute("disabled")).toBe(false);

		let held!: object;
		act(() => {
			held = other().reserve("approval-elsewhere") as object;
		});
		expect(confirm.hasAttribute("disabled")).toBe(true);

		act(() => other().release(held));
		expect(confirm.hasAttribute("disabled")).toBe(false);
	});

	it("closes on Escape as Cancel does while another approval's decision is pending", async () => {
		const other = renderWithSharedReservations([approvalItem()]);
		const panel = startRejection();
		act(() => {
			other().reserve("approval-elsewhere");
		});
		expect(within(panel).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(
			false,
		);

		fireEvent.keyDown(panel, { key: "Escape" });

		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("stays open on Escape, as Cancel is off, while its own rejection is pending", async () => {
		let complete!: (value: unknown) => void;
		vi.mocked(global.fetch).mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					complete = resolve;
				}),
		);
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		const panel = startRejection();
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));
		await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

		expect(within(panel).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(
			true,
		);
		fireEvent.keyDown(panel, { key: "Escape" });
		expect(screen.getByRole("dialog", { name: "Reject request" })).toBeTruthy();

		await act(async () => complete({ ok: true, json: async () => ({ success: true }) }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});

	it("shows a failed rejection inside the panel as an alert", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: async () => ({ success: false, error: "Already decided" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);
		const panel = startRejection();

		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));

		expect((await within(panel).findByRole("alert")).textContent).toContain("Already decided");
	});

	it("keeps the row visible when approval fails", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: false, error: "Cannot approve" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		expect(await screen.findByText("Vacation request")).toBeTruthy();
		expect(toastErrorMock).toHaveBeenCalledWith("Cannot approve");
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("shows a generic error when the server omits error copy", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: false }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Unable to reject request");
		});
		// The row stays in the list: the open reject panel repeating the title doesn't count.
		const list = screen.getByRole("list", { name: "Pending approvals", hidden: true });
		expect(within(list).getByText("Vacation request")).toBeTruthy();
	});

	it("leaves a refused rejection's error with the panel it was shown in once cancelled", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: false, error: "Already decided" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));
		await waitFor(() => {
			expect(within(panel).getByText("Already decided")).toBeTruthy();
		});

		fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Reject request" })).toBeNull();
		});
		// Dismissing the attempt doesn't announce its error a second time in the card.
		expect(screen.queryByText("Already decided")).toBeNull();
	});

	it("closes the reject panel when a refresh drops the item it was opened for", async () => {
		const { rerender } = render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		expect(screen.getByRole("dialog", { name: "Reject request" })).toBeTruthy();

		// The refreshed briefing no longer lists the request, e.g. the employee left the team.
		rerender(<TodayApprovalsPanel items={[]} total={0} />);

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Reject request" })).toBeNull();
		});
		expect(screen.queryByRole("button", { name: "Confirm Rejection" })).toBeNull();

		// When a later refresh lists it again, the dropped rejection doesn't reopen by itself.
		rerender(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);
		expect(screen.queryByRole("dialog", { name: "Reject request" })).toBeNull();
	});

	it.each([
		["saved", { success: true }],
		["refused", { success: false, error: "Already decided" }],
	])(
		"keeps the reject panel open while its %s rejection is in flight, even if a refresh drops the item",
		async (_outcome, body) => {
			let complete!: (value: unknown) => void;
			vi.mocked(global.fetch).mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						complete = resolve;
					}),
			);
			const { rerender } = render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

			fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
			const panel = screen.getByRole("dialog", { name: "Reject request" });
			fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
				target: { value: "Overlaps the inventory week." },
			});
			fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));
			// The form submits asynchronously; wait until the rejection is actually on its way.
			await waitFor(() => {
				expect(
					(within(panel).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled,
				).toBe(true);
			});

			// A refresh started elsewhere drops the item while its rejection is on its way.
			rerender(<TodayApprovalsPanel items={[]} total={0} />);

			// Neither the refresh, Cancel nor the close button may drop a rejection that is on its way.
			const stillOpen = screen.getByRole("dialog", { name: "Reject request" });
			expect(
				(within(stillOpen).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled,
			).toBe(true);
			expect(within(stillOpen).queryByRole("button", { name: "Close" })).toBeNull();

			await act(async () => complete({ ok: true, json: async () => body }));

			// Once it settles, the dropped item's panel closes and leaves no error on the card.
			await waitFor(() => {
				expect(screen.queryByRole("dialog", { name: "Reject request" })).toBeNull();
			});
			expect(screen.queryByText("Already decided")).toBeNull();
		},
	);

	it("stops offering the open rejection when a refresh says the item can no longer be rejected", () => {
		const { rerender } = render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		expect(
			(within(panel).getByRole("button", { name: "Confirm Rejection" }) as HTMLButtonElement)
				.disabled,
		).toBe(false);

		// Another decision's refresh brings the item back, no longer rejectable from here.
		rerender(<TodayApprovalsPanel items={[approvalItem({ canReject: false })]} total={1} />);

		const stillOpen = screen.getByRole("dialog", { name: "Reject request" });
		expect(
			(within(stillOpen).getByRole("button", { name: "Confirm Rejection" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		// The panel says why, and where the request can be seen now.
		expect(
			within(stillOpen).getByText("This request can no longer be rejected here."),
		).toBeTruthy();
		expect(
			within(stillOpen).getByRole("link", { name: "Open the inbox" }).getAttribute("href"),
		).toBe("/approvals/inbox");
	});

	it("says why it can't confirm when the briefing goes stale while the panel is open", () => {
		const { rerender } = render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		// A background read failed: the card's own alert is behind the modal panel.
		rerender(<TodayApprovalsPanel items={[approvalItem()]} total={1} stale />);

		const panel = screen.getByRole("dialog", { name: "Reject request" });
		expect(
			(within(panel).getByRole("button", { name: "Confirm Rejection" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			within(panel).getByText(
				"Today's approvals could not be refreshed. Close this panel and retry.",
			),
		).toBeTruthy();
	});

	it("keeps the item and the reason in the panel while it slides out", () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));

		// The sheet stays rendered for its close animation; it must not empty out meanwhile.
		const closing = screen.getByRole("dialog", { name: "Reject request", hidden: true });
		expect(within(closing).getByText("Vacation request")).toBeTruthy();
		expect(
			(within(closing).getByLabelText("Reason for rejection") as HTMLTextAreaElement).value,
		).toBe("Overlaps the inventory week.");
	});

	it("keeps focus in the list when the panel closes on a stale briefing, whose Reject button is disabled", async () => {
		const { rerender } = render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		rerender(<TodayApprovalsPanel items={[approvalItem()]} total={1} stale />);
		fireEvent.click(
			within(screen.getByRole("dialog", { name: "Reject request" })).getByRole("button", {
				name: "Cancel",
			}),
		);

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Reject request" })).toBeNull();
		});
		// A disabled button can't take focus: it goes into the list instead of falling to <body>.
		await waitFor(() => {
			const list = screen.getByRole("list", { name: "Pending approvals" });
			expect(document.activeElement).not.toBe(document.body);
			expect(list.contains(document.activeElement)).toBe(true);
		});
	});

	it("starts a fresh, consistent reason when the same item is reopened while the panel is still closing", () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Old reason" },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Cancel" }));
		// Reopened before the slide-out ends, while the sheet is still mounted.
		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i, hidden: true }));

		const reopened = screen.getByRole("dialog", { name: "Reject request" });
		// The field and Confirm agree: an empty reason, so Confirm is off until one is written.
		expect(
			(within(reopened).getByLabelText("Reason for rejection") as HTMLTextAreaElement).value,
		).toBe("");
	});

	it("returns focus to the approvals list after a saved rejection removes its Reject button", async () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Reject request" })).toBeNull();
		});
		// Focus stays in the list the user was working in, not on <body> or the card's header link.
		await waitFor(() => {
			const list = screen.getByRole("list", { name: "Pending approvals" });
			expect(document.activeElement).not.toBe(document.body);
			expect(list.contains(document.activeElement)).toBe(true);
		});
		// When the list itself takes focus, it shows a visible focus ring (WCAG 2.4.7).
		expect(screen.getByRole("list", { name: "Pending approvals" }).className).toContain(
			"focus-visible:ring-2",
		);
	});

	it("drops a refused rejection's error with its item, not into the card", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: false, error: "Already decided" }),
		}) as unknown as typeof fetch;
		const { rerender } = render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

		fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
		const panel = screen.getByRole("dialog", { name: "Reject request" });
		fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
			target: { value: "Overlaps the inventory week." },
		});
		fireEvent.click(within(panel).getByRole("button", { name: "Confirm Rejection" }));
		await waitFor(() => {
			expect(within(panel).getByText("Already decided")).toBeTruthy();
		});

		rerender(<TodayApprovalsPanel items={[]} total={0} />);

		await waitFor(() => {
			expect(screen.queryByRole("dialog", { name: "Reject request" })).toBeNull();
		});
		expect(screen.queryByText("Already decided")).toBeNull();
	});

	it("does not refresh when the approval response is not ok", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: false,
			json: async () => ({ success: true, error: "Forbidden" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Forbidden");
		});
		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("does not refresh when the approval payload is malformed", async () => {
		global.fetch = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ success: "false" }),
		}) as unknown as typeof fetch;
		render(<TodayApprovalsPanel items={[approvalItem()]} />);

		fireEvent.click(screen.getByRole("button", { name: /approve vacation request/i }));

		await waitFor(() => {
			expect(toastErrorMock).toHaveBeenCalledWith("Unable to approve request");
		});
		expect(screen.getByText("Vacation request")).toBeTruthy();
		expect(refreshMock).not.toHaveBeenCalled();
	});

	it("offers no decisions on the viewer's own request", () => {
		render(
			<TodayApprovalsPanel
				items={[
					approvalItem({ id: "approval:own", title: "Own vacation request", ownRequest: true }),
					approvalItem(),
				]}
			/>,
		);

		expect(screen.getByText("Own vacation request")).toBeTruthy();
		expect(screen.getByText("Your own request: another approver decides it.")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /own vacation request/i })).toBeNull();
		expect(screen.getByRole("button", { name: "Approve Vacation request" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Reject Vacation request" })).toBeTruthy();
	});

	it("counts every pending approval in its badge and links to the inbox for those it leaves out", () => {
		const items = ["a", "b", "c"].map((id) =>
			approvalItem({ id: `approval:${id}`, approvalId: id, title: `Request ${id}` }),
		);
		render(<TodayApprovalsPanel items={items} total={40} />);

		expect(screen.getByText("40")).toBeTruthy();
		expect(screen.getByText("Showing 3 of 40 pending approvals.")).toBeTruthy();
		// The inbox shows the viewer's whole queue, so the link promises no count of its own.
		expect(
			screen.getByRole("link", { name: "Open the inbox to see the rest" }).getAttribute("href"),
		).toBe("/approvals/inbox");
		expect(screen.queryByText(/See all/)).toBeNull();
	});

	it("claims no truncation when it lists every pending approval", () => {
		render(<TodayApprovalsPanel items={[approvalItem()]} total={1} />);

		expect(screen.getByText("1")).toBeTruthy();
		expect(screen.queryByText(/^Showing/)).toBeNull();
		expect(screen.queryByRole("link", { name: "Open the inbox to see the rest" })).toBeNull();
	});

	it("names the approval types it could not list, with a retry, instead of claiming none wait", () => {
		const onRetry = vi.fn();
		render(
			<TodayApprovalsPanel
				items={[]}
				total={3}
				unavailableTypes={["travel_expense_claim", "period_submission"]}
				onRetry={onRetry}
			/>,
		);

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain(
			"Some approvals could not be loaded: Travel Expenses and Period Submissions.",
		);
		fireEvent.click(within(alert).getByRole("button", { name: "Retry approvals" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
		// The failed source may hold more than it counted: a lower bound, never an exact total.
		expect(screen.getByText("3+")).toBeTruthy();
		expect(screen.getByText("At least 3 pending approvals are waiting in the inbox.")).toBeTruthy();
		expect(screen.queryByText("No approvals are waiting.")).toBeNull();
	});

	it("joins the unavailable types as a list in the viewer's language", () => {
		translations.set("approvals:approvals.types.travel_expense_claim", "Reisekosten");
		translations.set("approvals:approvals.types.period_submission", "Periodenabgaben");
		render(
			<TodayApprovalsPanel
				items={[]}
				total={3}
				unavailableTypes={["travel_expense_claim", "period_submission"]}
			/>,
		);

		expect(screen.getByRole("alert").textContent).toContain(
			"Some approvals could not be loaded: Reisekosten und Periodenabgaben.",
		);
	});

	it("names the unavailable types in the viewer's language", () => {
		translations.set("approvals:approvals.types.travel_expense_claim", "Reisekosten");
		translations.set(
			"today.approvals.partialFailure",
			"Einige Freigaben konnten nicht geladen werden: {types}.",
		);
		render(
			<TodayApprovalsPanel
				items={[approvalItem()]}
				total={4}
				unavailableTypes={["travel_expense_claim"]}
			/>,
		);

		expect(screen.getByRole("alert").textContent).toContain(
			"Einige Freigaben konnten nicht geladen werden: Reisekosten.",
		);
		// The rows it could list stay decidable.
		expect(screen.getByRole("button", { name: "Approve Vacation request" })).toBeTruthy();
	});

	it("never claims no approvals wait while it counts some it does not list", () => {
		// The shipped catalog names the header button "Open inbox"; this link has its own key.
		translations.set("today.approvals.openInbox", "Open inbox");
		render(<TodayApprovalsPanel items={[]} total={2} />);

		expect(screen.queryByText("No approvals are waiting.")).toBeNull();
		// Nothing is listed, so it doesn't say "Showing 0 of 2".
		expect(screen.queryByText(/^Showing/)).toBeNull();
		expect(screen.getByText("2 pending approvals are waiting in the inbox.")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open the inbox" }).getAttribute("href")).toBe(
			"/approvals/inbox",
		);
	});

	it("uses the singular for one pending approval it does not list", () => {
		render(<TodayApprovalsPanel items={[]} total={1} />);

		expect(screen.getByText("1 pending approval is waiting in the inbox.")).toBeTruthy();
	});

	it("never claims no approvals wait while an approval type could not be loaded", () => {
		// Both the list and the count of the only pending type failed, so the total is 0.
		render(
			<TodayApprovalsPanel items={[]} total={0} unavailableTypes={["travel_expense_claim"]} />,
		);

		expect(screen.getByRole("alert").textContent).toContain(
			"Some approvals could not be loaded: Travel Expenses.",
		);
		expect(screen.queryByText("No approvals are waiting.")).toBeNull();
	});

	it("says a type whose count failed could not be counted, and never presents its list as complete", () => {
		const onRetry = vi.fn();
		const items = Array.from({ length: 3 }, (_, index) =>
			approvalItem({ id: `approval:${index}`, approvalId: `approval-${index}` }),
		);
		// The failed count came back as 0: the total is only the rows in hand.
		render(
			<TodayApprovalsPanel
				items={items}
				total={3}
				uncountedTypes={["absence_entry"]}
				onRetry={onRetry}
			/>,
		);

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain(
			"Some approvals could not be counted: Absence Requests. The total may be incomplete.",
		);
		expect(alert.textContent).not.toContain("could not be loaded");
		fireEvent.click(within(alert).getByRole("button", { name: "Retry approvals" }));
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(screen.getByText("3+")).toBeTruthy();
		expect(screen.getByText("Showing 3 of at least 3 pending approvals.")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open the inbox" }).getAttribute("href")).toBe(
			"/approvals/inbox",
		);
	});

	it("names both kinds of failure, each in its own words", () => {
		render(
			<TodayApprovalsPanel
				items={[approvalItem()]}
				total={5}
				unavailableTypes={["period_submission"]}
				uncountedTypes={["absence_entry", "travel_expense_claim"]}
				onRetry={vi.fn()}
			/>,
		);

		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain(
			"Some approvals could not be loaded: Period Submissions. The list and total may be incomplete.",
		);
		expect(alert.textContent).toContain(
			"Some approvals could not be counted: Absence Requests and Travel Expenses. The total may be incomplete.",
		);
		expect(screen.getAllByRole("button", { name: "Retry approvals" })).toHaveLength(1);
		expect(screen.getByText("Showing 1 of at least 5 pending approvals.")).toBeTruthy();
		expect(screen.getByRole("link", { name: "Open the inbox to see the rest" })).toBeTruthy();
	});

	it("says at least how many wait in the inbox when a failed source leaves none listed", () => {
		render(<TodayApprovalsPanel items={[]} total={1} uncountedTypes={["absence_entry"]} />);

		expect(screen.getByText("At least 1 pending approval is waiting in the inbox.")).toBeTruthy();
		expect(screen.queryByText("No approvals are waiting.")).toBeNull();
	});

	it("never claims no approvals wait when a type's count failed and none are listed", () => {
		render(<TodayApprovalsPanel items={[]} total={0} uncountedTypes={["absence_entry"]} />);

		expect(screen.getByRole("alert").textContent).toContain("could not be counted");
		expect(screen.queryByText("No approvals are waiting.")).toBeNull();
	});

	it("leaves the partial-failure alert to the fresh briefing while this one is stale", () => {
		render(
			<TodayApprovalsPanel
				items={[approvalItem()]}
				total={3}
				unavailableTypes={["travel_expense_claim"]}
				stale
			/>,
		);

		expect(screen.queryByText(/Some approvals could not be loaded/)).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry approvals" })).toBeNull();
	});

	it("shows an item's summary in the viewer's language when the inbox localizes it", () => {
		translations.set("approvals:approvals.periodSubmission.title", "Periodenabgabe");
		translations.set("approvals:approvals.canonicalRequester", "Eingereicht von {name}");
		translations.set("approvals:approvals.periodSubmission.hours", "{hours} Stunden");
		translations.set("today.approvals.itemTitle", "{requester}: {title}");
		translations.set("today.approvals.rejectLabel", "{title} ablehnen");
		render(
			<TodayApprovalsPanel
				items={[
					approvalItem({
						approvalType: "period_submission",
						title: "Ada Lovelace: Period submission",
						description: "Requested by Ada Lovelace",
						summary: "8.25 hours",
						localized: {
							title: {
								key: "approvals:approvals.periodSubmission.title",
								fallback: "Period submission",
							},
							subtitle: {
								key: "approvals:approvals.canonicalRequester",
								fallback: "Requested by {name}",
								params: { name: "Ada Lovelace" },
							},
							detail: {
								key: "approvals:approvals.periodSubmission.hours",
								fallback: "{hours} hours",
								params: { hours: "8,25" },
							},
						},
					}),
				]}
			/>,
		);

		expect(screen.getByRole("link", { name: "Ada Lovelace: Periodenabgabe" })).toBeTruthy();
		expect(screen.getByText("8,25 Stunden")).toBeTruthy();
		// The title already names the requester, so the row doesn't repeat the name.
		expect(screen.getByText("Eingereicht von Ada Lovelace")).toBeTruthy();
		expect(screen.queryByText(/Ada Lovelace - /)).toBeNull();
		expect(screen.queryByText(/Period submission|8\.25 hours/)).toBeNull();
		expect(
			screen.getByRole("button", { name: "Ada Lovelace: Periodenabgabe ablehnen" }),
		).toBeTruthy();
	});

	it("renders the empty state", () => {
		render(<TodayApprovalsPanel items={[]} />);

		expect(screen.getByRole("heading", { name: "Approvals" })).toBeTruthy();
		expect(screen.getByText("No approvals are waiting."));
		expect(screen.getByRole("link", { name: "Open inbox" }).getAttribute("href")).toBe(
			"/approvals/inbox",
		);
	});
});

function approvalItem(
	overrides: Partial<BriefingApprovalActionItem> = {},
): BriefingApprovalActionItem {
	return {
		id: "approval:approval-1",
		category: "approval" as const,
		severity: "warning" as const,
		title: "Vacation request",
		description: "Apr 28",
		href: "/approvals/inbox?types=absence_entry",
		approvalId: "approval-1",
		approvalType: "absence_entry" as const,
		entityId: "absence-1",
		requesterName: "Ada Lovelace",
		summary: "Vacation on Apr 28",
		canApprove: true,
		canReject: true,
		...overrides,
	};
}

type HeldReservation = ReturnType<typeof useTodayDecisionReservation>;

/** Another /today surface sharing the panel's decision reservations. */
function ReservationHolder({ onReady }: { onReady: (reservations: HeldReservation) => void }) {
	const reservations = useTodayDecisionReservation();
	// Hands over the latest reservations after each commit, keeping render pure.
	useEffect(() => {
		onReady(reservations);
	});
	return null;
}

/** The panel among the page's shared decision reservations, with a handle on another surface. */
function renderWithSharedReservations(items: BriefingApprovalActionItem[]) {
	let other!: HeldReservation;
	render(
		<QueryClientProvider client={new QueryClient()}>
			<TodayDecisionReservations scope={{ userId: "user-1", organizationId: "org-1" }}>
				<TodayApprovalsPanel items={items} />
				<ReservationHolder onReady={(reservations) => (other = reservations)} />
			</TodayDecisionReservations>
		</QueryClientProvider>,
	);
	return () => other;
}

/** Opens the reject panel of "Vacation request" and types a valid reason. */
function startRejection() {
	fireEvent.click(screen.getByRole("button", { name: /reject vacation request/i }));
	const panel = screen.getByRole("dialog", { name: "Reject request" });
	fireEvent.change(within(panel).getByLabelText("Reason for rejection"), {
		target: { value: "Overlaps the inventory week." },
	});
	return panel;
}
