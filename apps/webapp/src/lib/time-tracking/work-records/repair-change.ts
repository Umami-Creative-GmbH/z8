/**
 * The attach and repair changes of work records (ADR 0010, #1226): bringing
 * historical completed work whose two records are missing or disagree into
 * record agreement. No I/O and no server-only imports.
 *
 * - attach: completed work without a canonical work record gets one, copying
 *   the work period's interval, minutes, approval state and full work
 *   attribution, vehicle use included (#1224 reuses it for the backfill and
 *   for reopened months).
 * - repair: completed work whose canonical work record disagrees with it, or
 *   misses a value, is written to one resolution in both records. Unlike every
 *   other change, a repair is made for a pair that disagrees; what it writes
 *   must agree.
 *
 * Both run for the admin repair flows: the explicit field repair proposal and
 * the evidence-only gap repair, which keep their own authorization, review and
 * receipts.
 */
import type { Instant } from "@/lib/datetime/temporal-core";
import type { AmendAttributionPatch } from "./amend-change";
import type { WorkRecordExpected } from "./change";

export type AttachWorkRecord = {
	kind: "attach";
	organizationId: string;
	employeeId: string;
	expected: WorkRecordExpected;
	record: {
		/** The canonical work record's id; by default the work period's, as history used it. */
		id?: string;
		origin: "manual" | "clock" | "import" | "system";
		/** The user the record's creation is attributed to: the original actor, never the executor. */
		createdBy: string;
		/** The computation metadata the record carries; null when none is known. */
		computationMetadata: string | null;
	};
	/** The user making the change (the record's updater); null for a job or the system. */
	actorUserId: string | null;
};

/**
 * What the repaired work holds, for each facet the repair resolves. Anything
 * left out is the work period's own value: its interval (its endpoints mirror
 * hashed entries and never move in a repair), minutes, approval state and work
 * attribution. A repair resolves exactly what it names: a facet on which the
 * stored pair disagrees and that the resolution does not name is refused as
 * `canonical_divergence` found in the `locked_pair`, so a repair never
 * overwrites a value nobody reviewed. Approval state cannot be resolved here.
 */
export type WorkRecordResolution = {
	/** The minutes of the repaired work. */
	durationMinutes?: number;
	/** The start of the repaired work: the period's own start. Names the interval. */
	startAt?: Instant;
	/**
	 * The end of the repaired work: the period's own end, or, for work whose
	 * period never recorded one, the instant of its clock-out entry. Names the
	 * interval.
	 */
	endAt?: Instant;
	/** The work attribution, patched as an amendment patches it; names the parts it patches. */
	attribution?: AmendAttributionPatch;
};

export type RepairWorkRecord = {
	kind: "repair";
	organizationId: string;
	employeeId: string;
	expected: WorkRecordExpected;
	resolution: WorkRecordResolution;
	/** The user making the change; null for a job or the system. */
	actorUserId: string | null;
};
