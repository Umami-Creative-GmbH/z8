// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApprovalActionDialog } from "./approval-action-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

describe("legacy approval confirmation", () => {
	it("associates a required reason error and retains the draft after refusal for retry", async () => {
		const user = userEvent.setup();
		const confirm = vi
			.fn()
			.mockRejectedValueOnce(new Error("Request is no longer eligible"))
			.mockResolvedValueOnce(undefined);
		const close = vi.fn();
		render(
			<ApprovalActionDialog
				open
				onOpenChange={close}
				action="reject"
				title="Reject absence"
				description="Ada • 18 May"
				onConfirm={confirm}
			/>,
		);
		await user.click(
			screen.getByRole("button", { name: "Reject", exact: true }),
		);
		const reason = screen.getByRole("textbox", {
			name: "Reason for rejection *",
		});
		expect(reason.getAttribute("aria-invalid")).toBe("true");
		expect(screen.getByRole("alert").textContent).toContain(
			"Please provide a reason",
		);
		await user.type(reason, "Need coverage");
		await user.click(
			screen.getByRole("button", { name: "Reject", exact: true }),
		);
		await screen.findByText("Request is no longer eligible");
		expect(close).not.toHaveBeenCalled();
		expect((reason as HTMLTextAreaElement).value).toBe("Need coverage");
		await user.click(
			screen.getByRole("button", { name: "Reject", exact: true }),
		);
		await waitFor(() => expect(close).toHaveBeenCalledWith(false));
	});
	it("keeps the panel open and sends only once during a pending decision", async () => {
		const user = userEvent.setup();
		let finish!: () => void;
		const confirm = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const close = vi.fn();
		render(
			<ApprovalActionDialog
				open
				onOpenChange={close}
				action="approve"
				title="Approve absence"
				description="Ada • 18 May"
				onConfirm={confirm}
			/>,
		);
		await user.click(
			screen.getByRole("button", { name: "Approve", exact: true }),
		);
		await user.keyboard("{Escape}");
		expect(close).not.toHaveBeenCalled();
		expect(
			(screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		await user.click(
			screen.getByRole("button", { name: "Approve", exact: true }),
		);
		expect(confirm).toHaveBeenCalledTimes(1);
		finish();
		await waitFor(() => expect(close).toHaveBeenCalledWith(false));
	});
});
