/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "./action-panel";

describe("ActionPanel", () => {
	it("composes the Sheet primitive instead of Radix dialog internals", () => {
		const source = readFileSync(join(process.cwd(), "src/components/ui/action-panel.tsx"), "utf8");

		expect(source).toContain("SheetContent");
		expect(source).not.toContain("DialogPrimitive");
		expect(source).not.toContain("data-action-panel-hide-close");
		expect(source).not.toContain("<style");
	});

	it("renders an accessible right-side panel shell", () => {
		render(
			<ActionPanel open>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>Panel title</ActionPanelTitle>
						<ActionPanelDescription>Panel description</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>Panel body</ActionPanelBody>
					<ActionPanelFooter>Panel footer</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.getByRole("dialog", { name: "Panel title" })).toBeTruthy();
		expect(screen.getByText("Panel description")).toBeTruthy();
		expect(screen.getByText("Panel body")).toBeTruthy();
		expect(screen.getByText("Panel footer")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
	});

	it("always renders from the right side", () => {
		render(
			<ActionPanel open>
				{/* @ts-expect-error ActionPanelContent intentionally disallows side in its public API. */}
				<ActionPanelContent side="left">
					<ActionPanelTitle>Right-only panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		const dialogClassName = screen.getByRole("dialog", { name: "Right-only panel" }).className;

		expect(dialogClassName).toContain("right-0");
		expect(dialogClassName).not.toContain("left-0");
	});

	it("supports width variants", () => {
		const { rerender } = render(
			<ActionPanel open>
				<ActionPanelContent size="compact">
					<ActionPanelTitle>Compact panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.getByRole("dialog", { name: "Compact panel" }).className).toContain(
			"sm:max-w-md",
		);

		rerender(
			<ActionPanel open>
				<ActionPanelContent size="wide">
					<ActionPanelTitle>Wide panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.getByRole("dialog", { name: "Wide panel" }).className).toContain("lg:max-w-3xl");
	});

	it("uses mobile-safe width and stacked footer actions", () => {
		render(
			<ActionPanel open>
				<ActionPanelContent>
					<ActionPanelTitle>Responsive panel</ActionPanelTitle>
					<ActionPanelFooter>Footer actions</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>,
		);

		const dialogClassName = screen.getByRole("dialog", { name: "Responsive panel" }).className;
		expect(dialogClassName).toContain("w-[calc(100vw-0.75rem)]");
		expect(dialogClassName).toContain("sm:w-3/4");
		expect(screen.getByText("Footer actions").className).toContain("flex-col-reverse");
		expect(screen.getByText("Footer actions").className).toContain("*:w-full");
		expect(screen.getByText("Footer actions").className).toContain("sm:*:w-auto");
	});

	it("uses the muted sheet surface", () => {
		render(
			<ActionPanel open>
				<ActionPanelContent>
					<ActionPanelTitle>Form panel</ActionPanelTitle>
					<ActionPanelDescription>Form panel description</ActionPanelDescription>
				</ActionPanelContent>
			</ActionPanel>,
		);

		const dialogClassName = screen.getByRole("dialog", { name: "Form panel" }).className;
		expect(dialogClassName).toContain("bg-muted");
	});

	it("uses animated sheet transitions", () => {
		render(
			<ActionPanel open>
				<ActionPanelContent>
					<ActionPanelTitle>Animated panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		const dialogClassName = screen.getByRole("dialog", { name: "Animated panel" }).className;

		expect(dialogClassName).toContain("motion-safe:data-[state=open]:animate-in");
		expect(dialogClassName).toContain("motion-safe:data-[state=closed]:animate-out");
		expect(dialogClassName).toContain("data-[state=open]:slide-in-from-right-full");
		expect(dialogClassName).toContain("data-[state=closed]:slide-out-to-right-full");
		expect(dialogClassName).toContain("data-[state=open]:duration-300");
		expect(dialogClassName).toContain("data-[state=closed]:duration-200");
	});

	it("can hide the close button", () => {
		render(
			<ActionPanel open>
				<ActionPanelContent showCloseButton={false}>
					<ActionPanelTitle>No close panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
	});
});
