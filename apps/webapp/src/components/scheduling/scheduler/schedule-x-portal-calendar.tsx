"use client";

import type { CalendarApp } from "@schedule-x/calendar";
import {
	type ComponentType,
	createElement,
	Fragment,
	type ReactElement,
	useEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";

/**
 * React components Schedule-X renders into its slots, such as `timeGridEvent`. Each slot hands its
 * component its own props.
 */
type ScheduleXCustomComponents = Record<string, ComponentType<any> | undefined>;

interface PortalEntry {
	/** The id Schedule-X gave the slot when it asked for the component. */
	ccid: string;
	wrapperElement: HTMLElement;
	element: ReactElement;
}

interface ScheduleXPortalCalendarProps {
	calendarApp: CalendarApp | null;
	customComponents?: ScheduleXCustomComponents;
}

/**
 * `ScheduleXCalendar` from `@schedule-x/react` (4.1.0, the latest) without its portal leak.
 *
 * Schedule-X gives every mounted event slot a new random id and, when the slot unmounts, calls
 * `_destroyCustomComponentInstance` with it. The upstream adapter never registers that callback,
 * so each event that leaves the view (another week, new events, a drag copy) keeps its React
 * component mounted in a detached element for as long as the calendar lives.
 */
export function ScheduleXPortalCalendar({
	calendarApp,
	customComponents,
}: ScheduleXPortalCalendarProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [portals, setPortals] = useState<PortalEntry[]>([]);

	useEffect(() => {
		const container = containerRef.current;
		if (!calendarApp || !container) return;

		calendarApp._setDestroyCustomComponentInstance((ccid: string) => {
			setPortals((current) => {
				// A date-grid drag copy appends "-copy" to its slot's `data-ccid` on every render, and
				// the destroy call carries the id the slot has by then. Every drag step re-adds the entry
				// under the new id (Schedule-X clones the copy, re-running its effect); should the copy
				// ever re-render without that, only the slot's live dataset would still match.
				const remaining = current.filter(
					(entry) => entry.ccid !== ccid && entry.wrapperElement.dataset.ccid !== ccid,
				);
				return remaining.length === current.length ? current : remaining;
			});
		});
		for (const [slot, Component] of Object.entries(customComponents ?? {})) {
			if (!Component) continue;
			calendarApp._setCustomComponentFn(
				slot,
				(wrapperElement: HTMLElement | null, props: object) => {
					const ccid = wrapperElement?.dataset.ccid;
					if (!wrapperElement || !ccid) return;
					const entry = { ccid, wrapperElement, element: createElement(Component, props) };
					// A slot asked again (its event changed) replaces its component rather than adding one.
					setPortals((current) => [
						...current.filter((existing) => existing.wrapperElement !== wrapperElement),
						entry,
					]);
				},
			);
		}

		calendarApp.render(container);
		return () => {
			calendarApp.destroy();
			setPortals([]);
		};
	}, [calendarApp, customComponents]);

	return (
		<>
			<div className="sx-react-calendar-wrapper" ref={containerRef} />
			{portals.map(({ ccid, wrapperElement, element }) => (
				<Fragment key={ccid}>{createPortal(element, wrapperElement)}</Fragment>
			))}
		</>
	);
}
