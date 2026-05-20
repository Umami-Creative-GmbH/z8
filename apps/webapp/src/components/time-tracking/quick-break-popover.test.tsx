/* @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TFnType } from "@tolgee/react";
import { describe, expect, it, vi } from "vitest";
import { QuickBreakPopover } from "@/components/time-tracking/quick-break-popover";

const t = ((_key: string, fallback: string) => fallback) as TFnType;

describe("QuickBreakPopover", () => {
	function deferredResult() {
		let resolve!: (value: { success: boolean; error?: string }) => void;
		const promise = new Promise<{ success: boolean; error?: string }>((promiseResolve) => {
			resolve = promiseResolve;
		});

		return { promise, resolve };
	}

	it("calls onAddBreak with entered minutes", async () => {
		const onAddBreak = vi.fn().mockResolvedValue({ success: true });

		render(
			<QuickBreakPopover onAddBreak={onAddBreak} isAddingBreak={false} isDisabled={false} t={t} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add break" }));
		fireEvent.change(screen.getByLabelText("Break duration in minutes"), {
			target: { value: "30" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));

		await waitFor(() => expect(onAddBreak).toHaveBeenCalledWith(30));
	});

	it("renders an icon-only trigger with an accessible label", () => {
		render(
			<QuickBreakPopover
				onAddBreak={async () => ({ success: true })}
				isAddingBreak={false}
				isDisabled={false}
				t={t}
				iconOnly
			/>,
		);

		const button = screen.getByRole("button", { name: "Add break" });
		expect(button.textContent).toBe("");
	});

	it("shows a local error for break durations below one minute", async () => {
		const onAddBreak = vi.fn().mockResolvedValue({ success: true });

		render(
			<QuickBreakPopover onAddBreak={onAddBreak} isAddingBreak={false} isDisabled={false} t={t} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add break" }));
		fireEvent.change(screen.getByLabelText("Break duration in minutes"), {
			target: { value: "0" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));

		expect(await screen.findByText("Enter a break duration of at least 1 minute.")).toBeTruthy();
		expect(onAddBreak).not.toHaveBeenCalled();
	});

	it("disables the applying button while a break is being added", () => {
		const onAddBreak = vi.fn().mockResolvedValue({ success: true });

		render(
			<QuickBreakPopover onAddBreak={onAddBreak} isAddingBreak={true} isDisabled={false} t={t} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add break" }));

		expect(screen.getByRole<HTMLButtonElement>("button", { name: "Applying…" }).disabled).toBe(
			true,
		);
	});

	it("prevents duplicate submissions while the add break request is pending", async () => {
		const pending = deferredResult();
		const onAddBreak = vi.fn().mockReturnValue(pending.promise);

		render(
			<QuickBreakPopover onAddBreak={onAddBreak} isAddingBreak={false} isDisabled={false} t={t} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add break" }));
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));
		fireEvent.click(screen.getByRole("button", { name: "Applying…" }));

		expect(onAddBreak).toHaveBeenCalledTimes(1);

		pending.resolve({ success: true });
		await waitFor(() =>
			expect(screen.queryByText("Record a break ending now and stay clocked in.")).toBeNull(),
		);
	});

	it("disables controls and does not submit if disabled while open", () => {
		const onAddBreak = vi.fn().mockResolvedValue({ success: true });
		const { rerender } = render(
			<QuickBreakPopover onAddBreak={onAddBreak} isAddingBreak={false} isDisabled={false} t={t} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add break" }));

		rerender(
			<QuickBreakPopover onAddBreak={onAddBreak} isAddingBreak={false} isDisabled={true} t={t} />,
		);

		expect(screen.getByLabelText<HTMLInputElement>("Break duration in minutes").disabled).toBe(
			true,
		);
		expect(screen.getByRole<HTMLButtonElement>("button", { name: "Apply" }).disabled).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Apply" }));

		expect(onAddBreak).not.toHaveBeenCalled();
	});

	it("shows a fallback error when adding a break rejects", async () => {
		const onAddBreak = vi.fn().mockRejectedValue(new Error("Network failed"));

		render(
			<QuickBreakPopover onAddBreak={onAddBreak} isAddingBreak={false} isDisabled={false} t={t} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add break" }));
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));

		expect(await screen.findByText("Failed to add break. Please try again.")).toBeTruthy();
	});

	it("shows a returned server error when adding a break fails", async () => {
		const onAddBreak = vi.fn().mockResolvedValue({ success: false, error: "Break overlaps lunch" });

		render(
			<QuickBreakPopover onAddBreak={onAddBreak} isAddingBreak={false} isDisabled={false} t={t} />,
		);

		fireEvent.click(screen.getByRole("button", { name: "Add break" }));
		fireEvent.click(screen.getByRole("button", { name: "Apply" }));

		expect(await screen.findByText("Break overlaps lunch")).toBeTruthy();
	});
});
