"use client";

import { IconInfoCircle } from "@tabler/icons-react";
import { type ReactNode, useEffect, useRef } from "react";

/**
 * Moves focus to what a link arrived for (#1349): scrolls it into view and focuses it without a
 * second scroll jump.
 */
export function focusArrivalTarget(element: HTMLElement): void {
	element.scrollIntoView?.({ block: "center" });
	element.focus({ preventScroll: true });
}

/**
 * The neutral notice shown when a link's target can't be focused on arrival (decided, gone, or not
 * on this page). It takes focus when it appears, so keyboard and screen reader users land on the
 * explanation; render it only for an arrival.
 */
export function ArrivalNotice({ children }: { children: ReactNode }) {
	const noticeRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		noticeRef.current?.focus();
	}, []);

	return (
		<div
			ref={noticeRef}
			role="status"
			tabIndex={-1}
			className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm outline-none focus:ring-2 focus:ring-ring"
		>
			<IconInfoCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
			<span>{children}</span>
		</div>
	);
}
