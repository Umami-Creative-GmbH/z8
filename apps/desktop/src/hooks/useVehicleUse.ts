import { useForm, useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import {
	breakVehicleUse,
	type CarriedVehicle,
	clockInVehicleUse,
	clockOutVehicleUse,
	draftVehicleOf,
	prefilledDraft,
	vehicleUseForWarnings,
	withPickedVehicle,
} from "../lib/vehicle-use";
import type { ClockVehicleUse, DesktopContext, WorkVehicleUse } from "../types";

/** A plausibility warning (#1121) as the server words its facts. */
export type VehicleUseWarning =
	| { code: "start_below_last_end"; lastRecordedEndKm: number }
	| { code: "vehicle_on_other_live_work" }
	| { code: "speed_above_limit"; averageKmh: number }
	| { code: "distance_above_limit"; distanceKm: number };

/**
 * What the desktop clock asks for vehicle use (#1124), per the employee's mode
 * from the desktop context: vehicle and start reading at clock-in (pre-filled,
 * #1121), the end reading or distance at clock-out and a manual break, and one
 * optional reading at an idle break. A context from an older server has no
 * vehicle use, so nothing is asked. Nothing here holds a clock event: what
 * cannot be sent is left out.
 */
export function useVehicleUse(context: DesktopContext | undefined) {
	const vehicleUse = context?.vehicleUse;
	const mode = vehicleUse?.mode ?? "off";
	const asks = mode !== "off";
	const live = vehicleUse?.live ?? null;
	// A manual break is a clock-out and a later clock-in on the server, so the
	// desktop carries the vehicle and the break's reading over itself.
	const [carried, setCarried] = useState<CarriedVehicle | null>(null);
	// The pre-fill of the latest context is the form's default, so an untouched
	// form follows it (the form takes changed defaults while untouched).
	const form = useForm({
		defaultValues: { ...prefilledDraft(vehicleUse, carried), breakKm: "" },
	});
	const values = useStore(form.store, (state) => state.values);

	const clockIn = asks ? clockInVehicleUse(values) : ({ ok: true } as const);
	const clockOut = asks
		? clockOutVehicleUse(values, live)
		: ({ ok: true } as const);
	const takenBreak = asks
		? breakVehicleUse(values.breakKm, live)
		: ({ ok: true } as const);

	return {
		mode,
		asks,
		expected: mode === "expected",
		live,
		liveWorkPeriodId: context?.liveWork?.id ?? null,
		vehicles: vehicleUse?.vehicles ?? [],
		form,
		values,
		/** Picks a vehicle and re-fills a start reading the employee did not type. */
		pickVehicle(vehicle: string) {
			const next = withPickedVehicle(
				values,
				vehicle,
				vehicleUse?.lastEndKmByVehicleId ?? {},
			);
			form.setFieldValue("vehicle", next.vehicle);
			form.setFieldValue("startKm", next.startKm);
		},
		/** What a clock-in, clock-out (or manual break) and idle break send. */
		clockIn,
		clockOut,
		takenBreak,
		/** After a manual break starts: the resumed work takes the vehicle over. */
		breakStarted(sent: ClockVehicleUse | undefined) {
			if (!asks || !live) return;
			setCarried({
				vehicle: draftVehicleOf(live.vehicle),
				startKm: sent?.endKm === undefined ? "" : String(sent.endKm),
			});
		},
		/** Forgets what was entered, after the clock event it belonged to. */
		reset(options: { keepCarried?: boolean } = {}) {
			if (!options.keepCarried) setCarried(null);
			form.reset();
		},
	};
}

export type VehicleUseState = ReturnType<typeof useVehicleUse>;

/**
 * Plausibility warnings for vehicle use about to be sent, asked once the
 * employee pauses typing. Warnings are advice and need a connection.
 */
export function useVehicleUseWarnings(
	use: WorkVehicleUse | null,
	closingWorkPeriodId?: string | null,
): VehicleUseWarning[] {
	const request = use
		? JSON.stringify({
				vehicleUse: use,
				...(closingWorkPeriodId ? { closingWorkPeriodId } : {}),
			})
		: null;
	const [settled, setSettled] = useState<string | null>(null);
	useEffect(() => {
		const timer = setTimeout(() => setSettled(request), 400);
		return () => clearTimeout(timer);
	}, [request]);
	const query = useQuery({
		queryKey: ["vehicle-use-warnings", settled],
		queryFn: async () => {
			const answer = await invoke<{ warnings: VehicleUseWarning[] }>(
				"check_vehicle_use_warnings",
				JSON.parse(settled as string),
			);
			return answer.warnings;
		},
		enabled: settled !== null && settled === request,
		staleTime: 60_000,
		retry: false,
	});
	return request !== null && settled === request ? (query.data ?? []) : [];
}

/** The vehicle use a clock event would leave on the work, for its warnings. */
export function warningsSubject(
	result: { ok: true; vehicleUse?: ClockVehicleUse } | { ok: false },
	live: WorkVehicleUse | null,
): WorkVehicleUse | null {
	return result.ok ? vehicleUseForWarnings(result.vehicleUse, live) : null;
}
