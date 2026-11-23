/**
 * Seeding for the working-student PostgreSQL suites (#1991), on top of `statutoryFixture`:
 * confirmed working-student terms, completed work (with canonical records) and shifts, all at
 * organization-local wall times. Raw SQL on purpose: seeding must not depend on the code under test.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { shiftStoredDate } from "@/lib/scheduling/shift-date";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import {
	type FixtureEmployee,
	type FixtureOrganization,
	statutoryFixture,
} from "@/test/statutory-fixtures";

export interface WorkSpec {
	/** Organization-local start day. */
	readonly date: string;
	readonly start: string;
	/** At or before `start` means the next day. */
	readonly end: string;
}

export function workingStudentFixture(admin: Pool, prefix: string) {
	const fx = statutoryFixture(admin, prefix);

	function wallClock(org: FixtureOrganization, spec: WorkSpec) {
		const start = Temporal.PlainDateTime.from(`${spec.date}T${spec.start}`).toZonedDateTime(
			org.timezone,
		);
		let end = Temporal.PlainDateTime.from(`${spec.date}T${spec.end}`).toZonedDateTime(org.timezone);
		if (Temporal.ZonedDateTime.compare(end, start) <= 0) end = end.add({ days: 1 });
		return { start, end };
	}

	return {
		...fx,

		/** An employee with confirmed terms from `from` (default 2024-01-01) and the given profile. */
		async workingStudent(
			org: FixtureOrganization,
			key: string,
			options: {
				from?: string;
				profile?: "working_student" | "regular" | "minijob" | "short_term";
			} = {},
		): Promise<FixtureEmployee> {
			const person = await fx.employee(org, key, { contractType: "hourly" });
			const from = options.from ?? "2024-01-01";
			await admin.query(
				`insert into employee_employment_history
				 (employee_id, organization_id, valid_from, valid_from_date, contract_type, hourly_rate,
				  currency, employment_profile, review_state, created_by, updated_at)
				 values ($1, $2, $3, $4, 'hourly', 14.00, 'EUR', $5, 'confirmed', $6, now())`,
				[
					person.employeeId,
					org.id,
					`${from}T00:00:00Z`,
					from,
					options.profile ?? "working_student",
					person.userId,
				],
			);
			return person;
		},

		/**
		 * Further confirmed terms `[from, until)`; a later row supersedes earlier ones from its
		 * `from`. `createdAt` orders rows that start on the same day.
		 */
		async terms(
			org: FixtureOrganization,
			person: FixtureEmployee,
			options: {
				from: string;
				until?: string | null;
				profile: "working_student" | "regular" | "minijob" | "short_term";
				employmentPeriodId?: string | null;
				createdAt?: string;
			},
		): Promise<void> {
			await admin.query(
				`insert into employee_employment_history
				 (employee_id, organization_id, employment_period_id, valid_from, valid_from_date,
				  valid_until, valid_until_date, contract_type, hourly_rate, currency,
				  employment_profile, review_state, created_by, created_at, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, 'hourly', 14.00, 'EUR', $8, 'confirmed', $9,
				  coalesce($10::timestamptz, now()), now())`,
				[
					person.employeeId,
					org.id,
					options.employmentPeriodId ?? null,
					`${options.from}T00:00:00Z`,
					options.from,
					options.until ? `${options.until}T00:00:00Z` : null,
					options.until ?? null,
					options.profile,
					person.userId,
					options.createdAt ?? null,
				],
			);
		},

		/** An employment period `[startedAt, endedAt)`; open when `endedAt` is null. */
		async employmentPeriod(
			org: FixtureOrganization,
			person: FixtureEmployee,
			startedAt: string,
			endedAt: string | null,
		): Promise<string> {
			const id = randomUUID();
			await admin.query(
				`insert into employee_employment_period
				 (id, organization_id, employee_id, status, started_at, ended_at, start_provenance)
				 values ($1, $2, $3, $4, $5, $6, 'recorded')`,
				[id, org.id, person.employeeId, endedAt ? "closed" : "open", startedAt, endedAt],
			);
			return id;
		},

		/** A running clock-in (active work period without an end) from an organization-local time. */
		async openWork(
			org: FixtureOrganization,
			person: FixtureEmployee,
			spec: { readonly date: string; readonly start: string },
		): Promise<string> {
			const start = Temporal.PlainDateTime.from(`${spec.date}T${spec.start}`).toZonedDateTime(
				org.timezone,
			);
			const clockInId = randomUUID();
			const id = randomUUID();
			await withCanonicalRecords(admin, async (client) => {
				await client.query(
					`insert into time_entry (
						id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
						timezone, timezone_source, hash, created_by, created_at
					 ) values ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
					[
						clockInId,
						person.employeeId,
						org.id,
						new Date(start.epochMilliseconds),
						start.offsetNanoseconds / 60_000_000_000,
						org.timezone,
						`ws-${clockInId}`,
						person.userId,
					],
				);
				await client.query(
					`insert into work_period (
						id, employee_id, organization_id, clock_in_id, start_time, is_active, updated_at
					 ) values ($1, $2, $3, $4, $5, true, $5)`,
					[id, person.employeeId, org.id, clockInId, new Date(start.epochMilliseconds)],
				);
			});
			return id;
		},

		/** Clocks out a running work period at an organization-local time on its start day. */
		async clockOut(
			org: FixtureOrganization,
			workPeriodId: string,
			spec: { readonly date: string; readonly end: string },
		): Promise<void> {
			const end = Temporal.PlainDateTime.from(`${spec.date}T${spec.end}`).toZonedDateTime(
				org.timezone,
			);
			await withCanonicalRecords(admin, async (client) => {
				await client.query(
					`update work_period
					 set end_time = $3::timestamptz,
						 duration_minutes = round(extract(epoch from ($3::timestamptz - start_time)) / 60),
						 is_active = false
					 where id = $1 and organization_id = $2`,
					[workPeriodId, org.id, new Date(end.epochMilliseconds)],
				);
			});
		},

		/** Completed work periods, each with its clock-in entry and canonical record. */
		async work(org: FixtureOrganization, person: FixtureEmployee, specs: readonly WorkSpec[]) {
			const ids: string[] = [];
			await withCanonicalRecords(admin, async (client) => {
				for (const spec of specs) {
					const { start, end } = wallClock(org, spec);
					const clockInId = randomUUID();
					const id = randomUUID();
					await client.query(
						`insert into time_entry (
							id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
							timezone, timezone_source, hash, created_by, created_at
						 ) values ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
						[
							clockInId,
							person.employeeId,
							org.id,
							new Date(start.epochMilliseconds),
							start.offsetNanoseconds / 60_000_000_000,
							org.timezone,
							`ws-${clockInId}`,
							person.userId,
						],
					);
					await client.query(
						`insert into work_period (
							id, employee_id, organization_id, clock_in_id,
							start_time, end_time, duration_minutes, is_active, updated_at
						 ) values ($1, $2, $3, $4, $5, $6, $7, false, $5)`,
						[
							id,
							person.employeeId,
							org.id,
							clockInId,
							new Date(start.epochMilliseconds),
							new Date(end.epochMilliseconds),
							start.until(end).total("minutes"),
						],
					);
					ids.push(id);
				}
			});
			return ids;
		},

		/** A location subarea shifts can be planned in. */
		async subarea(org: FixtureOrganization, creator: FixtureEmployee): Promise<string> {
			const locationId = randomUUID();
			const subareaId = randomUUID();
			await admin.query(
				`insert into location (id, organization_id, name, created_by, updated_at)
				 values ($1, $2, 'Store', $3, now())`,
				[locationId, org.id, creator.userId],
			);
			await admin.query(
				`insert into location_subarea (id, location_id, name, created_by, updated_at)
				 values ($1, $2, 'Floor', $3, now())`,
				[subareaId, locationId, creator.userId],
			);
			return subareaId;
		},

		async shift(
			org: FixtureOrganization,
			subareaId: string,
			person: FixtureEmployee,
			spec: WorkSpec,
			status: "draft" | "published" = "draft",
		): Promise<string> {
			const id = randomUUID();
			await admin.query(
				`insert into shift
				 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
				[
					id,
					org.id,
					person.employeeId,
					subareaId,
					shiftStoredDate(spec.date, org.timezone),
					spec.start,
					spec.end,
					status,
					person.userId,
				],
			);
			return id;
		},
	};
}

/** The same work on each weekday Monday–Friday of the week starting `monday`. */
export function weekdays(monday: string, start: string, end: string): WorkSpec[] {
	return [0, 1, 2, 3, 4].map((offset) => ({
		date: Temporal.PlainDate.from(monday).add({ days: offset }).toString(),
		start,
		end,
	}));
}

/** A permitted >20 h week: 24 hours from Saturday 08:00 of the week starting `monday`. */
export function weekendOver20h(monday: string): WorkSpec {
	return {
		date: Temporal.PlainDate.from(monday).add({ days: 5 }).toString(),
		start: "08:00",
		end: "08:00",
	};
}

export function addWeeks(monday: string, weeks: number): string {
	return Temporal.PlainDate.from(monday).add({ weeks }).toString();
}
