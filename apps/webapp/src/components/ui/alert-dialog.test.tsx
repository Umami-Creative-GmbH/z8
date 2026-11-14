/* @vitest-environment jsdom */

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { render } from "@/test/render-with-translations";
import {
	ActionPanel,
	ActionPanelContent,
	ActionPanelTitle,
	ActionPanelTrigger,
} from "./action-panel";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "./alert-dialog";

describe("consequential confirmation compatibility", () => {
	it("honors a consumer's Escape veto while a confirmation is pending", async () => {
		const user = userEvent.setup();
		render(
			<AlertDialog defaultOpen>
				<AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
					<AlertDialogTitle>Delete record</AlertDialogTitle>
				</AlertDialogContent>
			</AlertDialog>,
		);
		await user.keyboard("{Escape}");
		expect(
			screen.queryByRole("alertdialog", { name: "Delete record" }),
		).not.toBeNull();
	});

	it("returns focus from a nested confirmation to the panel action, then its trigger", async () => {
		const user = userEvent.setup();
		render(
			<ActionPanel>
				<ActionPanelTrigger>Open edit</ActionPanelTrigger>
				<ActionPanelContent>
					<ActionPanelTitle>Edit record</ActionPanelTitle>
					<AlertDialog>
						<AlertDialogTrigger>Delete record</AlertDialogTrigger>
						<AlertDialogContent>
							<AlertDialogTitle>Confirm deletion</AlertDialogTitle>
							<AlertDialogCancel>Keep record</AlertDialogCancel>
						</AlertDialogContent>
					</AlertDialog>
				</ActionPanelContent>
			</ActionPanel>,
		);
		await user.click(screen.getByRole("button", { name: "Open edit" }));
		await user.click(screen.getByRole("button", { name: "Delete record" }));
		await user.click(screen.getByRole("button", { name: "Keep record" }));
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("button", { name: "Delete record" }),
			),
		);
		await user.keyboard("{Escape}");
		await waitFor(() =>
			expect(document.activeElement).toBe(
				screen.getByRole("button", { name: "Open edit" }),
			),
		);
	});
});
