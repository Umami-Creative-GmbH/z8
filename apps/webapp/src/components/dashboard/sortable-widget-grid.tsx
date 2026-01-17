"use client";

import {
	closestCenter,
	DndContext,
	type DragEndEvent,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	rectSortingStrategy,
	SortableContext,
} from "@dnd-kit/sortable";
import type { ReactNode } from "react";
import { useId } from "react";
import type { WidgetId } from "./widget-registry";

interface SortableWidgetGridProps {
	/** Current widget order */
	widgetOrder: WidgetId[];
	/** Called when widgets are reordered */
	onReorder: (newOrder: WidgetId[]) => void;
	/** Children (should be SortableWidget components) */
	children: ReactNode;
}

/**
 * Grid container that enables drag-and-drop reordering of widgets.
 * Uses dnd-kit with rect sorting strategy for grid layouts.
 */
export function SortableWidgetGrid({
	widgetOrder,
	onReorder,
	children,
}: SortableWidgetGridProps) {
	const sortableId = useId();

	// Configure sensors for mouse, touch, and keyboard interaction
	const sensors = useSensors(
		useSensor(MouseSensor, {
			// Require a small drag distance before activating
			activationConstraint: {
				distance: 8,
			},
		}),
		useSensor(TouchSensor, {
			// Require a small delay for touch to differentiate from scroll
			activationConstraint: {
				delay: 200,
				tolerance: 5,
			},
		}),
		useSensor(KeyboardSensor, {}),
	);

	function handleDragEnd(event: DragEndEvent) {
		const { active, over } = event;

		if (active && over && active.id !== over.id) {
			const oldIndex = widgetOrder.indexOf(active.id as WidgetId);
			const newIndex = widgetOrder.indexOf(over.id as WidgetId);

			if (oldIndex !== -1 && newIndex !== -1) {
				const newOrder = arrayMove(widgetOrder, oldIndex, newIndex);
				onReorder(newOrder);
			}
		}
	}

	return (
		<DndContext
			collisionDetection={closestCenter}
			id={sortableId}
			onDragEnd={handleDragEnd}
			sensors={sensors}
		>
			<SortableContext items={widgetOrder} strategy={rectSortingStrategy}>
				<div className="grid @5xl/main:grid-cols-3 @xl/main:grid-cols-2 grid-cols-1 gap-4 px-4 lg:px-6">
					{children}
				</div>
			</SortableContext>
		</DndContext>
	);
}
