/**
 * Contract between Scheduling / Staffing and the statutory monitors (#1988 seam). A monitor
 * (#1989–#1993) implements one `StatutoryScheduleContributor` and lists it in `contributors.ts`.
 */
import type { Instant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import type { StatutoryFinding } from "../finding";
import type { StatutoryPreferences } from "../preferences";
import type { StatutoryDomain } from "../threshold-catalog";

/** A shift that does not exist yet: the one Staffing proposes for a candidate. */
export interface StatutoryProposedShift {
	readonly employeeId: string;
	/** Organization-local start day, `YYYY-MM-DD`. */
	readonly date: string;
	/** `HH:mm`; an end at or before the start runs into the next day. */
	readonly startTime: string;
	readonly endTime: string;
}

export interface StatutoryScheduleContext {
	/** Selects, plus relational reads for shared readers (e.g. assigned holidays). */
	readonly db: Pick<DatabaseClient, "select" | "query">;
	readonly organizationId: string;
	/** Organization calendar timezone: compliance weeks, months and years are local to it. */
	readonly timezone: string;
	/** Organization-local days being judged, `[start, endExclusive)`. Report findings touching them. */
	readonly window: { readonly start: string; readonly endExclusive: string };
	/** Employees to judge: assigned employees of the window, or Staffing's candidates. */
	readonly employeeIds: readonly string[];
	/**
	 * Hypothetical shifts on top of persisted data (empty outside Staffing). Contributors load
	 * persisted shifts (draft and published), work periods, wages and offsets themselves, over
	 * whatever lookback they need (months, rolling 12 months…), batched for all `employeeIds`.
	 */
	readonly proposedShifts: readonly StatutoryProposedShift[];
	/**
	 * Staffing's baseline run only: the proposals it will be compared with. Never counted; a
	 * contributor may use them to pick the same subjects in both runs (e.g. which later weeks to
	 * judge), so a finding the proposal leaves unchanged is not reported as added.
	 */
	readonly comparedProposedShifts?: readonly StatutoryProposedShift[];
	/** A persisted shift the proposal replaces (the shift being edited); leave it out. */
	readonly replacesShiftId: string | null;
	readonly preferences: StatutoryPreferences;
	/** Evaluation instant, e.g. the notification time for the § 12 TzBfG notice check. */
	readonly now: Instant;
}

export interface StatutoryScheduleContributor {
	readonly domain: StatutoryDomain;
	/**
	 * Read-only. Returns full findings (with admin detail); the seam redacts them for Scheduling.
	 * Skip employees whose effective contract is outside the monitor's scope.
	 */
	readonly evaluate: (context: StatutoryScheduleContext) => Promise<readonly StatutoryFinding[]>;
}
