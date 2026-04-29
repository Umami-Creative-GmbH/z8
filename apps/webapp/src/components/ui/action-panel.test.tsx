/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
		const source = readFileSync(
			join(process.cwd(), "src/components/ui/action-panel.tsx"),
			"utf8",
		);

		expect(source).toContain("SheetContent");
		expect(source).not.toContain("DialogPrimitive");
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

	it("supports width variants", () => {
		const { rerender } = render(
			<ActionPanel open>
				<ActionPanelContent size="compact">
					<ActionPanelTitle>Compact panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.getByRole("dialog", { name: "Compact panel" }).className).toContain("sm:max-w-md");

		rerender(
			<ActionPanel open>
				<ActionPanelContent size="wide">
					<ActionPanelTitle>Wide panel</ActionPanelTitle>
				</ActionPanelContent>
			</ActionPanel>,
		);

		expect(screen.getByRole("dialog", { name: "Wide panel" }).className).toContain("lg:max-w-3xl");
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
