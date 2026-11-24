/**
 * JArbSchG youth protection in the clock-out compliance check (#1993). Runs after the closure has
 * committed and never blocks clocking: it records each broken youth rule of the work's local day
 * once in `work_policy_violation` (without a work policy: youth limits apply whatever the policy).
 * Night, Saturday, Sunday and holiday work on a planned shift whose statutory sector exception is
 * acknowledged and current is not recorded; work that overruns the shift makes the exception
 * stale, so its night or weekend work is recorded.
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { workPolicyViolation } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadEmployeeTime } from "@/lib/engagement/engagement-stints";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { attachAcknowledgementStates } from "../acknowledgements";
import type { StatutoryFinding } from "../finding";
import { deepensBreachedLimit } from "../scheduling/evaluate";
import { isMinorOn } from "./age";
import type { JarbschgRule } from "./jarbschg-rules";
import {
	contractorDaysOf,
	loadEmployeeBirthdays,
	loadJarbschgLimits,
	loadYouthShifts,
	loadYouthWork,
} from "./youth-facts";
import { loadHolidayDateKeys } from "../holiday-days";
import { loadYouthSchoolCredits } from "./school-credits";
import { youthFindingsOf } from "./youth-findings";
import { completedYouthInterval, withPlannedShifts } from "./youth-intervals";

export interface JarbschgClockOutInput {
	readonly organizationId: string;
	readonly employeeId: string;
	readonly workPeriodId: string;
	/** Where the closed work started: its local day is judged and its violations dated. */
	readonly workStart: Instant;
	/** The closure's zone, as for the adult compliance check. */
	readonly timezone: string;
}

/** Records the JArbSchG violations of the work's day; returns the rules newly recorded. */
export async function recordJarbschgViolationsAfterClockOut(
	db: DatabaseClient,
	input: JarbschgClockOutInput,
): Promise<JarbschgRule[]> {
	const day = plainDateAt(input.workStart, input.timezone);
	const birthday =
		(
			await loadEmployeeBirthdays(db, {
				organizationId: input.organizationId,
				employeeIds: [input.employeeId],
			})
		).get(input.employeeId) ?? null;
	if (!isMinorOn(birthday, day)) return [];

	const monday = day.subtract({ days: day.dayOfWeek - 1 });
	const range = {
		from: monday.subtract({ days: 1 }).toString(),
		// The next Monday too: a Sunday night shift's work after midnight belongs to its subject.
		until: monday.add({ days: 8 }).toString(),
	};
	const scope = { organizationId: input.organizationId, employeeIds: [input.employeeId] };
	// Contractor work records no `work_policy_violation` (#1996), youth limits included; on a
	// conversion day only its employee part is judged (#2010).
	const employeeTime = await loadEmployeeTime(db, input.organizationId, [input.employeeId]);
	const contractorDays = contractorDaysOf(employeeTime, input.employeeId, {
		timezone: input.timezone,
		...range,
	});
	const startedAsContractor =
		employeeTime.within(input.employeeId, {
			start: input.workStart,
			endExclusive: input.workStart,
		}).length === 0;
	if (startedAsContractor || contractorDays.has(day.toString())) return [];
	const organizationTimezone = await loadOrganizationTimezone(db, input.organizationId);
	const work = await loadYouthWork(db, {
		...scope,
		timezone: input.timezone,
		...range,
		employeeTime,
	});
	const shifts = await loadYouthShifts(db, {
		...scope,
		organizationTimezone,
		...range,
		employeeTime,
	});
	const holidays = await loadHolidayDateKeys(db, { ...scope, ...range });
	const limitsOn = await loadJarbschgLimits(db, range);
	const credits = await loadYouthSchoolCredits(db, { ...scope, ...range });

	const findings = await attachAcknowledgementStates(
		db,
		input.organizationId,
		youthFindingsOf({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			birthday,
			timezone: input.timezone,
			intervals: withPlannedShifts(
				(work.get(input.employeeId) ?? []).flatMap((record) =>
					record.end ? [completedYouthInterval({ ...record, end: record.end })] : [],
				),
				shifts,
			),
			judged: { start: day.toString(), endExclusive: day.add({ days: 1 }).toString() },
			limitsOn,
			holidays: holidays.get(input.employeeId) ?? new Set(),
			credits: credits.get(input.employeeId),
			blockPublish: false,
			// The day's own night minutes: a night shift clocked across midnight records each piece
			// on the local day it starts on, once.
			sectorMinutes: "judged_days",
			contractorDays,
		}),
	);
	// The day's figure of each rule: night and prohibited holiday minutes are found per piece of
	// work and add up; the other rules already judge the day (or week), so the deepest one counts.
	const byRule = new Map<JarbschgRule, RecordedFinding>();
	for (const finding of findings) {
		if (finding.acknowledgement?.status === "current") continue;
		const figure = byRule.get(finding.kind);
		if (!figure) byRule.set(finding.kind, finding);
		else if (summedRules.has(finding.kind)) byRule.set(finding.kind, summed(figure, finding));
		else if (deepensBreachedLimit(figure, finding)) byRule.set(finding.kind, finding);
	}

	// Each rule is recorded once per local day. The other rules only grow with more work: an open
	// violation takes the day's figures when a later clock-out deepens it, and never gives them
	// back. The day's break total (§ 11 Abs. 1) is re-judged at every clock-out, because a clock-out
	// that starts a break is judged before that break exists. An acknowledged violation is kept as
	// it was reviewed.
	const dayRange = localDayRange(day.toString(), input.timezone);
	const existing = await db
		.select({
			id: workPolicyViolation.id,
			violationType: workPolicyViolation.violationType,
			acknowledgedAt: workPolicyViolation.acknowledgedAt,
			details: workPolicyViolation.details,
		})
		.from(workPolicyViolation)
		.where(
			and(
				eq(workPolicyViolation.organizationId, input.organizationId),
				eq(workPolicyViolation.employeeId, input.employeeId),
				inArray(workPolicyViolation.violationType, [
					...new Set<JarbschgRule>([...byRule.keys(), "jarbschg_break"]),
				]),
				gte(workPolicyViolation.violationDate, dateFromInstant(dayRange.start)),
				lt(workPolicyViolation.violationDate, dateFromInstant(dayRange.endExclusive)),
			),
		);
	for (const row of existing) {
		if (row.acknowledgedAt) continue;
		const rule = row.violationType as JarbschgRule;
		const finding = byRule.get(rule);
		// An open break violation follows the day's work; the others only deepen.
		if (finding && (rule === "jarbschg_break" || deepensRecorded(row.details, finding))) {
			await db
				.update(workPolicyViolation)
				.set({ workPeriodId: input.workPeriodId, details: violationDetails(finding) })
				.where(
					and(
						eq(workPolicyViolation.id, row.id),
						eq(workPolicyViolation.organizationId, input.organizationId),
					),
				);
		} else if (!finding && rule === "jarbschg_break") {
			await db
				.delete(workPolicyViolation)
				.where(
					and(
						eq(workPolicyViolation.id, row.id),
						eq(workPolicyViolation.organizationId, input.organizationId),
					),
				);
		}
	}
	for (const row of existing) byRule.delete(row.violationType as JarbschgRule);
	if (byRule.size === 0) return [];

	await db.insert(workPolicyViolation).values(
		[...byRule.values()].map((finding) => ({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			policyId: null,
			policyVersionId: null,
			workPeriodId: input.workPeriodId,
			violationDate: dateFromInstant(input.workStart),
			violationType: finding.kind,
			details: violationDetails(finding),
		})),
	);
	return [...byRule.keys()];
}

type RecordedFinding = Pick<StatutoryFinding<JarbschgRule>, "kind" | "legalReference" | "summary">;

/** Rules breached by each piece of work on its own (minutes in the night or after 14:00). */
const summedRules = new Set<JarbschgRule>(["jarbschg_night_work", "jarbschg_holiday_prohibited"]);

function summed(day: RecordedFinding, more: RecordedFinding): RecordedFinding {
	const { used } = day.summary;
	const added = more.summary.used;
	if (!used || !added || used.unit !== added.unit) return day;
	return {
		...day,
		summary: { ...day.summary, used: { ...used, value: used.value + added.value } },
	};
}

/** Whether `finding` lies further past its limit than the figures recorded in `stored`. */
function deepensRecorded(stored: unknown, finding: RecordedFinding): boolean {
	const recorded = (typeof stored === "string" ? JSON.parse(stored) : (stored ?? {})) as {
		readonly actualMinutes?: number;
		readonly limitMinutes?: number;
		readonly actualDays?: number;
		readonly limitDays?: number;
	};
	const unit = finding.summary.used?.unit;
	const [actual, limit] =
		unit === "days"
			? [recorded.actualDays, recorded.limitDays]
			: [recorded.actualMinutes, recorded.limitMinutes];
	// Figures that cannot be compared are refreshed: they were never the day's.
	if (!unit || actual === undefined || limit === undefined) return true;
	return deepensBreachedLimit(
		{ summary: { used: { unit, value: actual }, limit: { unit, value: limit } } },
		finding,
	);
}

function violationDetails(finding: RecordedFinding) {
	const inDays = finding.summary.used?.unit === "days";
	return {
		legalReference: finding.legalReference,
		...(inDays
			? { actualDays: finding.summary.used?.value, limitDays: finding.summary.limit?.value }
			: {
					actualMinutes: finding.summary.used?.value,
					limitMinutes: finding.summary.limit?.value,
				}),
		warningShownAt: new Date().toISOString(),
		userContinued: true,
	};
}
