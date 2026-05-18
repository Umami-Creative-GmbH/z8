/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DashboardWidget } from "./dashboard-widget";

vi.mock("./widget-visibility-context", () => ({
	useRegisterVisibleWidget: vi.fn(),
}));

vi.mock("@dnd-kit/sortable", () => ({
	useSortable: () => ({
		attributes: { role: "button" },
		listeners: { onPointerDown: vi.fn() },
		setNodeRef: vi.fn(),
		transform: null,
		transition: undefined,
		isDragging: false,
	}),
}));

vi.mock("@dnd-kit/utilities", () => ({
	CSS: {
		Translate: {
			toString: () => undefined,
		},
	},
}));

describe("DashboardWidget", () => {
	it("renders as a masonry item that avoids column breaks", () => {
		render(
			<DashboardWidget id="quick-stats">
				<div>Time tracking content</div>
			</DashboardWidget>,
		);

		const widget = screen.getByText("Time tracking content").closest("[data-widget-id]");

		expect(widget?.className).toContain("break-inside-avoid");
		expect(widget?.className).toContain("mb-4");
	});

	it("does not expose a drag handle when dragging is disabled", () => {
		render(
			<DashboardWidget draggable={false} id="quick-stats">
				<div>Time tracking content</div>
			</DashboardWidget>,
		);

		expect(screen.queryByRole("button", { name: "Drag to reorder widget" })).toBeNull();
	});
});
