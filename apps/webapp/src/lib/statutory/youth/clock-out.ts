/**
 * JArbSchG youth protection in the clock-out compliance check (#1993). Runs after the closure has
 * committed and never blocks clocking: it records each broken youth rule of the work's local day
 * once in `work_policy_violation` (without a work policy: youth limits apply whatever the policy).
 * Night, Saturday, Sunday and holiday work on a planned shift whose statutory sector exception is
 * acknowledged and current is not recorded.
 */
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { workPolicyViolation } from "@/db/schema";
import { localDayRange } from "@/lib/datetime/temporal-boundaries";
import { dateFromInstant, type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { attachAcknowledgementStates } from "../acknowledgements";
import { isMinorOn } from "./age";
import { youthFindingsOf } from "./jarbschg-contributor";
import type { JarbschgRule } from "./jarbschg-rules";
import {
	loadEmployeeBirthdays,
	loadHolidayDateKeys,
	loadJarbschgLimits,
	loadYouthShifts,
	loadYouthWork,
	withPlannedShifts,
} from "./youth-facts";

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
		until: monday.add({ days: 7 }).toString(),
	};
	const scope = { organizationId: input.organizationId, employeeIds: [input.employeeId] };
	const organizationTimezone = await loadOrganizationTimezone(db, input.organizationId);
	const work = await loadYouthWork(db, { ...scope, timezone: input.timezone, ...range });
	const shifts = await loadYouthShifts(db, { ...scope, organizationTimezone, ...range });
	const holidays = await loadHolidayDateKeys(db, { ...scope, ...range });
	const limitsOn = await loadJarbschgLimits(db, range);

	const findings = await attachAcknowledgementStates(
		db,
		input.organizationId,
		youthFindingsOf({
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			birthday,
			timezone: input.timezone,
			intervals: withPlannedShifts(work.get(input.employeeId) ?? [], shifts),
			judged: { start: day.toString(), endExclusive: day.add({ days: 1 }).toString() },
			limitsOn,
			holidays: holidays.get(input.employeeId) ?? new Set(),
			blockPublish: false,
		}),
	);
	const byRule = new Map<JarbschgRule, (typeof findings)[number]>();
	for (const finding of findings) {
		if (finding.acknowledgement?.status === "current") continue;
		if (!byRule.has(finding.kind)) byRule.set(finding.kind, finding);
	}
	if (byRule.size === 0) return [];

	// Recorded violations are never re-evaluated: each rule is recorded once per local day.
	const dayRange = localDayRange(day.toString(), input.timezone);
	const existing = await db
		.select({ violationType: workPolicyViolation.violationType })
		.from(workPolicyViolation)
		.where(
			and(
				eq(workPolicyViolation.organizationId, input.organizationId),
				eq(workPolicyViolation.employeeId, input.employeeId),
				inArray(workPolicyViolation.violationType, [...byRule.keys()]),
				gte(workPolicyViolation.violationDate, dateFromInstant(dayRange.start)),
				lt(workPolicyViolation.violationDate, dateFromInstant(dayRange.endExclusive)),
			),
		);
	for (const row of existing) byRule.delete(row.violationType as JarbschgRule);
	if (byRule.size === 0) return [];

	await db.insert(workPolicyViolation).values(
		[...byRule.values()].map((finding) => {
			const inDays = finding.summary.used?.unit === "days";
			return {
				organizationId: input.organizationId,
				employeeId: input.employeeId,
				policyId: null,
				policyVersionId: null,
				workPeriodId: input.workPeriodId,
				violationDate: dateFromInstant(input.workStart),
				violationType: finding.kind,
				details: {
					legalReference: finding.legalReference,
					...(inDays
						? { actualDays: finding.summary.used?.value, limitDays: finding.summary.limit?.value }
						: {
								actualMinutes: finding.summary.used?.value,
								limitMinutes: finding.summary.limit?.value,
							}),
					warningShownAt: new Date().toISOString(),
					userContinued: true,
				},
			};
		}),
	);
	return [...byRule.keys()];
}
