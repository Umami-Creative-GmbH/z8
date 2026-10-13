/**
 * Driving details missing (#1127, spec #807; Time Tracking glossary "Driving", ADR 0009): a work
 * period of an employee with vehicle use expected that lacks its vehicle or a reading. The flag is
 * derived, never stored: completing the vehicle use clears it, and switching the organization off
 * clears it for all work at once. It is a warning only and never refuses or delays anything.
 *
 * This file has no I/O and no server-only imports, so the server and the UI share the rules.
 */

import { compareInstants, type Instant } from "@/lib/datetime/temporal-core";
import { decidingVehicleUseAssignment, type VehicleUseAssignmentRule } from "./policy";
import type { WorkVehicleUse } from "./work-vehicle-use";

/**
 * Whether recorded vehicle use lacks its vehicle or a reading. A driven distance is known with
 * both readings, or entered directly while the start reading is missing; either completes it.
 */
export function lacksDrivingDetails(use: WorkVehicleUse | null): boolean {
	return use === null || use.distanceKm === null;
}

/**
 * The organization's vehicle use configuration with the instant each part last changed: when the
 * switch was turned on, and when each assignment was given its current mode.
 */
export type DrivingDetailsConfiguration = {
	enabled: boolean;
	enabledSince: Instant;
	assignments: readonly (VehicleUseAssignmentRule & { since: Instant })[];
};

/**
 * Since when the employee is expected to record vehicle use, or null when they are not (switch
 * off, only asked, excluded or unassigned). The configuration is not effective-dated, so this is
 * when the current expectation began: the later of the switch being turned on and the deciding
 * assignment getting mode `expected`. Work that started earlier is never flagged, so turning the
 * expectation on does not flag years of work recorded before vehicle use existed.
 */
export function drivingDetailsExpectedSince(
	subject: { employeeId: string; teamId: string | null },
	configuration: DrivingDetailsConfiguration,
): Instant | null {
	if (!configuration.enabled) return null;
	const deciding = decidingVehicleUseAssignment(subject, configuration.assignments);
	if (deciding?.mode !== "expected") return null;
	return compareInstants(deciding.since, configuration.enabledSince) >= 0
		? deciding.since
		: configuration.enabledSince;
}

/**
 * Whether a work period shows "driving details missing": completed work, started while its
 * employee was expected to record vehicle use (`expectedSince`, null when not expected), that
 * lacks its vehicle or a reading. Live work is not flagged until it ends.
 */
export function isDrivingDetailsMissing(
	work: { startedAt: Instant; endedAt: Instant | null; vehicleUse: WorkVehicleUse | null },
	expectedSince: Instant | null,
): boolean {
	return (
		expectedSince !== null &&
		work.endedAt !== null &&
		compareInstants(work.startedAt, expectedSince) >= 0 &&
		lacksDrivingDetails(work.vehicleUse)
	);
}
