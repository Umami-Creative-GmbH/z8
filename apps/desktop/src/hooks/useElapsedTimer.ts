import { useEffect, useState } from "react";
import { Temporal } from "temporal-polyfill";
function elapsed(start: string | null) {
	if (!start) return 0;
	try {
		return Math.max(
			0,
			Math.floor(
				Temporal.Instant.from(start)
					.until(Temporal.Now.instant())
					.total({ unit: "seconds" }),
			),
		);
	} catch {
		return 0;
	}
}
export function useElapsedTimer(startTime: string | null): number {
	const [seconds, setSeconds] = useState(() => elapsed(startTime));
	useEffect(() => {
		const tick = () => setSeconds(elapsed(startTime));
		tick();
		const timer = setInterval(tick, 1000);
		return () => clearInterval(timer);
	}, [startTime]);
	return seconds;
}
