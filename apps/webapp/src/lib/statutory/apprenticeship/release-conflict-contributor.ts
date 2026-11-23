/**
 * Apprentice school and exam release conflicts in Scheduling and Staffing (#1993). A shift on a
 * day released in full (credited school day, block-release week, pre-exam day, or an exam day
 * recorded without its time), or during an exam recorded with its time, is a
 * conflict for every apprentice, and prohibited for one under 18 (§§ 9, 10 JArbSchG): with the
 * organization's `blockJarbschgShiftPublish` on, that shift blocks publication. On the week's full
 * school day (more than five lessons) an apprentice under 18 may not return to the workplace
 * afterwards (§ 9 Abs. 1 Nr. 2 JArbSchG); after a shorter school day they may.
 */
import { Temporal } from "temporal-polyfill";
import type { ApprenticeReleaseKind } from "@/db/schema";
import {
	compareInstants,
	type Instant,
	type PlainDate,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import { type StatutoryFinding, statutoryFindingId } from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import type {
	StatutoryScheduleContext,
	StatutoryScheduleContributor,
} from "../scheduling/contributor";
import { isMinorOn } from "../youth/age";
import { shiftInterval } from "@/lib/scheduling/shift-occasion";
import { proposedShiftSubjectKey } from "../youth/jarbschg-contributor";
import { loadEmployeeBirthdays, loadYouthShifts } from "../youth/youth-facts";
import type { ApprenticeReleaseDay } from "./release-credits";
import { loadApprenticeReleaseDays } from "./release-facts";

export type ApprenticeReleaseFindingKind =
	| "bbig_release_day_shift"
	| "jarbschg_school_day_workplace_return";

interface PlannedWork {
	readonly employeeId: string;
	readonly date: PlainDate;
	readonly ref: string;
	readonly start: Instant;
	readonly end: Instant;
}

/** The JArbSchG provision that releases an under-18 apprentice on each kind of release day. */
const minorReleaseReference: Record<ApprenticeReleaseKind, string> = {
	vocational_school_day: "§ 9 Abs. 1 Nr. 2 JArbSchG",
	vocational_school_block_week: "§ 9 Abs. 1 Nr. 3 JArbSchG",
	exam_day: "§ 10 Abs. 1 Nr. 1 JArbSchG",
	pre_exam_day: "§ 10 Abs. 1 Nr. 2 JArbSchG",
};

/** Whether planned work overlaps an exam credited with its time, resolved in `timezone`. */
function overlapsExam(work: PlannedWork, release: ApprenticeReleaseDay, timezone: string): boolean {
	if (!release.examStartTime || release.minutes === null) return false;
	const start = work.date
		.toZonedDateTime({
			timeZone: timezone,
			plainTime: Temporal.PlainTime.from(release.examStartTime),
		})
		.toInstant();
	const end = start.add({ minutes: release.minutes });
	return compareInstants(work.start, end) < 0 && compareInstants(start, work.end) < 0;
}

async function evaluate(context: StatutoryScheduleContext): Promise<StatutoryFinding[]> {
	const releaseDays = await loadApprenticeReleaseDays(context.db, {
		organizationId: context.organizationId,
		employeeIds: context.employeeIds,
		from: context.window.start,
		until: context.window.endExclusive,
	});
	if (releaseDays.size === 0) return [];

	const employeeIds = [...releaseDays.keys()];
	const releaseOn = new Map<string, ApprenticeReleaseDay>();
	for (const [employeeId, days] of releaseDays) {
		for (const day of days) {
			const key = `${employeeId}:${day.date}`;
			const existing = releaseOn.get(key);
			if (!existing || day.credit === "full_day") releaseOn.set(key, day);
		}
	}

	const birthdays = await loadEmployeeBirthdays(context.db, {
		organizationId: context.organizationId,
		employeeIds,
	});
	const shifts = await loadYouthShifts(context.db, {
		organizationId: context.organizationId,
		organizationTimezone: context.timezone,
		employeeIds,
		from: context.window.start,
		until: context.window.endExclusive,
		excludeShiftId: context.replacesShiftId,
		excludeShiftIds: context.excludedShiftIds,
	});
	const planned: PlannedWork[] = [
		...shifts.map((shift) => ({ ...shift, ref: `shift:${shift.id}` })),
		...context.proposedShifts
			.filter((proposal) => releaseDays.has(proposal.employeeId))
			.map((proposal) => {
				const date = parsePlainDate(proposal.date);
				return {
					employeeId: proposal.employeeId,
					date,
					ref: proposedShiftSubjectKey(proposal),
					...shiftInterval(
						{ date, startTime: proposal.startTime, endTime: proposal.endTime },
						context.timezone,
					),
				};
			}),
	];

	const findings: StatutoryFinding<ApprenticeReleaseFindingKind>[] = [];
	for (const work of planned) {
		const release = releaseOn.get(`${work.employeeId}:${work.date}`);
		if (!release) continue;
		// A partly credited school or exam day leaves the rest of the day to work, for minors too;
		// for them the youth rules count its credited time toward the day's limit
		// (`youth/school-credits.ts`). Only work during the exam itself conflicts.
		if (release.credit !== "full_day" && !overlapsExam(work, release, context.timezone)) continue;
		const minor = isMinorOn(birthdays.get(work.employeeId) ?? null, work.date);
		const kind: ApprenticeReleaseFindingKind =
			minor && release.releaseKind === "vocational_school_day"
				? "jarbschg_school_day_workplace_return"
				: "bbig_release_day_shift";
		const subjectKey = work.ref;
		findings.push({
			id: statutoryFindingId(kind, work.employeeId, subjectKey),
			organizationId: context.organizationId,
			employeeId: work.employeeId,
			domain: "apprenticeship",
			kind,
			severity: minor ? "critical" : "warning",
			subjectKey,
			periodStart: work.date.toString(),
			periodEnd: work.date.add({ days: 1 }).toString(),
			legalReference: minor ? minorReleaseReference[release.releaseKind] : "§ 15 Abs. 2 BBiG",
			summary: { tier: "exceeded" },
			adminDetail: null,
			inputFingerprint: statutoryInputFingerprint({
				kind,
				employeeId: work.employeeId,
				subjectKey,
				start: work.start,
				end: work.end,
				releaseId: release.releaseId,
				releaseKind: release.releaseKind,
				credit: release.credit,
				minor,
			}),
			acknowledgementKind: null,
			blocksPublication: minor && context.preferences.blockJarbschgShiftPublish,
		});
	}
	return findings;
}

export const apprenticeReleaseScheduleContributor: StatutoryScheduleContributor = {
	domain: "apprenticeship",
	evaluate,
};
