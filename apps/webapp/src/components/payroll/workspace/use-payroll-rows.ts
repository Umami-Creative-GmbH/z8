import { useLayoutEffect, useRef, useState } from "react";

/** The payroll tables have fixed-height employee rows and a sticky header. */
export function usePayrollRows(count: number, rowHeight: number, overscan: number) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const [viewport, setViewport] = useState({ first: 0, visible: 0 });
	useLayoutEffect(() => {
		const element = scrollRef.current;
		if (!element) return;
		function measure() {
			if (!element) return;
			const first = Math.floor(element.scrollTop / rowHeight);
			const visible = Math.ceil(element.clientHeight / rowHeight) + 1;
			setViewport((previous) =>
				previous.first === first && previous.visible === visible ? previous : { first, visible },
			);
		}
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		element.addEventListener("scroll", measure, { passive: true });
		return () => {
			observer.disconnect();
			element.removeEventListener("scroll", measure);
		};
	}, [rowHeight]);
	const start = Math.max(0, viewport.first - overscan);
	const end = Math.min(count, viewport.first + viewport.visible + overscan);
	return { scrollRef, start, end };
}
