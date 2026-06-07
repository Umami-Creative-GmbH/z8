/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it } from "vitest";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./sheet";

describe("Sheet", () => {
	it("opens an accessible right-side sheet from its trigger", async () => {
		const user = userEvent.setup();

		render(
			<Sheet>
				<SheetTrigger>Open sheet</SheetTrigger>
				<SheetContent side="right">
					<SheetTitle>Employee details</SheetTitle>
				</SheetContent>
			</Sheet>,
		);

		await user.click(screen.getByRole("button", { name: "Open sheet" }));

		expect(screen.getByRole("dialog", { name: "Employee details" })).toBeTruthy();
	});

	it("keeps the sheet open when onPointerDownOutside prevents dismissal", async () => {
		const user = userEvent.setup();

		function ControlledSheet() {
			const [open, setOpen] = React.useState(true);

			return (
				<>
					<button type="button">Outside target</button>
					<Sheet open={open} onOpenChange={setOpen}>
						<SheetContent
							onPointerDownOutside={(event) => event.preventDefault()}
							showCloseButton={false}
						>
							<SheetTitle>Protected panel</SheetTitle>
						</SheetContent>
					</Sheet>
				</>
			);
		}

		render(<ControlledSheet />);

		const overlay = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');
		expect(overlay).toBeTruthy();

		await user.click(overlay as HTMLElement);

		expect(screen.getByRole("dialog", { name: "Protected panel" })).toBeTruthy();
	});
});
