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
import { type ReactNode, useId, useState } from "react";
import type { WidgetId } from "./widget-registry";
import { useVisibleWidgets } from "./widget-visibility-context";

interface SortableWidgetGridProps {
	/** Full widget order (including hidden ones for persistence) */
	widgetOrder: WidgetId[];
	/** Called when widgets are reordered */
	onReorder: (newOrder: WidgetId[]) => void;
	/** Children (widget components that wrap themselves in DashboardWidget) */
	children: ReactNode;
}

/**
 * Grid container that enables drag-and-drop reordering of widgets.
 * Uses visibility context to only include actually-rendered widgets in sortable context.
 */
export function SortableWidgetGrid({ widgetOrder, onReorder, children }: SortableWidgetGridProps) {
	const sortableId = useId();
	const [activeId, setActiveId] = useState<WidgetId | null>(null);

	// Get only the widgets that are actually visible/rendered
	const visibleWidgets = useVisibleWidgets();

	// Filter widgetOrder to only include visible widgets, maintaining order
	const sortableItems = widgetOrder.filter((id) => visibleWidgets.includes(id));

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
				const hiddenWidgets = widgetOrder.filter((id) => !visibleWidgets.includes(id));

				// Create final order: visible widgets in new order + hidden widgets at the end
				const newOrder = [...newVisibleOrder, ...hiddenWidgets];
				onReorder(newOrder);
			}
		}
	}

	function handleDragCancel() {
		setActiveId(null);
	}

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
				<div className="grid @5xl/main:grid-cols-3 @xl/main:grid-cols-2 grid-cols-1 gap-4 px-4 lg:px-6 items-start">
					{children}
				</div>
			</SortableContext>
			<DragOverlay dropAnimation={null}>
				{activeId ? (
					<div className="opacity-90 scale-[1.02] shadow-2xl rounded-xl bg-card">
						{/* Placeholder for drag overlay */}
						<div className="p-6 text-muted-foreground text-center">Moving widget...</div>
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}
