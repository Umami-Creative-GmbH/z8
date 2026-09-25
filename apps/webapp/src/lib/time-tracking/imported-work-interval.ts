/**
 * Interpretation of one reviewed-import work interval (#252 §4, #284).
 *
 * Fresh imported minutes come from the exact UTC endpoints under the shared
 * half-up rule. Provider-stated durations are source evidence only: when they
 * disagree with the endpoints, or when the provider reports breaks or corrections
 * without placing them, the changed worked interval cannot be derived, so the row
 * is held for review instead of guessed.
 */
import { compareInstants, type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type { AppendReviewReason } from "./time-entry-append";
import { deriveWorkDurationMinutes } from "./work-duration";

/** Provider duration evidence, retained separately from the derived minutes. */
export type ImportedWorkProviderEvidence = {
	/** Provider-stated duration of the entry. */
	durationSeconds: number | null;
	/** Provider-stated break time inside the interval, without its placement. */
	breakSeconds: number | null;
	/** Provider-stated worked time inside the interval. */
	workSeconds: number | null;
	/** Provider time correction applied to the entry, without its placement. */
	correctionSeconds: number | null;
};

export const NO_PROVIDER_EVIDENCE: ImportedWorkProviderEvidence = Object.freeze({
	durationSeconds: null,
	breakSeconds: null,
	workSeconds: null,
	correctionSeconds: null,
});

export type ImportedWorkOccupant = {
	kind: "work_period" | "time_record";
	id: string;
	startAt: string;
	endAt: string | null;
};

/** Why a reviewed import row was held for review instead of committed. */
export type ImportedWorkHold =
	| {
			reason: "invalid_interval";
			detail: "start_not_exact" | "end_not_exact" | "non_positive" | "future_endpoint";
	  }
	| { reason: "unlocated_break"; evidence: ImportedWorkProviderEvidence }
	| {
			reason: "provider_duration_mismatch";
			elapsedSeconds: number;
			evidence: ImportedWorkProviderEvidence;
	  }
	| { reason: "occupancy_conflict"; occupants: ImportedWorkOccupant[] }
	| { reason: "source_collision"; operationId: string }
	| { reason: "operation_collision" }
	| { reason: "append_review_required"; reasons: AppendReviewReason[] };

export type ImportedWorkHoldReason = ImportedWorkHold["reason"];

export type ImportedWorkInterval =
	| { kind: "open"; start: Instant }
	| { kind: "completed"; start: Instant; end: Instant; durationMinutes: number }
	| { kind: "held"; hold: ImportedWorkHold };

const NANOSECONDS_PER_SECOND = BigInt(1_000_000_000);

function exactInstant(value: string): Instant | null {
	try {
		return parseInstant(value);
	} catch {
		return null;
	}
}

function held(hold: ImportedWorkHold): ImportedWorkInterval {
	return { kind: "held", hold };
}

function disagrees(seconds: number | null, elapsedNanoseconds: bigint): boolean {
	if (seconds === null) return false;
	if (!Number.isInteger(seconds)) return true;
	return BigInt(seconds) * NANOSECONDS_PER_SECOND !== elapsedNanoseconds;
}

/**
 * `now` is the authoritative instant sampled once for the operation; endpoints
 * after it are not admitted as imported work.
 */
export function interpretImportedWorkInterval(input: {
	startsAt: string;
	endsAt: string | null;
	evidence: ImportedWorkProviderEvidence;
	now: Instant;
}): ImportedWorkInterval {
	const { evidence } = input;
	const start = exactInstant(input.startsAt);
	if (!start) return held({ reason: "invalid_interval", detail: "start_not_exact" });
	const end = input.endsAt === null ? null : exactInstant(input.endsAt);
	if (input.endsAt !== null && !end) {
		return held({ reason: "invalid_interval", detail: "end_not_exact" });
	}
	if (end && compareInstants(end, start) <= 0) {
		return held({ reason: "invalid_interval", detail: "non_positive" });
	}
	if (compareInstants(end ?? start, input.now) > 0) {
		return held({ reason: "invalid_interval", detail: "future_endpoint" });
	}
	if (evidence.breakSeconds !== null && evidence.breakSeconds !== 0) {
		return held({ reason: "unlocated_break", evidence });
	}
	if (!end) return { kind: "open", start };

	const elapsed = end.epochNanoseconds - start.epochNanoseconds;
	if (
		disagrees(evidence.durationSeconds, elapsed) ||
		disagrees(evidence.workSeconds, elapsed) ||
		(evidence.correctionSeconds !== null && evidence.correctionSeconds !== 0)
	) {
		return held({
			reason: "provider_duration_mismatch",
			elapsedSeconds: Number(elapsed) / 1e9,
			evidence,
		});
	}
	return { kind: "completed", start, end, durationMinutes: deriveWorkDurationMinutes(start, end) };
}
