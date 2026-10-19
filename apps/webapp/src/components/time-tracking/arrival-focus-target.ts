/**
 * Moves focus to what a link arrived for (#1349): scrolls it into view and focuses it without a
 * second scroll jump.
 */
export function focusArrivalTarget(element: HTMLElement): void {
	element.scrollIntoView?.({ block: "center" });
	element.focus({ preventScroll: true });
}
