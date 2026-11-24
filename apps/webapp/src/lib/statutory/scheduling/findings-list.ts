/**
 * The statutory findings Scheduling lists behind its counts (#2026): the compliance banner, the
 * publish dialog and the publish-block refusal. Client-safe: types and pure helpers only.
 *
 * Every item is the wage-free Scheduling projection (`toStatutoryComplianceFinding`): an
 * earnings-derived finding carries its tier alone, and no item carries an amount, a wage, an input
 * fingerprint or an acknowledgement reason, for org admins neither. Amounts stay in Reviews &
 * Conflicts.
 */
import type { StatutoryComplianceFinding } from "@/lib/scheduling/compliance/types";

/** The organization-local days a finding judges, `endExclusive` excluded (a day, week, month…). */
export interface StatutoryFindingPeriod {
	readonly start: string;
	readonly endExclusive: string;
}

/** A Scheduling finding with the period it judges, when known. */
export interface DatedStatutoryFinding {
	readonly finding: StatutoryComplianceFinding;
	readonly period: StatutoryFindingPeriod | null;
}

export interface ScheduleStatutoryFindingItem extends DatedStatutoryFinding {
	/** The employee's user name (`buildAuthUserDisplayName`); empty when none is on record. */
	readonly employeeName: string;
}

export interface ScheduleStatutoryFindings {
	/** Findings of employees the viewer may see: blocking first, then by severity, name and date. */
	readonly items: readonly ScheduleStatutoryFindingItem[];
	/** Findings of employees outside a scoped manager's reach: counted, never named. */
	readonly outsideScopeCount: number;
	/** Org admins: each item links to its Reviews & Conflicts domain. */
	readonly canOpenReviews: boolean;
}

export const NO_SCHEDULE_STATUTORY_FINDINGS: ScheduleStatutoryFindings = {
	items: [],
	outsideScopeCount: 0,
	canOpenReviews: false,
};
