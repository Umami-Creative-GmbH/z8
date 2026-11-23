/**
 * Apprentice school and exam release conflicts in Scheduling and Staffing (#1993). A shift on a
 * day released in full (credited school day, block-release week, exam or pre-exam day) is a
 * conflict for every apprentice, and prohibited for one under 18 (§ 9 JArbSchG): with the
 * organization's `blockJarbschgShiftPublish` on, that shift blocks publication. On a school day
 * that is only partly credited, a shift of an apprentice under 18 flags their return to the
 * workplace after school.
 */
import { type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { type StatutoryFinding, statutoryFindingId } from "../finding";
import { statutoryInputFingerprint } from "../fingerprint";
import type {
	StatutoryScheduleContext,
	StatutoryScheduleContributor,
} from "../scheduling/contributor";
import { isMinorOn } from "../youth/age";
import { proposedShiftSubjectKey } from "../youth/jarbschg-contributor";
import type { YouthWorkInterval } from "../youth/jarbschg-rules";
import { loadEmployeeBirthdays, loadYouthShifts, plannedYouthInterval } from "../youth/youth-facts";
import type { ApprenticeReleaseDay } from "./release-credits";
import { loadApprenticeReleaseDays } from "./release-facts";

export type ApprenticeReleaseFindingKind =
	| "bbig_release_day_shift"
	| "jarbschg_school_day_workplace_return";

interface PlannedWork {
	readonly employeeId: string;
	readonly date: PlainDate;
	readonly interval: YouthWorkInterval;
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
	});
	const planned: PlannedWork[] = [
		...shifts,
		...context.proposedShifts
			.filter((proposal) => releaseDays.has(proposal.employeeId))
			.map((proposal) => {
				const date = parsePlainDate(proposal.date);
				return {
					employeeId: proposal.employeeId,
					date,
					interval: plannedYouthInterval(
						proposedShiftSubjectKey(proposal),
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
		const minor = isMinorOn(birthdays.get(work.employeeId) ?? null, work.date);
		const fullDay = release.credit === "full_day";
		if (!fullDay && !minor) continue;
		const kind: ApprenticeReleaseFindingKind = fullDay
			? "bbig_release_day_shift"
			: "jarbschg_school_day_workplace_return";
		const subjectKey = work.interval.ref;
		findings.push({
			id: statutoryFindingId(kind, work.employeeId, subjectKey),
			organizationId: context.organizationId,
			employeeId: work.employeeId,
			domain: "apprenticeship",
			kind,
			severity: fullDay && minor ? "critical" : "warning",
			subjectKey,
			periodStart: work.date.toString(),
			periodEnd: work.date.add({ days: 1 }).toString(),
			legalReference: minor ? "§ 9 Abs. 1 JArbSchG" : "§ 15 Abs. 2 BBiG",
			summary: { tier: fullDay ? "exceeded" : "warning" },
			adminDetail: null,
			inputFingerprint: statutoryInputFingerprint({
				kind,
				employeeId: work.employeeId,
				subjectKey,
				start: work.interval.start,
				end: work.interval.end,
				releaseId: release.releaseId,
				releaseKind: release.releaseKind,
				credit: release.credit,
				minor,
			}),
			acknowledgementKind: null,
			blocksPublication: fullDay && minor && context.preferences.blockJarbschgShiftPublish,
		});
	}
	return findings;
}

export const apprenticeReleaseScheduleContributor: StatutoryScheduleContributor = {
	domain: "apprenticeship",
	evaluate,
};
