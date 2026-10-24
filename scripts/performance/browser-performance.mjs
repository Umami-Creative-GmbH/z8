/** Browser-native observations remain independent of functional journey success. */
export function installFixturePerformanceObservers() {
	window.__z8Baseline = {
		lcp: null,
		inp: null,
		lcpEntries: 0,
		eventEntries: 0,
	};
	for (const type of ["largest-contentful-paint", "event"]) {
		try {
			new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					if (type === "event" && entry.interactionId) {
						window.__z8Baseline.eventEntries++;
						window.__z8Baseline.inp = Math.max(
							window.__z8Baseline.inp ?? 0,
							entry.duration,
						);
					} else if (type === "largest-contentful-paint") {
						window.__z8Baseline.lcpEntries++;
						window.__z8Baseline.lcp = entry.startTime;
					}
				}
			}).observe(
				type === "event"
					? { type, buffered: true, durationThreshold: 16 }
					: { type, buffered: true },
			);
		} catch {
			/* Unsupported observations stay null. */
		}
	}
}

export async function captureObservedBrowserMetrics({
	page,
	sample,
	measurementStarted,
	mode,
}) {
	if (!measurementStarted || !page || page.isClosed()) return;
	const native = await page
		.evaluate(() => window.__z8Baseline)
		.catch(() => null);
	const observed = (value) =>
		typeof value === "number" && Number.isFinite(value) && value >= 0
			? value
			: null;
	// Native document LCP is not a soft-navigation metric; event maximum is not full lifetime INP.
	if (mode === "first-document") sample.lcpMs = observed(native?.lcp);
	sample.interactionMaxMs = observed(native?.inp);
	sample.nativePerformanceObservation = {
		readCompleted: native !== null && native !== undefined,
		lcpEntries: observed(native?.lcpEntries),
		eventEntries: observed(native?.eventEntries),
	};
}
