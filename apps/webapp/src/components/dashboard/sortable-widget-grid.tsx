"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	DragOverlay,
	type DragStartEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import { arrayMove, rectSortingStrategy, SortableContext } from "@dnd-kit/sortable";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useId, useState } from "react";
import { DashboardWidgetDraggableProvider } from "./dashboard-widget-draggable-context";
import { StableMasonryGrid } from "./stable-masonry-grid";
import type { WidgetId } from "./widget-registry";
import { useVisibleWidgets } from "./widget-visibility-context";

interface SortableWidgetGridProps {
	/** Current order for widgets rendered by the dashboard grid */
	widgetOrder: WidgetId[];
	/** Called when rendered widgets are reordered */
	onReorder: (newOrder: WidgetId[]) => void;
	/** Children (widget components that wrap themselves in DashboardWidget) */
	children: ReactNode;
	/** Replaces the default masonry grid with a plain container using these classes */
	className?: string;
}

/**
 * Grid container that enables drag-and-drop reordering of widgets.
 * Uses visibility context to only include actually-rendered widgets in sortable context.
 */
export function SortableWidgetGrid({
	widgetOrder,
	onReorder,
	children,
	className,
}: SortableWidgetGridProps) {
	const { t } = useTranslate();
	const sortableId = useId();
	const [activeId, setActiveId] = useState<WidgetId | null>(null);

	// Get only the widgets that are actually visible/rendered
	const visibleWidgets = useVisibleWidgets();
	const visibleWidgetSet = new Set(visibleWidgets);

	// Filter widgetOrder to only include visible widgets, maintaining order
	const sortableItems = widgetOrder.filter((id) => visibleWidgetSet.has(id));

	const sensors = useSensors(
		useSensor(MouseSensor, {
			activationConstraint: {
				distance: 8,
			},
		}),
		useSensor(TouchSensor, {
			activationConstraint: {
				delay: 200,
				tolerance: 5,
			},
		}),
		useSensor(KeyboardSensor, {}),
	);

	function handleDragStart(event: DragStartEvent) {
		setActiveId(event.active.id as WidgetId);
	}

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;
		setActiveId(null);

		if (active && over && active.id !== over.id) {
			// Reorder only the visible widgets
			const oldIndex = sortableItems.indexOf(active.id as WidgetId);
			const newIndex = sortableItems.indexOf(over.id as WidgetId);

			if (oldIndex !== -1 && newIndex !== -1) {
				const newVisibleOrder = arrayMove(sortableItems, oldIndex, newIndex);

				// Merge back with hidden widgets, preserving their relative positions
				const hiddenWidgets = widgetOrder.filter((id) => !visibleWidgetSet.has(id));

				// Create final order: visible widgets in new order + hidden widgets at the end
				const newOrder = [...newVisibleOrder, ...hiddenWidgets];
				onReorder(newOrder);
			}
		}
	}

	function handleDragCancel() {
		setActiveId(null);
	}

	const widgets = (
		<DashboardWidgetDraggableProvider value={false}>{children}</DashboardWidgetDraggableProvider>
	);

	return (
		<DndContext
			collisionDetection={closestCenter}
			id={sortableId}
			onDragCancel={handleDragCancel}
			onDragEnd={handleDragEnd}
			onDragStart={handleDragStart}
			sensors={sensors}
		>
			<SortableContext items={sortableItems} strategy={rectSortingStrategy}>
				{className ? (
					<div className={className}>{widgets}</div>
				) : (
					<StableMasonryGrid className="[--masonry-columns:1] @xl/main:[--masonry-columns:2] @5xl/main:[--masonry-columns:3] @[110rem]/main:[--masonry-columns:4]">
						{widgets}
					</StableMasonryGrid>
				)}
			</SortableContext>
			<DragOverlay dropAnimation={null}>
				{activeId ? (
					<div className="opacity-90 scale-[1.02] shadow-2xl rounded-xl bg-card">
						{/* Placeholder for drag overlay */}
						<div className="p-6 text-muted-foreground text-center">
							{t("dashboard.widgets.moving", "Moving widget…")}
						</div>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
