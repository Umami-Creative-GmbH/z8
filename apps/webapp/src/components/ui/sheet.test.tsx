/* @vitest-environment jsdom */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@/test/render-with-translations";

import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from "./sheet";

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

		expect(
			screen.getByRole("dialog", { name: "Employee details" }),
		).toBeTruthy();
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

		const overlay = document.querySelector<HTMLElement>(
			'[data-slot="sheet-overlay"]',
		);
		expect(overlay).toBeTruthy();

		await user.click(overlay as HTMLElement);

		expect(
			screen.getByRole("dialog", { name: "Protected panel" }),
		).toBeTruthy();
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

		const overlay = document.querySelector<HTMLElement>(
			'[data-slot="sheet-overlay"]',
		);
		const dialog = screen.getByRole("dialog", { name: "Animated panel" });

		expect(overlay?.getAttribute("data-sheet-open")).toBe("false");
		expect(dialog.getAttribute("data-sheet-open")).toBe("false");
	});

	it("passes the safe-area insets of the screen edges a side sheet touches (#846)", () => {
		render(
			<Sheet defaultOpen>
				<SheetContent side="right">
					<SheetTitle>Edge panel</SheetTitle>
				</SheetContent>
			</Sheet>,
		);

		const dialog = screen.getByRole("dialog", { name: "Edge panel" });
		expect(dialog.className).toContain("[--sheet-inset-top:env(safe-area-inset-top)]");
		expect(dialog.className).toContain("[--sheet-inset-bottom:env(safe-area-inset-bottom)]");
	});

	it("lets a bottom sheet clear only the home indicator (#846)", () => {
		render(
			<Sheet defaultOpen>
				<SheetContent side="bottom">
					<SheetTitle>Bottom panel</SheetTitle>
				</SheetContent>
			</Sheet>,
		);

		const dialog = screen.getByRole("dialog", { name: "Bottom panel" });
		expect(dialog.className).not.toContain("--sheet-inset-top");
		expect(dialog.className).toContain("[--sheet-inset-bottom:env(safe-area-inset-bottom)]");
	});

	it("keeps header, footer and close button clear of the status bar and home indicator (#846)", () => {
		render(
			<Sheet defaultOpen>
				<SheetContent side="right">
					<SheetHeader>
						<SheetTitle>Inset panel</SheetTitle>
					</SheetHeader>
					<SheetFooter>Footer</SheetFooter>
				</SheetContent>
			</Sheet>,
		);

		const header = document.querySelector('[data-slot="sheet-header"]');
		const footer = document.querySelector('[data-slot="sheet-footer"]');
		const close = screen.getByRole("button", { name: "Close" });
		expect(header?.className).toContain("mt-[var(--sheet-inset-top,0px)]");
		expect(footer?.className).toContain("mb-[var(--sheet-inset-bottom,0px)]");
		expect(close.className).toContain("top-[calc(1rem+var(--sheet-inset-top,0px))]");
		expect(close.className).toContain("pointer-coarse:after:absolute");
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

		await user.click(
			screen.getByRole("button", { name: "Open animated sheet" }),
		);

		const overlay = document.querySelector<HTMLElement>(
			'[data-slot="sheet-overlay"]',
		);
		const dialog = screen.getByRole("dialog", { name: "Opening panel" });

		expect(overlay?.className).toContain("transition-opacity");
		expect(dialog.className).toContain("transition-transform");
	});

	it("uses CSS keyframes for entry without requestAnimationFrame timing", async () => {
		const sheetSource = await readFile(
			join(process.cwd(), "src/components/ui/sheet.tsx"),
			"utf8",
		);
		const globalsSource = await readFile(
			join(process.cwd(), "src/app/globals.css"),
			"utf8",
		);

		expect(sheetSource).not.toContain("requestAnimationFrame");
		expect(sheetSource).toContain(
			"data-[sheet-open=true]:animate-sheet-fade-in",
		);
		expect(sheetSource).toContain(
			"data-[sheet-side=right]:data-[sheet-open=true]:animate-sheet-enter-right",
		);
		expect(globalsSource).toContain("--animate-sheet-enter-right");
		expect(globalsSource).toContain("@keyframes sheet-enter-right");
	});

	it("uses wrapper-owned lifecycle without Web Animations", async () => {
		const source = await readFile(
			join(process.cwd(), "src/components/ui/sheet.tsx"),
			"utf8",
		);

		expect(source).toContain("renderedOpen");
		expect(source).toContain("visualOpen");
		expect(source).toContain("SHEET_CLOSE_DURATION_MS");
		expect(source).not.toContain("preventUnmountOnClose");
		expect(source).not.toContain("commitStyles");
		expect(source).not.toContain("animate(");
		expect(source).not.toContain(
			"motion-safe:data-[starting-style]:animate-in",
		);
		expect(source).not.toContain("motion-safe:data-[ending-style]:animate-out");
	});
});
