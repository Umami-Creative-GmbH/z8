/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "./button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "./dialog";

describe("Dialog", () => {
	it("opens an accessible dialog from its trigger", async () => {
		const user = userEvent.setup();

		render(
			<Dialog>
				<DialogTrigger>Open dialog</DialogTrigger>
				<DialogContent>
					<DialogTitle>Schedule review</DialogTitle>
				</DialogContent>
			</Dialog>,
		);

		await user.click(screen.getByRole("button", { name: "Open dialog" }));

		expect(screen.getByRole("dialog", { name: "Schedule review" })).toBeTruthy();
	});

	it("treats a Z8 Button as a native button when used asChild", async () => {
		const user = userEvent.setup();
		const onClick = vi.fn();

		render(
			<Dialog defaultOpen>
				<DialogContent showCloseButton={false}>
					<DialogTitle>Schedule review</DialogTitle>
					<DialogClose asChild>
						<Button onClick={onClick}>Close review</Button>
					</DialogClose>
				</DialogContent>
			</Dialog>,
		);

		const closeButton = screen.getByRole("button", { name: "Close review" });
		closeButton.focus();

		expect(closeButton.tagName).toBe("BUTTON");
		expect(closeButton.getAttribute("role")).toBeNull();

		await user.keyboard("{Enter}");

		expect(onClick).toHaveBeenCalledTimes(1);
	});
});
