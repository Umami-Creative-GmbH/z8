/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { DashboardWidget } from "./dashboard-widget";
import { SortableWidgetGrid } from "./sortable-widget-grid";

vi.mock("@dnd-kit/core", () => ({
	closestCenter: vi.fn(),
	DndContext: ({ children }: { children: ReactNode }) => (
		<div data-testid="dnd-context">{children}</div>
	),
	DragOverlay: ({ children }: { children: ReactNode }) => (
		<div data-testid="drag-overlay">{children}</div>
	),
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

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string) => fallback,
	}),
}));

vi.mock("./widget-visibility-context", () => ({
	useRegisterVisibleWidget: vi.fn(),
	useVisibleWidgets: () => ["quick-stats", "presence-status"],
}));

function ProductionLikeWidget() {
	return <DashboardWidget id="quick-stats">Time tracking</DashboardWidget>;
}

describe("SortableWidgetGrid", () => {
	it("renders widgets in a responsive masonry container", () => {
		render(
			<SortableWidgetGrid onReorder={vi.fn()} widgetOrder={["quick-stats", "presence-status"]}>
				<DashboardWidget id="quick-stats">Time tracking</DashboardWidget>
				<DashboardWidget id="presence-status">Presence status</DashboardWidget>
			</SortableWidgetGrid>,
		);

		const widget = screen.getByText("Time tracking").closest("[data-widget-id]");
		const container = widget?.parentElement;

		expect(container?.className).toContain("[--masonry-columns:1]");
		expect(container?.className).toContain("@xl/main:[--masonry-columns:2]");
		expect(container?.className).toContain("@5xl/main:[--masonry-columns:3]");
		expect(container?.className).toContain("@[110rem]/main:[--masonry-columns:4]");
		// Without measurement (server render, no ResizeObserver) it stays a balanced column layout.
		expect(container?.className).toContain("columns-(--masonry-columns)");
		expect(container?.getAttribute("data-masonry")).toBeNull();
	});

	it("uses a plain container when the caller supplies its own layout", () => {
		render(
			<SortableWidgetGrid className="space-y-6" onReorder={vi.fn()} widgetOrder={["quick-stats"]}>
				<DashboardWidget id="quick-stats">Time tracking</DashboardWidget>
			</SortableWidgetGrid>,
		);

		const widget = screen.getByText("Time tracking").closest("[data-widget-id]");

		expect(widget?.parentElement?.className).toBe("space-y-6");
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
