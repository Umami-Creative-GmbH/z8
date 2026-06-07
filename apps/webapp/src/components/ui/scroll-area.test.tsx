/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScrollArea, ScrollBar } from "./scroll-area";

describe("ScrollArea", () => {
	it("preserves wrapper slots while using the Base UI viewport", () => {
		render(
			<ScrollArea className="h-24 custom-scroll-area" data-testid="scroll-area">
				<div>Scrollable content</div>
				<ScrollBar data-testid="horizontal-scrollbar" keepMounted orientation="horizontal" />
			</ScrollArea>,
		);

		const root = screen.getByTestId("scroll-area");
		const viewport = root.querySelector('[data-slot="scroll-area-viewport"]');
		const content = viewport?.querySelector('[data-slot="scroll-area-content"]');
		const scrollbar = screen.getByTestId("horizontal-scrollbar");

		expect(root.dataset.slot).toBe("scroll-area");
		expect(root.className).toContain("custom-scroll-area");
		expect(viewport).toBeTruthy();
		expect(viewport?.classList.contains("base-ui-disable-scrollbar")).toBe(true);
		expect(content).toBeTruthy();
		expect(content?.textContent).toContain("Scrollable content");
		expect(scrollbar.dataset.slot).toBe("scroll-area-scrollbar");
		expect(scrollbar.querySelector('[data-slot="scroll-area-thumb"]')).toBeTruthy();
	});
});
