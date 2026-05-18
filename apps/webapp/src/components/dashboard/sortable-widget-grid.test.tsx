/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DashboardWidget } from "./dashboard-widget";
import { SortableWidgetGrid } from "./sortable-widget-grid";

vi.mock("@dnd-kit/core", () => ({
	closestCenter: vi.fn(),
	DndContext: ({ children }: { children: ReactNode }) => <div data-testid="dnd-context">{children}</div>,
	DragOverlay: ({ children }: { children: ReactNode }) => <div data-testid="drag-overlay">{children}</div>,
	KeyboardSensor: vi.fn(),
	MouseSensor: vi.fn(),
	TouchSensor: vi.fn(),
	useSensor: vi.fn(() => ({})),
	useSensors: vi.fn(() => []),
}));

vi.mock("@dnd-kit/sortable", () => ({
	arrayMove: (items: unknown[], oldIndex: number, newIndex: number) => {
		const nextItems = [...items];
		const [item] = nextItems.splice(oldIndex, 1);
		nextItems.splice(newIndex, 0, item);
		return nextItems;
	},
	rectSortingStrategy: vi.fn(),
	SortableContext: ({ children }: { children: ReactNode }) => (
		<div data-testid="sortable-context">{children}</div>
	),
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

vi.mock("./widget-visibility-context", () => ({
	useRegisterVisibleWidget: vi.fn(),
	useVisibleWidgets: () => ["quick-stats", "presence-status"],
}));

function ProductionLikeWidget() {
	return <DashboardWidget id="quick-stats">Time tracking</DashboardWidget>;
}

describe("SortableWidgetGrid", () => {
	it("renders widgets in a responsive masonry column container", () => {
		render(
			<SortableWidgetGrid onReorder={vi.fn()} widgetOrder={["quick-stats", "presence-status"]}>
				<DashboardWidget id="quick-stats">Time tracking</DashboardWidget>
				<DashboardWidget id="presence-status">Presence status</DashboardWidget>
			</SortableWidgetGrid>,
		);

		const container = screen.getByText("Time tracking").closest(".columns-1");

		expect(container?.className).toContain("columns-1");
		expect(container?.className).toContain("@xl/main:columns-2");
		expect(container?.className).toContain("@5xl/main:columns-3");
		expect(container?.className).toContain("gap-4");
		expect(container?.className).not.toContain("grid-cols");
	});

	it("does not expose nested dashboard widget drag handles in masonry mode", () => {
		render(
			<SortableWidgetGrid onReorder={vi.fn()} widgetOrder={["quick-stats"]}>
				<ProductionLikeWidget />
			</SortableWidgetGrid>,
		);

		expect(screen.queryByRole("button", { name: "Drag to reorder widget" })).toBeNull();
	});
});
