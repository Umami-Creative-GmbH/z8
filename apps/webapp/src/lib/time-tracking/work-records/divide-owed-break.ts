import "server-only";

/**
 * Dividing completed work by an owed break (ADR 0010, #1220): the break a work
 * policy regulation still owes is inserted into the work period and its
 * canonical work record together, in either admission's entry writer, with
 * the effects of the change. Runs on a sealed work-transaction scope only; it
 * never opens a transaction and never takes guards.
 *
 * Every refusal is decided before the first write, so a refused division
 * writes nothing; nothing owed is `not_required`, also without writes. The
 * halves are written by the same writers as a division at an instant
 * (`divide.ts`), marked auto-adjusted.
 */
import type { WorkPeriodAutoAdjustmentReason } from "@/db/schema";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	instantToCanonicalString,
} from "@/lib/datetime/temporal-core";
import { readApprovedBreakMinutesOfLocalDay, readBreakMinutesTakenBefore } from "../breaks-taken";
import { closedRangeTouchedByWork } from "../closed-months/rules";
import { closedRangesForEmployee } from "../closed-months/store";
import { capturedZone, resolveFallbackTimezoneCapture } from "../timezone-capture";
import { loadWorkOccupants } from "../work-occupancy";
import type { SealedWorkTransactionScope, WorkTransactionClient } from "../work-transaction";
import type { NewEntryProvenance, WorkRecordRefusal } from "./change";
import {
	type AppendedEntryEvidence,
	appendedEvidence,
	assertWrittenAgreement,
	type DividedHalf,
	dividedHalf,
	divisionSource,
	type WorkDivision,
	writeGeneratedHalf,
	writeRetainedHalf,
} from "./divide";
import { applyWrittenWorkEffects, sendBackChangedWork } from "./effects";
import { entryWriterFor } from "./entry-writer";
import type {
	DivideByOwedBreak,
	OwedBreak,
	OwedBreakEntryProvenance,
	OwedBreakNotRequired,
	OwedBreakTakenBefore,
} from "./owed-break";
import { lockedPairRefusal, type OwedBreakPlan, planOwedBreakDivision } from "./plan-owed-break";
import { matchesExpected, pairOf } from "./read";
import { selectWorkRecordRows, type TimeEntryRow, type WorkPeriodRow } from "./rows";

export type OwedBreakDivision = {
	kind: "owed_break_divided";
	owedBreak: OwedBreak;
	/** The source exactly as it was locked. */
	source: WorkDivision["source"];
	retained: DividedHalf;
	generated: DividedHalf;
	appended: {
		admission: "append" | "legacy";
		clockOut: AppendedEntryEvidence;
		clockIn: AppendedEntryEvidence;
	};
	effects: { workBalanceDirtyFromDate: string };
};

export async function divideByOwedBreak(
	scope: SealedWorkTransactionScope,
	change: DivideByOwedBreak,
): Promise<OwedBreakDivision | OwedBreakNotRequired | WorkRecordRefusal> {
	const { organizationId, employeeId } = change;
	scope.assertEmployee(organizationId, employeeId);
	const tx = scope.db;
	const workPeriodId = change.expected.workPeriodId;
	const locked = await selectWorkRecordRows(
		tx,
		{ organizationId, employeeId, workPeriodId },
		{ lock: true },
	);
	if (!locked) return { kind: "not_found", workPeriodId };
	const { period, clockIn, clockOut, canonical } = locked;
	if (!matchesExpected(change.expected, period)) {
		return { kind: "stale", current: { revision: period.graphRevision } };
	}
	if (period.isActive || !period.endTime || !period.clockOutId) return { kind: "work_running" };
	if (!clockIn || !clockOut) return { kind: "endpoint_entry_missing" };
	if (clockIn.isSuperseded || clockOut.isSuperseded) return { kind: "endpoint_superseded" };

	const writer = entryWriterFor(scope, {
		organizationId,
		employeeId,
		operation: change.appendOperation,
	});
	const pair = pairOf(locked);
	// A pair that disagrees is reported before anything is counted or owed.
	const refused = lockedPairRefusal(pair);
	if (refused) return refused;
	const startAt = instantFromDate(period.startTime);
	const endAt = instantFromDate(period.endTime);
	const plan = planOwedBreakDivision(
		pair,
		{
			regulation: change.regulation,
			alreadyTakenBreakMinutes: await breakMinutesTakenBefore(tx, change.takenBefore, {
				period,
				startAt,
				endAt,
				clockIn,
				entriesZone: change.entries.timezone,
			}),
		},
		writer.durationArithmetic,
	);
	if (plan.kind !== "divide_owed_break") return plan;
	if (!canonical) return { kind: "canonical_record_missing" };

	// Symmetric occupancy: both halves lie inside the source, against every other work.
	const occupants = await loadWorkOccupants(tx, {
		organizationId,
		employeeId,
		interval: { startAt, endAt },
		excludeWorkPeriodIds: [period.id],
	});
	if (occupants.length > 0) return { kind: "work_occupied", occupants };
	// Dividing work that touches a closed month changes it (#762).
	const closed = closedRangeTouchedByWork(
		[{ start: startAt, end: endAt }],
		await closedRangesForEmployee(tx, { organizationId, employeeId }),
	);
	if (closed) return { kind: "month_closed", month: closed.month };
	const admission = await writer.admit();
	if (admission.kind === "review_required") {
		return { kind: "append_review_required", requirement: admission.requirement };
	}

	// Writes: nothing below refuses.
	await sendBackChangedWork(tx, {
		organizationId,
		employeeId,
		causedByUserId: change.actorUserId,
		before: [{ start: startAt, end: endAt }],
		after: [plan.retained, plan.generated].map((half) => ({
			start: half.startAt,
			end: half.endAt,
		})),
	});
	const [breakClockOut, breakClockIn] = await admission.entries.append([
		{
			type: "clock_out",
			at: plan.owedBreak.startAt,
			notes: change.notes,
			provenance: provenanceAt(change.entries, plan.owedBreak.startAt),
		},
		{
			type: "clock_in",
			at: plan.owedBreak.endAt,
			notes: change.notes,
			provenance: provenanceAt(change.entries, plan.owedBreak.endAt),
		},
	]);
	if (!breakClockOut || !breakClockIn) throw new Error("Work records entries were not appended");
	const updatedAt = new Date();
	const autoAdjustment = adjustmentReason(period, plan);
	const retained = await writeRetainedHalf(tx, {
		period,
		canonical,
		half: plan.retained,
		clockOut: breakClockOut,
		updatedAt,
		updatedBy: change.actorUserId,
		autoAdjustment,
	});
	const generated = await writeGeneratedHalf(tx, {
		period,
		canonical,
		half: plan.generated,
		clockIn: breakClockIn,
		updatedAt,
		updatedBy: change.actorUserId,
		autoAdjustment,
	});
	for (const written of [retained, generated]) assertWrittenAgreement(written);

	const effects = await applyWrittenWorkEffects(tx, {
		organizationId,
		employeeId,
		writtenStarts: [
			{ at: startAt, utcOffsetMinutes: clockIn.utcOffsetMinutes ?? 0 },
			{ at: plan.owedBreak.endAt, utcOffsetMinutes: breakClockIn.utcOffsetMinutes ?? 0 },
		],
		dividedOff: [{ sourceWorkPeriodId: period.id, newWorkPeriodId: generated.period.id }],
	});

	return {
		kind: "owed_break_divided",
		owedBreak: plan.owedBreak,
		source: await divisionSource(tx, { period, clockIn, clockOut, canonical }),
		retained: dividedHalf(retained, plan.retained, { clockIn, clockOut: breakClockOut }),
		generated: dividedHalf(generated, plan.generated, { clockIn: breakClockIn, clockOut }),
		appended: {
			admission: writer.admission,
			clockOut: appendedEvidence(breakClockOut),
			clockIn: appendedEvidence(breakClockIn),
		},
		effects,
	};
}

/** Breaks already taken, counted the way the change names. */
async function breakMinutesTakenBefore(
	tx: WorkTransactionClient,
	takenBefore: OwedBreakTakenBefore,
	work: {
		period: WorkPeriodRow;
		startAt: Instant;
		endAt: Instant;
		clockIn: TimeEntryRow;
		entriesZone: string;
	},
): Promise<number> {
	switch (takenBefore) {
		case "earlier_breaks":
			// The work's local start day, in the zone captured with its start: the plan
			// depends on the work's facts, never on a viewer's zone or today's date.
			return readBreakMinutesTakenBefore(tx, {
				organizationId: work.period.organizationId,
				employeeId: work.period.employeeId,
				workPeriodId: work.period.id,
				startAt: work.startAt,
				endAt: work.endAt,
				startZone: capturedZone(work.clockIn),
			});
		case "approved_work_of_local_day":
			// The local day the work ends on, in the zone the break entries are captured in.
			// A plain read: the employee's guard already serializes their writers, and a row
			// lock on other work periods here would break `WORK_RECORD_LOCK_ORDER`.
			return readApprovedBreakMinutesOfLocalDay(tx, {
				organizationId: work.period.organizationId,
				employeeId: work.period.employeeId,
				endAt: work.endAt,
				zone: work.entriesZone,
			});
	}
}

/** Each break entry is captured at its own instant, in the named zone. */
function provenanceAt(entries: OwedBreakEntryProvenance, at: Instant): NewEntryProvenance {
	return {
		createdBy: entries.createdBy,
		ipAddress: entries.ipAddress,
		deviceInfo: entries.deviceInfo,
		capture: resolveFallbackTimezoneCapture({
			timestamp: dateFromInstant(at),
			timezone: entries.timezone,
			timezoneSource: entries.timezoneSource,
		}),
	};
}

/** What both halves record about the adjustment. */
function adjustmentReason(
	period: WorkPeriodRow,
	plan: OwedBreakPlan,
): WorkPeriodAutoAdjustmentReason {
	const { owedBreak } = plan;
	return {
		type: "break_enforcement",
		regulationId: owedBreak.regulation.id,
		regulationName: owedBreak.regulation.name,
		breakInsertedMinutes: owedBreak.breakMinutes,
		breakInsertedAt: instantToCanonicalString(owedBreak.startAt),
		originalDurationMinutes: period.durationMinutes ?? 0,
		adjustedDurationMinutes: plan.retained.durationMinutes + plan.generated.durationMinutes,
		ruleApplied: owedBreak.rule,
	};
}
