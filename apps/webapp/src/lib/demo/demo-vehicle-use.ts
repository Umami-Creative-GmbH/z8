/**
 * Demo vehicle use (#1132, spec #807; Time Tracking glossary "Driving"): plans which vehicle demo
 * employees drove on their generated work and the odometer readings they recorded, so a demo
 * organization shows vehicle use, the distance per vehicle report and some work with driving
 * details missing.
 *
 * Pure and without I/O: the demo service loads the work and writes the plan.
 */

import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import type { WorkVehicleUse } from "@/lib/time-tracking/vehicle-use/work-vehicle-use";

/** One completed demo work period that may get vehicle use. */
export type DemoDrivingPeriod = {
	id: string;
	employeeId: string;
	startedAt: Instant;
	endedAt: Instant;
};

export type DemoVehicleUsePlanEntry = {
	workPeriodId: string;
	employeeId: string;
	use: WorkVehicleUse;
};

/**
 * Plans demo vehicle use. Only employees with a mode are planned: each drives one vehicle per
 * day, carried over the day's breaks, with each organization vehicle's readings chained from its
 * `startKm` in time order. Work periods left out of the plan keep no vehicle use.
 */
export function planDemoVehicleUse(input: {
	periods: readonly DemoDrivingPeriod[];
	modes: ReadonlyMap<string, "asked" | "expected">;
	vehicles: readonly { id: string; startKm: number }[];
	random: () => number;
}): DemoVehicleUsePlanEntry[] {
	const odometer = new Map(input.vehicles.map((vehicle) => [vehicle.id, vehicle.startKm]));
	const plan: DemoVehicleUsePlanEntry[] = [];
	let expectedPlanned = false;
	let drivingDetailsMissing = false;
	for (const day of workDays(input.periods.filter((p) => input.modes.has(p.employeeId)))) {
		const free = input.vehicles.map((vehicle) => vehicle.id);
		for (const sessions of shuffle([...day.values()], input.random)) {
			const expected = input.modes.get(sessions[0].employeeId) === "expected";
			// Someone who is only asked does not always answer: some days stay without vehicle use.
			if (!expected && input.random() < ASKED_DAY_SKIPPED_BELOW) continue;
			const vehicleId = free.shift() ?? null;
			for (const session of sessions) {
				const distanceKm = 5 + Math.floor(input.random() * 56);
				// The vehicle drove even when its readings were not recorded.
				const startKm = vehicleId === null ? null : (odometer.get(vehicleId) ?? 0);
				if (vehicleId !== null && startKm !== null) odometer.set(vehicleId, startKm + distanceKm);
				const missing = expected ? missingDetail(input.random()) : null;
				if (missing === "vehicle" || (missing === "end_reading" && vehicleId === null)) {
					drivingDetailsMissing = true;
					continue;
				}
				expectedPlanned ||= expected;
				let use: WorkVehicleUse;
				if (vehicleId === null || startKm === null) {
					// An own vehicle has no shared odometer here: the employee enters the distance.
					use = { vehicle: { kind: "own" }, startKm: null, endKm: null, distanceKm };
				} else if (missing === "end_reading") {
					drivingDetailsMissing = true;
					use = withoutEndReading({ kind: "organization", vehicleId }, startKm);
				} else {
					const endKm = startKm + distanceKm;
					use = { vehicle: { kind: "organization", vehicleId }, startKm, endKm, distanceKm };
				}
				plan.push({ workPeriodId: session.id, employeeId: session.employeeId, use });
			}
		}
	}
	if (expectedPlanned && !drivingDetailsMissing) leaveLatestExpectedIncomplete(plan, input.modes);
	return plan;
}

/** Below this day draw an employee who is only asked records no vehicle use that day. */
const ASKED_DAY_SKIPPED_BELOW = 0.3;

/** What an expected employee left out of one work period's vehicle use, from one draw. */
function missingDetail(draw: number): "vehicle" | "end_reading" | null {
	if (draw < 0.06) return "vehicle";
	if (draw < 0.12) return "end_reading";
	return null;
}

function withoutEndReading(vehicle: WorkVehicleUse["vehicle"], startKm: number): WorkVehicleUse {
	return { vehicle, startKm, endKm: null, distanceKm: null };
}

/**
 * The demo always shows driving details missing: when no draw left any out, the latest expected
 * work period loses its end reading (or, in an own vehicle, its whole vehicle use).
 */
function leaveLatestExpectedIncomplete(
	plan: DemoVehicleUsePlanEntry[],
	modes: ReadonlyMap<string, "asked" | "expected">,
): void {
	const index = plan.findLastIndex((entry) => modes.get(entry.employeeId) === "expected");
	if (index < 0) return;
	const { use } = plan[index];
	if (use.vehicle.kind === "organization" && use.startKm !== null) {
		plan[index] = { ...plan[index], use: withoutEndReading(use.vehicle, use.startKm) };
	} else {
		plan.splice(index, 1);
	}
}

/** The periods per UTC day (demo work is captured in UTC), oldest day first, then per employee. */
function workDays(periods: readonly DemoDrivingPeriod[]): Map<string, DemoDrivingPeriod[]>[] {
	const days = new Map<string, Map<string, DemoDrivingPeriod[]>>();
	const sorted = [...periods].sort((a, b) => compareInstants(a.startedAt, b.startedAt));
	for (const period of sorted) {
		const day = period.startedAt.toZonedDateTimeISO("UTC").toPlainDate().toString();
		const employees = days.get(day) ?? new Map<string, DemoDrivingPeriod[]>();
		const sessions = employees.get(period.employeeId) ?? [];
		sessions.push(period);
		employees.set(period.employeeId, sessions);
		days.set(day, employees);
	}
	return [...days.values()];
}

function shuffle<T>(items: T[], random: () => number): T[] {
	for (let index = items.length - 1; index > 0; index--) {
		const other = Math.floor(random() * (index + 1));
		[items[index], items[other]] = [items[other], items[index]];
	}
	return items;
}
