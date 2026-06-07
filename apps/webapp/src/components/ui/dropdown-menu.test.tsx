/* @vitest-environment jsdom */

import { readFile } from "node:fs/promises";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuTrigger,
} from "./dropdown-menu";

async function readComponentSource(fileName: string) {
	return readFile(new URL(fileName, import.meta.url), "utf8");
}

function expectSubmenuContentUsesPortal(
	source: string,
	functionName: string,
	primitiveName: string,
) {
	const functionStart = source.indexOf(`function ${functionName}(`);
	const nextFunction = source.indexOf("\nfunction ", functionStart + 1);
	const functionSource = source.slice(
		functionStart,
		nextFunction === -1 ? undefined : nextFunction,
	);

	expect(functionStart).toBeGreaterThanOrEqual(0);
	expect(functionSource).toMatch(
		new RegExp(
			`<${primitiveName}\\.Portal>\\s*<${primitiveName}\\.Positioner[\\s\\S]*<${primitiveName}\\.Popup`,
		),
	);
}

describe("DropdownMenu", () => {
	it("opens menu items from its trigger", async () => {
		const user = userEvent.setup();

		render(
			<DropdownMenu>
				<DropdownMenuTrigger>Open actions</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem>Archive</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>,
		);

		await user.click(screen.getByRole("button", { name: "Open actions" }));

		expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
	});

	it("opens menu items from a Radix-compatible pointer down trigger", async () => {
		render(
			<DropdownMenu>
				<DropdownMenuTrigger>Open actions</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem>Archive</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>,
		);

		fireEvent.pointerDown(screen.getByRole("button", { name: "Open actions" }), {
			button: 0,
			ctrlKey: false,
		});

		expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
	});

	it("opens asChild button menu items from a Radix-compatible pointer down trigger", async () => {
		render(
			<DropdownMenu>
				<DropdownMenuTrigger asChild>
					<Button>Open actions</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem>Archive</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>,
		);

		fireEvent.pointerDown(screen.getByRole("button", { name: "Open actions" }), {
			button: 0,
			ctrlKey: false,
		});

		expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
	});

	it("opens controlled asChild menu items from a Radix-compatible pointer down trigger", async () => {
		function ControlledMenu() {
			const [open, setOpen] = useState(false);

			return (
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<DropdownMenuTrigger asChild>
						<Button>Open actions</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem>Archive</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			);
		}

		render(<ControlledMenu />);

		fireEvent.pointerDown(screen.getByRole("button", { name: "Open actions" }), {
			button: 0,
			ctrlKey: false,
		});

		expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
	});

	it("opens controlled asChild menu items from a bare fireEvent pointer down", async () => {
		function ControlledMenu() {
			const [open, setOpen] = useState(false);

			return (
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<DropdownMenuTrigger asChild>
						<Button>Open actions</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem>Archive</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			);
		}

		render(<ControlledMenu />);

		fireEvent.pointerDown(screen.getByRole("button", { name: "Open actions" }));

		expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
	});

	it("opens controlled icon-only asChild menu items from a bare fireEvent pointer down", async () => {
		function ControlledMenu() {
			const [open, setOpen] = useState(false);

			return (
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<DropdownMenuTrigger asChild>
						<Button aria-label="Open actions" size="icon">
							<span aria-hidden="true">*</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem>Archive</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			);
		}

		render(<ControlledMenu />);

		fireEvent.pointerDown(screen.getByRole("button", { name: "Open actions" }));

		expect(await screen.findByRole("menuitem", { name: "Archive" })).toBeTruthy();
	});

	it("makes controlled asChild menu items available synchronously after pointer down", () => {
		function ControlledMenu() {
			const [open, setOpen] = useState(false);

			return (
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<DropdownMenuTrigger asChild>
						<Button aria-label="Open actions" size="icon">
							<span aria-hidden="true">*</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent>
						<DropdownMenuItem>Archive</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			);
		}

		render(<ControlledMenu />);

		fireEvent.pointerDown(screen.getByRole("button", { name: "Open actions" }));

		expect(screen.getByRole("menuitem", { name: "Archive" })).toBeTruthy();
	});

	it("renders labels directly inside menu content", () => {
		render(
			<DropdownMenu open={true}>
				<DropdownMenuTrigger>Open actions</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuLabel>Actions</DropdownMenuLabel>
					<DropdownMenuItem>Archive</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>,
		);

		expect(screen.getByText("Actions")).toBeTruthy();
	});

	it("preserves disabled state on asChild menu item buttons", () => {
		render(
			<DropdownMenu open={true}>
				<DropdownMenuTrigger>Open actions</DropdownMenuTrigger>
				<DropdownMenuContent>
					<DropdownMenuItem asChild disabled={true}>
						<Button disabled={true}>Archive</Button>
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>,
		);

		expect((screen.getByRole("menuitem", { name: "Archive" }) as HTMLButtonElement).disabled).toBe(
			true,
		);
	});

	it("keeps submenu content popups inside their Base UI portals", async () => {
		const [dropdownMenuSource, contextMenuSource, menubarSource] = await Promise.all([
			readComponentSource("dropdown-menu.tsx"),
			readComponentSource("context-menu.tsx"),
			readComponentSource("menubar.tsx"),
		]);

		expectSubmenuContentUsesPortal(
			dropdownMenuSource,
			"DropdownMenuSubContent",
			"DropdownMenuPrimitive",
		);
		expectSubmenuContentUsesPortal(
			contextMenuSource,
			"ContextMenuSubContent",
			"ContextMenuPrimitive",
		);
		expectSubmenuContentUsesPortal(menubarSource, "MenubarSubContent", "MenuPrimitive");
	});

	it("uses the Base UI data-active presence selector for navigation links", async () => {
		const source = await readComponentSource("navigation-menu.tsx");

		expect(source).toContain("data-[active]:bg-accent/50");
		expect(source).not.toContain("data-[active=true]");
	});
});
