"use client";

import { useEffect, useRef, useState } from "react";
import type { VehicleUseWarning } from "@/lib/time-tracking/vehicle-use/plausibility";

const NO_WARNINGS: VehicleUseWarning[] = [];
const CHECK_DELAY_MS = 400;

/**
 * Plausibility warnings (#1121) for vehicle use as it is being entered, asked
 * from the server shortly after the entry stops changing. `request` is the
 * entry's stable identity (null when there is nothing to check); `check` asks
 * the server for that entry. A failed check shows no warnings: they are advice
 * and never block saving.
 */
export function useVehicleUseWarnings(
	request: string | null,
	check: () => Promise<VehicleUseWarning[]>,
): VehicleUseWarning[] {
	const [result, setResult] = useState<{ request: string; warnings: VehicleUseWarning[] } | null>(
		null,
	);
	const checkRef = useRef(check);
	checkRef.current = check;

	useEffect(() => {
		if (request === null) return;
		let cancelled = false;
		const timer = setTimeout(() => {
			checkRef
				.current()
				.then((warnings) => {
					if (!cancelled) setResult({ request, warnings });
				})
				.catch(() => {
					if (!cancelled) setResult({ request, warnings: NO_WARNINGS });
				});
		}, CHECK_DELAY_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [request]);

	return request !== null && result?.request === request ? result.warnings : NO_WARNINGS;
}
