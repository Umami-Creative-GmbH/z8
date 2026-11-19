/* @vitest-environment jsdom */

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmActionDialog, useConfirmedAction } from "./confirm-action-dialog";
import { describeFailure } from "./confirm-action-utils";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function Harness({
	run,
	error = null,
}: {
	run: () => Promise<void>;
	error?: string | null;
}) {
	const [open, setOpen] = useState(true);
	const [pending, setPending] = useState(false);
	return (
		<ConfirmActionDialog
			open={open}
			onOpenChange={setOpen}
			title='Delete "Night shift"?'
			description="This cannot be undone."
			confirmLabel="Delete"
			pendingLabel="Deleting…"
			isPending={pending}
			error={error}
			onConfirm={() => {
				setPending(true);
				void run().then(() => {
					setPending(false);
					setOpen(false);
				});
			}}
		/>
	);
}

describe("ConfirmActionDialog", () => {
	it("stays open while the action runs, blocks a second press and Cancel, then closes on success", async () => {
		let finish: () => void = () => {};
		const run = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		render(<Harness run={run} />);

		fireEvent.click(screen.getByRole("button", { name: "Delete" }));
		const pending = await screen.findByRole("button", { name: "Deleting…" });
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		expect((pending as HTMLButtonElement).disabled).toBe(true);
		expect((screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
		fireEvent.click(pending);
		fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
		expect(run).toHaveBeenCalledTimes(1);
		expect(screen.getByRole("alertdialog")).toBeTruthy();

		await act(async () => finish());
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
	});

	it("shows a failure inline", () => {
		render(<Harness run={() => new Promise(() => {})} error="The shift is still assigned." />);
		expect(screen.getByRole("alert").textContent).toBe("The shift is still assigned.");
	});

	it("names the record in the delete confirmation", () => {
		render(
			<DeleteConfirmDialog
				open
				onOpenChange={() => {}}
				title="Delete policy"
				description='Delete "Weekend rules"?'
				isDeleting={false}
				onConfirm={() => {}}
			/>,
		);
		expect(screen.getByRole("alertdialog").textContent).toContain('Delete "Weekend rules"?');
		expect(screen.getByRole("button", { name: "Delete" })).toBeTruthy();
	});
});

describe("useConfirmedAction", () => {
	it("closes after the action resolves and keeps the worded failure open otherwise", async () => {
		const { result } = renderHook(() => useConfirmedAction<{ id: string }>());

		act(() => result.current.request({ id: "a" }));
		expect(result.current.open).toBe(true);

		await act(() =>
			result.current.confirm(
				async () => {
					throw new Error("Refused by the server");
				},
				(failure) => describeFailure(failure, "Fallback"),
			),
		);
		expect(result.current.open).toBe(true);
		expect(result.current.error).toBe("Refused by the server");

		await act(() => result.current.confirm(async () => {}, () => "unused"));
		expect(result.current.open).toBe(false);
		expect(result.current.error).toBeNull();
		// The record stays for the closing animation.
		expect(result.current.target).toEqual({ id: "a" });
	});

	it("ignores close requests and a second confirmation while the action runs", async () => {
		const { result } = renderHook(() => useConfirmedAction<string>());
		let finish: () => void = () => {};
		const run = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		act(() => result.current.request("row"));
		let first: Promise<void> = Promise.resolve();
		act(() => {
			first = result.current.confirm(run, () => "failed");
		});
		expect(result.current.isPending).toBe(true);
		act(() => result.current.onOpenChange(false));
		await act(() => result.current.confirm(run, () => "failed"));
		expect(result.current.open).toBe(true);
		expect(run).toHaveBeenCalledTimes(1);
		await act(async () => {
			finish();
			await first;
		});
		expect(result.current.open).toBe(false);
	});

	it("words a non-Error failure with the fallback", () => {
		expect(describeFailure(null, "Fallback")).toBe("Fallback");
		expect(describeFailure("Plain", "Fallback")).toBe("Plain");
	});
});
