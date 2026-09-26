"use client";

import { IconPencil, IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type RefObject, useEffect, useState } from "react";
import { ContextMenu, ContextMenuContent, ContextMenuItem } from "@/components/ui/context-menu";
import type { CalendarEvent } from "@/lib/calendar/types";

interface MenuTarget {
	event: CalendarEvent;
	x: number;
	y: number;
}

export interface WorkPeriodActions {
	/** Whether the viewer may request changes to this work period. */
	canManage: (event: CalendarEvent) => boolean;
	onEdit: (event: CalendarEvent) => void;
	onDelete: (event: CalendarEvent) => void;
}

interface WorkPeriodContextMenuProps extends WorkPeriodActions {
	containerRef: RefObject<HTMLElement | null>;
	events: CalendarEvent[];
}

const EVENT_SELECTOR = "[data-event-id]";

/** Completed work periods the viewer may change; running ones keep their clock-out action. */
export function resolveContextMenuWorkPeriod(
	events: CalendarEvent[],
	eventId: string | undefined,
	canManage: (event: CalendarEvent) => boolean,
): CalendarEvent | null {
	if (!eventId) return null;
	const event = events.find((candidate) => candidate.id === eventId);
	if (event?.type !== "work_period" || event.metadata.isRunning) return null;
	return canManage(event) ? event : null;
}

function eventElementFrom(target: EventTarget | null, container: HTMLElement) {
	if (!(target instanceof Element)) return null;
	const element = target.closest<HTMLElement>(EVENT_SELECTOR);
	return element !== null && container.contains(element) ? element : null;
}

/**
 * Right-click (or the keyboard context-menu key) on a completed work period in
 * the Schedule-X calendar opens Edit / Delete. Other right-clicks keep the
 * browser's own menu.
 */
export function WorkPeriodContextMenu({
	containerRef,
	events,
	canManage,
	onEdit,
	onDelete,
}: WorkPeriodContextMenuProps) {
	const { t } = useTranslate();
	const [target, setTarget] = useState<MenuTarget | null>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const resolve = (domEvent: MouseEvent) => {
			const element = eventElementFrom(domEvent.target, container);
			return element
				? {
						element,
						event: resolveContextMenuWorkPeriod(events, element.dataset.eventId, canManage),
					}
				: null;
		};

		const handleContextMenu = (domEvent: MouseEvent) => {
			const resolved = resolve(domEvent);
			if (!resolved?.event) return;
			domEvent.preventDefault();
			domEvent.stopPropagation();
			// The keyboard context-menu key reports no pointer position.
			const fromKeyboard = domEvent.clientX === 0 && domEvent.clientY === 0;
			const rect = resolved.element.getBoundingClientRect();
			setTarget({
				event: resolved.event,
				x: fromKeyboard ? rect.left + rect.width / 2 : domEvent.clientX,
				y: fromKeyboard ? rect.top + rect.height / 2 : domEvent.clientY,
			});
		};

		// Schedule-X treats any mouse button as an event click on mouseup; keep
		// the secondary button to the context menu.
		const stopSecondaryButton = (domEvent: MouseEvent) => {
			if (domEvent.button !== 2) return;
			if (resolve(domEvent)?.event) domEvent.stopPropagation();
		};

		container.addEventListener("contextmenu", handleContextMenu, { capture: true });
		container.addEventListener("mousedown", stopSecondaryButton, { capture: true });
		container.addEventListener("mouseup", stopSecondaryButton, { capture: true });
		return () => {
			container.removeEventListener("contextmenu", handleContextMenu, { capture: true });
			container.removeEventListener("mousedown", stopSecondaryButton, { capture: true });
			container.removeEventListener("mouseup", stopSecondaryButton, { capture: true });
		};
	}, [containerRef, events, canManage]);

	const anchor = target
		? {
				getBoundingClientRect: () => DOMRect.fromRect({ x: target.x, y: target.y }),
			}
		: undefined;

	return (
		<ContextMenu
			open={target !== null}
			onOpenChange={(open) => {
				if (!open) setTarget(null);
			}}
		>
			{target ? (
				<ContextMenuContent
					anchor={anchor}
					side="bottom"
					align="start"
					aria-label={t("calendar.contextMenu.label", "Time entry actions")}
				>
					<ContextMenuItem onClick={() => onEdit(target.event)}>
						<IconPencil aria-hidden="true" />
						{t("calendar.contextMenu.edit", "Edit")}
					</ContextMenuItem>
					<ContextMenuItem variant="destructive" onClick={() => onDelete(target.event)}>
						<IconTrash aria-hidden="true" />
						{t("calendar.contextMenu.delete", "Delete")}
					</ContextMenuItem>
				</ContextMenuContent>
			) : null}
		</ContextMenu>
	);
}
