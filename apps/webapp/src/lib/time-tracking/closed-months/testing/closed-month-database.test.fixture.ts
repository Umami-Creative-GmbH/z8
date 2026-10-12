/**
 * Closed-month seeding (#762) over the lifecycle fixture: organizations with a
 * timezone, employees with a primary team and a personal timezone, and the
 * work and absences a close or a writer looks at. Rows are seeded with raw SQL
 * so a suite can also seed inside a range the database refusal protects only
 * before the month is closed.
 */
import { randomUUID } from "node:crypto";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

export type ClosedMonthDatabaseFixture = LifecycleDatabaseFixture & {
	organization(timezone?: string): Promise<{ organizationId: string; ownerUserId: string }>;
	team(organizationId: string, name?: string): Promise<string>;
	employee(input: {
		organizationId: string;
		teamId?: string | null;
		timezone?: string | null;
	}): Promise<{ employeeId: string; userId: string }>;
	setEmployeeTeam(employeeId: string, teamId: string | null): Promise<void>;
	setUserTimezone(userId: string, timezone: string): Promise<void>;
	work(input: {
		organizationId: string;
		employeeId: string;
		userId: string;
		start: string;
		end: string | null;
		approvalStatus?: "approved" | "pending";
	}): Promise<{ workPeriodId: string; clockInId: string; clockOutId: string | null }>;
	absence(input: {
		organizationId: string;
		employeeId: string;
		startDate: string;
		endDate: string;
		status?: "pending" | "approved" | "rejected";
	}): Promise<string>;
	/** Appends a submission cadence change (#805); no rows means the cadence is off. */
	submissionCadence(input: {
		organizationId: string;
		cadence: "off" | "weekly" | "monthly";
		changedAt: string;
		changedBy: string;
	}): Promise<void>;
	/**
	 * A period submission row without a workflow (#805). `start`/`end` are the submitted local
	 * days in `timezone`; a weekly row's whole week is the Monday week containing `start`.
	 */
	periodSubmission(input: {
		organizationId: string;
		employeeId: string;
		submittedBy: string;
		cadence: "weekly" | "monthly";
		startDate: string;
		endDate: string;
		cadenceStartDate?: string;
		cadenceEndDate?: string;
		timezone?: string;
		status?: "pending" | "approved" | "rejected" | "withdrawn" | "outdated";
	}): Promise<string>;
};

export async function createClosedMonthDatabaseFixture(): Promise<ClosedMonthDatabaseFixture> {
	const base = await createLifecycleDatabaseFixture();
	const { pool } = base;
	const categories = new Map<string, string>();

	async function setUserTimezone(userId: string, timezone: string) {
		await pool.query(
			`insert into user_settings (id, user_id, timezone, updated_at) values ($1, $2, $3, now())
			 on conflict (user_id) do update set timezone = excluded.timezone`,
			[randomUUID(), userId, timezone],
		);
	}

	async function timeEntry(input: {
		organizationId: string;
		employeeId: string;
		userId: string;
		type: "clock_in" | "clock_out";
		at: string;
	}) {
		const id = randomUUID();
		await pool.query(
			`insert into time_entry
			 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
			 values ($1, $2, $3, $4, $5::timestamptz at time zone 'UTC', 0, 'UTC', 'backfill', $6, $7)`,
			[
				id,
				input.employeeId,
				input.organizationId,
				input.type,
				input.at,
				`hash-${id}`,
				input.userId,
			],
		);
		return id;
	}

	async function categoryFor(organizationId: string) {
		const known = categories.get(organizationId);
		if (known) return known;
		const id = randomUUID();
		await pool.query(
			`insert into absence_category (id, organization_id, type, name, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', now())`,
			[id, organizationId],
		);
		categories.set(organizationId, id);
		return id;
	}

	return {
		...base,
		async organization(timezone = "Europe/Berlin") {
			const organizationId = await base.createOrganization();
			await pool.query("update organization set timezone = $2 where id = $1", [
				organizationId,
				timezone,
			]);
			const owner = await base.seedEmployee({ organizationId, role: "owner" });
			return { organizationId, ownerUserId: owner.userId };
		},
		async team(organizationId, name = "Team") {
			const id = randomUUID();
			await pool.query(
				`insert into team (id, organization_id, name, updated_at) values ($1, $2, $3, now())`,
				[id, organizationId, `${name} ${id.slice(0, 8)}`],
			);
			return id;
		},
		async employee(input) {
			const seeded = await base.seedEmployee({ organizationId: input.organizationId });
			if (input.timezone) await setUserTimezone(seeded.userId, input.timezone);
			if (input.teamId) {
				await pool.query("update employee set team_id = $2 where id = $1", [
					seeded.employeeId,
					input.teamId,
				]);
			}
			return { employeeId: seeded.employeeId, userId: seeded.userId };
		},
		async setEmployeeTeam(employeeId, teamId) {
			await pool.query("update employee set team_id = $2 where id = $1", [employeeId, teamId]);
		},
		setUserTimezone,
		async work(input) {
			const clockInId = await timeEntry({ ...input, type: "clock_in", at: input.start });
			const clockOutId = input.end
				? await timeEntry({ ...input, type: "clock_out", at: input.end })
				: null;
			const workPeriodId = randomUUID();
			await pool.query(
				`insert into work_period
				 (id, employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
				  duration_minutes, is_active, approval_status, updated_at)
				 values ($1, $2, $3, $4, $5,
				  $6::timestamptz at time zone 'UTC', $7::timestamptz at time zone 'UTC',
				  case when $7::timestamptz is null then null
				   else (extract(epoch from ($7::timestamptz - $6::timestamptz)) / 60)::int end,
				  $7::timestamptz is null, $8, now())`,
				[
					workPeriodId,
					input.employeeId,
					input.organizationId,
					clockInId,
					clockOutId,
					input.start,
					input.end,
					input.approvalStatus ?? "approved",
				],
			);
			return { workPeriodId, clockInId, clockOutId };
		},
		async absence(input) {
			const id = randomUUID();
			await pool.query(
				`insert into absence_entry
				 (id, employee_id, category_id, start_date, end_date, status, organization_id, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, now())`,
				[
					id,
					input.employeeId,
					await categoryFor(input.organizationId),
					input.startDate,
					input.endDate,
					input.status ?? "approved",
					input.organizationId,
				],
			);
			return id;
		},
		async submissionCadence(input) {
			await pool.query(
				`insert into period_submission_cadence_change
				 (id, organization_id, cadence, week_start_day, changed_at, changed_by)
				 values ($1, $2, $3, $4, $5::timestamptz, $6)`,
				[
					randomUUID(),
					input.organizationId,
					input.cadence,
					input.cadence === "weekly" ? "monday" : null,
					input.changedAt,
					input.changedBy,
				],
			);
		},
		async periodSubmission(input) {
			const id = randomUUID();
			const status = input.status ?? "pending";
			const timezone = input.timezone ?? "UTC";
			const decided = status === "approved" || status === "rejected" || status === "outdated";
			const closed = status === "withdrawn" || status === "outdated";
			await pool.query(
				`insert into period_submission
				 (id, organization_id, employee_id, cadence, week_start_day, timezone,
				  start_date, end_date, cadence_start_date, cadence_end_date, range_start, range_end,
				  status, submitted_by, submitted_at, decided_at, decision_reason, closed_at, closed_cause)
				 values ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9::date, $10::date,
				  ($7::date)::timestamp at time zone $6, ($8::date + 1)::timestamp at time zone $6,
				  $11, $12, ($8::date + 1)::timestamp at time zone $6,
				  case when $13 then ($8::date + 2)::timestamp at time zone $6 end,
				  case when $11 = 'rejected' then 'Please fix' end,
				  case when $14 then ($8::date + 3)::timestamp at time zone $6 end,
				  case when $14 then 'change' end)`,
				[
					id,
					input.organizationId,
					input.employeeId,
					input.cadence,
					input.cadence === "weekly" ? "monday" : null,
					timezone,
					input.startDate,
					input.endDate,
					input.cadenceStartDate ?? input.startDate,
					input.cadenceEndDate ?? input.endDate,
					status,
					input.submittedBy,
					decided,
					closed,
				],
			);
			return id;
		},
	};
}
