"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconGripVertical } from "@tabler/icons-react";
import type { CSSProperties, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { WidgetId } from "./widget-registry";
import { useRegisterVisibleWidget } from "./widget-visibility-context";

interface DashboardWidgetProps {
	/** Unique widget ID for sorting */
	id: WidgetId;
	/** Widget content - if null/undefined, widget won't render */
	children: ReactNode;
}

/**
 * Dashboard widget wrapper that handles:
 * - Drag and drop sorting
 * - Visibility registration
 * - Conditional rendering (returns null if no children)
 *
 * Use this wrapper in your widget components:
 * ```tsx
 * function MyWidget() {
 *   const { data } = useQuery(...);
 *   if (!data) return null;
 *
 *   return (
 *     <DashboardWidget id="my-widget">
 *       <Card>...</Card>
 *     </DashboardWidget>
 *   );
 * }
 * ```
 */
export function DashboardWidget({ id, children }: DashboardWidgetProps) {
	// Register as visible when mounted
	useRegisterVisibleWidget(id);

	const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
		id,
	});

	const style: CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
		opacity: isDragging ? 0.4 : 1,
	};

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn("relative group", isDragging && "z-50")}
			data-widget-id={id}
			data-dragging={isDragging}
		>
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
