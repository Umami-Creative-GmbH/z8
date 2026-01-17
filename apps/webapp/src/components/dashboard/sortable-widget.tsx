"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WidgetId } from "./widget-registry";

interface SortableWidgetProps {
	id: WidgetId;
	children: ReactNode;
}

/**
 * Wrapper component that makes a widget sortable via drag-and-drop.
 * Adds a drag handle to the widget that appears on hover.
 */
export function SortableWidget({ id, children }: SortableWidgetProps) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({ id });

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				"relative group",
				isDragging && "z-50 opacity-90 scale-[1.02] shadow-2xl",
			)}
			data-dragging={isDragging}
		>
			{/* Drag handle - positioned absolutely at top-right of widget */}
			<Button
				variant="ghost"
				size="icon"
				className={cn(
					"absolute -top-2 -right-2 z-10 size-7",
					"opacity-0 group-hover:opacity-100 transition-opacity",
					"bg-background border shadow-sm",
					"cursor-grab active:cursor-grabbing",
					"hover:bg-muted",
					isDragging && "opacity-100 cursor-grabbing",
				)}
				{...attributes}
				{...listeners}
				aria-label="Drag to reorder widget"
			>
				<IconGripVertical className="size-4 text-muted-foreground" aria-hidden="true" />
			</Button>
			{children}
		</div>
	);
}
