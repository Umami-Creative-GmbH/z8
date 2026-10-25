export const ingressFailureAlertSelector =
	'[data-widget-id="upcoming-shifts"] [role="alert"]';
/** Serialized into the real document before its first application read. Boolean/numeric data only. */
export function installIngressFailureTimeline() {
	window.__z8IngressFailureTimeline?.stop?.();
	const state = { events: [], overflow: false };
	let previous;
	const observe = () => {
		const widget = document.querySelector('[data-widget-id="upcoming-shifts"]');
		const flags = {
			pending: Boolean(widget?.querySelector('[aria-busy="true"]')),
			alert: Boolean(widget?.querySelector('[role="alert"]')),
			complete: Boolean(widget?.textContent.includes("No upcoming shifts")),
			clockReady: Boolean(
				document.querySelector('header [data-clock-status="ready"]'),
			),
			readyState: document.readyState,
		};
		const signature = JSON.stringify(flags);
		if (signature === previous) return;
		previous = signature;
		if (state.events.length === 128) {
			state.overflow = true;
			return;
		}
		const nowMs = performance.now();
		state.events.push({
			...flags,
			nowMs,
			epochMs: performance.timeOrigin + nowMs,
		});
	};
	const observer = new MutationObserver(observe);
	observer.observe(document, {
		subtree: true,
		childList: true,
		attributes: true,
		attributeFilter: [
			"aria-busy",
			"role",
			"data-widget-id",
			"data-clock-status",
		],
	});
	document.addEventListener("readystatechange", observe);
	state.stop = () => {
		observer.disconnect();
		document.removeEventListener("readystatechange", observe);
	};
	window.__z8IngressFailureTimeline = state;
	observe();
}

/** Also self-contained for CDP page.evaluate; never serializes DOM text or the observer. */
export function readIngressFailureTimeline() {
	const state = window.__z8IngressFailureTimeline;
	return state
		? {
				events: state.events.map((event) => ({ ...event })),
				overflow: state.overflow,
			}
		: null;
}
