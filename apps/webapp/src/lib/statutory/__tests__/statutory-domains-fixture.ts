/**
 * One organization with an open finding in every statutory domain (#1994), for the Reviews inbox,
 * Compliance Command Center and redaction suites. Judged at `STATUTORY_DOMAINS_NOW`
 * (Wednesday 18 November 2026, 11:00 in Berlin):
 *
 * - Minijob: 45 h at 15 EUR/h in November 2026 = 675 EUR, above the 603 EUR limit (exceedance);
 * - short-term: the same earnings under short-term terms (Berufsmäßigkeit prompt);
 * - working student: 27.5 h of weekday daytime work in the lecture week of 9 November (2026-W46);
 * - on-call: a shift on Friday 20 November published on the 18th (1 full day of notice);
 * - youth: a 16-year-old's published Saturday shift on 21 November;
 * - apprentice: an adult apprentice's shift on a vocational-school day (24 November).
 *
 * Raw SQL through the monitors' own fixtures: seeding must not depend on the code under test.
 */
import type { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import type { FixtureEmployee, StatutoryFixture } from "@/test/statutory-fixtures";
import { recordApprenticeRelease } from "../employee-context";
import { minijobFixture } from "../minijob/__tests__/minijob-database-fixture";
import { type OnCallOrganization, onCallFixture } from "../on-call/__tests__/on-call-fixture";
import { shortTermFixture } from "../short-term/__tests__/short-term-fixture";
import { weekdays } from "../working-student/working-student.test.fixture";
import { youthSeed } from "../youth/testing/youth-seed";

export const STATUTORY_DOMAINS_NOW = Temporal.Instant.from("2026-11-18T10:00:00Z");

export interface StatutoryDomainsSeed {
	readonly org: OnCallOrganization;
	readonly owner: FixtureEmployee;
	readonly mini: FixtureEmployee;
	readonly seasonal: FixtureEmployee;
	readonly student: FixtureEmployee;
	readonly caller: FixtureEmployee;
	readonly minor: FixtureEmployee;
	readonly learner: FixtureEmployee;
	readonly onCallShiftId: string;
	readonly saturdayShiftId: string;
	readonly schoolDayShiftId: string;
}

export function statutoryDomainsFixture(admin: Pool, fx: StatutoryFixture) {
	const onCall = onCallFixture(admin, fx);
	const minijob = minijobFixture(admin, fx);
	const youth = youthSeed(admin);
	let owner: FixtureEmployee | null = null;
	const shortTerm = shortTermFixture(admin, async () => {
		if (!owner) throw new Error("seed the organization first");
		return owner;
	});

	async function workWeekdays(
		org: OnCallOrganization,
		who: FixtureEmployee,
		monday: string,
		start: string,
		end: string,
	) {
		for (const spec of weekdays(monday, start, end)) {
			await onCall.work(org, who, { date: spec.date, startTime: spec.start, endTime: spec.end });
		}
	}

	return {
		reset() {
			owner = null;
			minijob.reset();
			shortTerm.reset();
		},

		/** A further shift (published unless `status` says otherwise). */
		shift: onCall.shift,

		/** Further weekday daytime work for an employee, e.g. to change a judged week. */
		workWeekdays,

		/** Recorded work spread over a month (Minijob earnings: minutes × the hourly rate). */
		monthWork: (org: OnCallOrganization, who: FixtureEmployee, month: string, minutes: number) =>
			minijob.monthWork(org, who, month, minutes),

		async seed(key: string): Promise<StatutoryDomainsSeed> {
			const org = await onCall.organization(key);
			owner = await fx.employee(org, `${key}-owner`, { role: "admin" });
			await fx.membership(org, owner, "owner");

			const mini = await fx.employee(org, `${key}-mini`, { contractType: "hourly" });
			await minijob.terms(mini, owner, { from: "2026-01-01", hourlyRate: 15 });
			await minijob.monthWork(org, mini, "2026-11", 2700);

			const seasonal = await fx.employee(org, `${key}-seasonal`, { contractType: "hourly" });
			await shortTerm.terms(seasonal, { from: "2026-11-01", hourlyRate: 15 });
			await minijob.monthWork(org, seasonal, "2026-11", 2700);

			const student = await fx.employee(org, `${key}-student`, { contractType: "hourly" });
			await admin.query(
				`INSERT INTO employee_employment_history (employee_id, organization_id, valid_from,
					valid_from_date, contract_type, hourly_rate, currency, employment_profile, review_state,
					created_by, updated_at)
				 VALUES ($1, $2, '2026-01-01', '2026-01-01', 'hourly', 14.00, 'EUR', 'working_student',
					'confirmed', $3, now())`,
				[student.employeeId, org.id, owner.userId],
			);
			await workWeekdays(org, student, "2026-11-09", "08:00", "13:30");

			const caller = await fx.employee(org, `${key}-caller`, { contractType: "hourly" });
			await onCall.onCallTerms(org, caller, {
				kind: "exact",
				weeklyMinutes: 240,
				from: "2026-01-01",
			});
			const announced = Temporal.Instant.from("2026-11-18T08:00:00Z");
			const onCallShiftId = await onCall.shift(org, {
				employeeId: caller.employeeId,
				date: "2026-11-20",
				startTime: "08:00",
				endTime: "12:00",
				publishedAt: announced,
				assignmentChangedAt: announced,
			});

			const minor = await fx.employee(org, `${key}-minor`, { birthday: "2010-05-01" });
			const saturdayShiftId = await onCall.shift(org, {
				employeeId: minor.employeeId,
				date: "2026-11-21",
				startTime: "10:00",
				endTime: "14:00",
			});

			const learner = await fx.employee(org, `${key}-learner`, { birthday: "2004-01-01" });
			await youth.terms(learner, {
				from: "2026-01-01",
				createdBy: owner.userId,
				employmentProfile: "apprentice",
			});
			await recordApprenticeRelease(db, {
				organizationId: org.id,
				employeeId: learner.employeeId,
				actorUserId: owner.userId,
				releaseKind: "vocational_school_day",
				startsOn: "2026-11-24",
				endsOn: "2026-11-24",
				lessonCount: 6,
			});
			const schoolDayShiftId = await onCall.shift(org, {
				employeeId: learner.employeeId,
				date: "2026-11-24",
				startTime: "08:00",
				endTime: "16:00",
			});

			return {
				org,
				owner,
				mini,
				seasonal,
				student,
				caller,
				minor,
				learner,
				onCallShiftId,
				saturdayShiftId,
				schoolDayShiftId,
			};
		},
	};
}
