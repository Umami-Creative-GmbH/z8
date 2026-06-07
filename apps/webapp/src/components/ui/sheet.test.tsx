/* @vitest-environment jsdom */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

	it("uses wrapper-owned CSS state instead of Web Animations for closing", async () => {
		const user = userEvent.setup();

		function ControlledSheet() {
			const [open, setOpen] = React.useState(true);

			return (
				<Sheet open={open} onOpenChange={setOpen}>
					<SheetContent>
						<SheetTitle>Animated panel</SheetTitle>
					</SheetContent>
				</Sheet>
			);
		}

		render(<ControlledSheet />);

		await user.click(screen.getByRole("button", { name: "Close" }));

		const overlay = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');
		const dialog = screen.getByRole("dialog", { name: "Animated panel" });

		expect(overlay?.getAttribute("data-sheet-open")).toBe("false");
		expect(dialog.getAttribute("data-sheet-open")).toBe("false");
	});

	it("uses wrapper-owned CSS state for opening", async () => {
		const user = userEvent.setup();

		render(
			<Sheet>
				<SheetTrigger>Open animated sheet</SheetTrigger>
				<SheetContent>
					<SheetTitle>Opening panel</SheetTitle>
				</SheetContent>
			</Sheet>,
		);

		await user.click(screen.getByRole("button", { name: "Open animated sheet" }));

		const overlay = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]');
		const dialog = screen.getByRole("dialog", { name: "Opening panel" });

		expect(overlay?.className).toContain("transition-opacity");
		expect(dialog.className).toContain("transition-transform");
	});

	it("uses wrapper-owned lifecycle without Web Animations", async () => {
		const source = await readFile(join(process.cwd(), "src/components/ui/sheet.tsx"), "utf8");

		expect(source).toContain("renderedOpen");
		expect(source).toContain("visualOpen");
		expect(source).toContain("SHEET_CLOSE_DURATION_MS");
		expect(source).not.toContain("preventUnmountOnClose");
		expect(source).not.toContain("commitStyles");
		expect(source).not.toContain("animate(");
		expect(source).not.toContain("motion-safe:data-[starting-style]:animate-in");
		expect(source).not.toContain("motion-safe:data-[ending-style]:animate-out");
	});
});
