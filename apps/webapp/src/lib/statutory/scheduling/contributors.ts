import { apprenticeReleaseScheduleContributor } from "../apprenticeship/release-conflict-contributor";
import { minijobScheduleContributor } from "../minijob/minijob-schedule-contributor";
import { onCallScheduleContributor } from "../on-call/contributor";
import { workingStudentScheduleContributor } from "../working-student/contributor";
import { jarbschgScheduleContributor } from "../youth/jarbschg-contributor";
import type { StatutoryScheduleContributor } from "./contributor";

/**
 * Statutory monitors that judge shifts in Scheduling (publish evaluation, compliance banner)
 * and Staffing suggestions. Each Milestone 2 monitor adds one import and one entry below.
 * Keep the entries in ticket order to make parallel merges trivial.
 */
export const statutoryScheduleContributors: readonly StatutoryScheduleContributor[] = [
	// #1989 Minijob
	minijobScheduleContributor,
	// #1990 Short-term employment
	// #1991 Working student
	workingStudentScheduleContributor,
	// #1992 § 12 TzBfG on-call
	onCallScheduleContributor,
	// #1993 JArbSchG / BBiG
	jarbschgScheduleContributor,
	apprenticeReleaseScheduleContributor,
];
