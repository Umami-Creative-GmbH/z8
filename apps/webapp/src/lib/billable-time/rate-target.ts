import { isRateLevel } from "./applicable-rate";

/**
 * A billable rate series: one rate level and its target (#898). Client-safe:
 * the rate cards and entry points address series with it.
 */
export type BillableRateTarget =
	| { level: "employee_project"; employeeId: string; projectId: string }
	| { level: "project"; projectId: string }
	| { level: "customer"; customerId: string }
	| { level: "employee"; employeeId: string };

/** A rate period as the settings UI shows it (wire-safe). */
export interface BillableRatePeriodView {
	id: string;
	/** `YYYY-MM-DD`, the first day the rate applies. */
	effectiveFrom: string;
	/** `YYYY-MM-DD`, the first day it no longer applies; null while open. */
	effectiveTo: string | null;
	/** Two-decimal string in the billable currency. */
	hourlyRate: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads an untrusted target (from a server action) into a typed one, or null. */
export function parseBillableRateTarget(input: unknown): BillableRateTarget | null {
	if (typeof input !== "object" || input === null) return null;
	const value = input as Record<string, unknown>;
	const id = (key: string) => {
		const raw = value[key];
		return typeof raw === "string" && UUID_PATTERN.test(raw) ? raw : null;
	};
	if (!isRateLevel(value.level)) return null;
	switch (value.level) {
		case "employee_project": {
			const employeeId = id("employeeId");
			const projectId = id("projectId");
			return employeeId && projectId ? { level: value.level, employeeId, projectId } : null;
		}
		case "project": {
			const projectId = id("projectId");
			return projectId ? { level: value.level, projectId } : null;
		}
		case "customer": {
			const customerId = id("customerId");
			return customerId ? { level: value.level, customerId } : null;
		}
		case "employee": {
			const employeeId = id("employeeId");
			return employeeId ? { level: value.level, employeeId } : null;
		}
	}
}

/** The target's ids, null where the level has none. */
export function billableRateTargetIds(target: BillableRateTarget) {
	return {
		employeeId: "employeeId" in target ? target.employeeId : null,
		projectId: "projectId" in target ? target.projectId : null,
		customerId: "customerId" in target ? target.customerId : null,
	};
}
