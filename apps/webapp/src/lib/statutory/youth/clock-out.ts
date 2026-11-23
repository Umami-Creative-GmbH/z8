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
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { attachAcknowledgementStates } from "../acknowledgements";
import { isMinorOn } from "./age";
import type { JarbschgRule } from "./jarbschg-rules";
import {
	loadEmployeeBirthdays,
	loadHolidayDateKeys,
	loadJarbschgLimits,
	loadYouthShifts,
	loadYouthWork,
} from "./youth-facts";
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
	const organizationTimezone = await loadOrganizationTimezone(db, input.organizationId);
	const work = await loadYouthWork(db, { ...scope, timezone: input.timezone, ...range });
	const shifts = await loadYouthShifts(db, { ...scope, organizationTimezone, ...range });
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
		}),
	);
	const byRule = new Map<JarbschgRule, (typeof findings)[number]>();
	for (const finding of findings) {
		if (finding.acknowledgement?.status === "current") continue;
		if (!byRule.has(finding.kind)) byRule.set(finding.kind, finding);
	}

	// Each rule is recorded once per local day. The other rules only grow with more work, so their
	// violations stand; the day's break total (§ 11 Abs. 1) is re-judged at every clock-out, because
	// a clock-out that starts a break is judged before that break exists.
	const dayRange = localDayRange(day.toString(), input.timezone);
	const existing = await db
		.select({
			id: workPolicyViolation.id,
			violationType: workPolicyViolation.violationType,
			acknowledgedAt: workPolicyViolation.acknowledgedAt,
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
	const breakFinding = byRule.get("jarbschg_break");
	// An acknowledged break violation is kept as reviewed; an open one follows the day's work.
	for (const row of existing) {
		if (row.violationType !== "jarbschg_break" || row.acknowledgedAt) continue;
		if (breakFinding) {
			await db
				.update(workPolicyViolation)
				.set({ workPeriodId: input.workPeriodId, details: violationDetails(breakFinding) })
				.where(
					and(
						eq(workPolicyViolation.id, row.id),
						eq(workPolicyViolation.organizationId, input.organizationId),
					),
				);
		} else {
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

function violationDetails(finding: {
	readonly legalReference: string;
	readonly summary: {
		readonly used?: { readonly value: number; readonly unit: string } | null;
		readonly limit?: { readonly value: number } | null;
	};
}) {
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
