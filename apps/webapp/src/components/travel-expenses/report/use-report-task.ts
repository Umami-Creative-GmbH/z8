"use client";

import { useLayoutEffect, useRef, useState } from "react";

/** A native activation owns one target until settled, including retained Activity hides. */
export function useReportTask(scope: string) {
	const arrival = useRef<object | null>(null);
	const pending = useRef<{ arrival: object; scope: string } | null>(null);
	const [working, setWorking] = useState(false);
	useLayoutEffect(() => {
		arrival.current = { scope };
		return () => {
			arrival.current = null;
		};
	}, [scope]);

	function reserve() {
		if (!arrival.current || pending.current) return null;
		const task = { arrival: arrival.current, scope };
		pending.current = task;
		setWorking(true);
		return task;
	}

	function isCurrent(task: NonNullable<typeof pending.current>) {
		return arrival.current === task.arrival && task.scope === scope;
	}

	function release(task: NonNullable<typeof pending.current>) {
		if (pending.current !== task) return;
		pending.current = null;
		setWorking(false);
	}

	return {
		working,
		reserve,
		isCurrent,
		release,
		isPending: () => pending.current !== null,
		isActive: () => arrival.current !== null,
	};
}
