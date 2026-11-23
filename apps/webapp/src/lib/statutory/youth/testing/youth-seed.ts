/**
 * Raw-SQL seeding for the #1993 PostgreSQL suites: completed work, shifts, confirmed employment
 * terms and regulated work policies. Pair with `statutoryFixture` for organizations and employees.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import type { FixtureEmployee, FixtureOrganization } from "@/test/statutory-fixtures";

export function localInstant(date: string, time: string, timezone: string): Instant {
	return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(timezone).toInstant();
}

export function youthSeed(admin: Pool) {
	return {
		/** Completed work from `date time` for `minutes`, recorded in `org.timezone`. */
		async work(
			org: FixtureOrganization,
			who: FixtureEmployee,
			date: string,
			time: string,
			minutes: number,
		): Promise<{ id: string; start: Instant; end: Instant; durationMinutes: number }> {
			const id = randomUUID();
			const clockInId = randomUUID();
			const clockOutId = randomUUID();
			const start = localInstant(date, time, org.timezone);
			const end = start.add({ minutes });
			await withCanonicalRecords(admin, async (client) => {
				for (const [entryId, type, at] of [
					[clockInId, "clock_in", start],
					[clockOutId, "clock_out", end],
				] as const) {
					await client.query(
						`insert into time_entry
						 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
						  timezone, timezone_source, hash, created_by)
						 values ($1,$2,$3,$4,$5,$6,$7,'user_setting',$8,$9)`,
						[
							entryId,
							who.employeeId,
							org.id,
							type,
							dateFromInstant(at),
							at.toZonedDateTimeISO(org.timezone).offsetNanoseconds / 60_000_000_000,
							org.timezone,
							entryId,
							who.userId,
						],
					);
				}
				await client.query(
					`insert into work_period
					 (id, employee_id, organization_id, clock_in_id, clock_out_id, start_time, end_time,
					  duration_minutes, is_active, updated_at)
					 values ($1,$2,$3,$4,$5,$6,$7,$8,false,now())`,
					[
						id,
						who.employeeId,
						org.id,
						clockInId,
						clockOutId,
						dateFromInstant(start),
						dateFromInstant(end),
						minutes,
					],
				);
			});
			return { id, start, end, durationMinutes: minutes };
		},

		/** An open clock-in from `date time`, recorded in `org.timezone`. */
		async openWork(
			org: FixtureOrganization,
			who: FixtureEmployee,
			date: string,
			time: string,
		): Promise<{ id: string; start: Instant }> {
			const id = randomUUID();
			const clockInId = randomUUID();
			const start = localInstant(date, time, org.timezone);
			await withCanonicalRecords(admin, async (client) => {
				await client.query(
					`insert into time_entry
					 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
					  timezone, timezone_source, hash, created_by)
					 values ($1,$2,$3,'clock_in',$4,$5,$6,'user_setting',$7,$8)`,
					[
						clockInId,
						who.employeeId,
						org.id,
						dateFromInstant(start),
						start.toZonedDateTimeISO(org.timezone).offsetNanoseconds / 60_000_000_000,
						org.timezone,
						clockInId,
						who.userId,
					],
				);
				await client.query(
					`insert into work_period
					 (id, employee_id, organization_id, clock_in_id, start_time, is_active, updated_at)
					 values ($1,$2,$3,$4,$5,true,now())`,
					[id, who.employeeId, org.id, clockInId, dateFromInstant(start)],
				);
			});
			return { id, start };
		},

		/** A one-day public holiday assigned to the whole organization. */
		async publicHoliday(
			org: FixtureOrganization,
			creator: { userId: string },
			date: string,
		): Promise<string> {
			const categoryId = randomUUID();
			const holidayId = randomUUID();
			await admin.query(
				`insert into holiday_category (id, organization_id, type, name, blocks_time_entry, updated_at)
				 values ($1, $2, 'public_holiday', $3, false, now())`,
				[categoryId, org.id, `Public ${holidayId}`],
			);
			await admin.query(
				`insert into holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at)
				 values ($1, $2, $3, 'Holiday', $4, $5, $6, now())`,
				[holidayId, org.id, categoryId, `${date}T00:00:00`, `${date}T23:59:59`, creator.userId],
			);
			await admin.query(
				`insert into holiday_assignment (holiday_id, organization_id, assignment_type, created_by, updated_at)
				 values ($1, $2, 'organization', $3, now())`,
				[holidayId, org.id, creator.userId],
			);
			return holidayId;
		},

		/** A location and subarea for shifts, created by `creator`. */
		async subarea(org: FixtureOrganization, creator: { userId: string }): Promise<string> {
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
			who: FixtureEmployee,
			input: {
				subareaId: string;
				creatorUserId: string;
				date: string;
				startTime: string;
				endTime: string;
				status?: "draft" | "published";
			},
		): Promise<string> {
			const id = randomUUID();
			await admin.query(
				`insert into shift
				 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
				[
					id,
					org.id,
					who.employeeId,
					input.subareaId,
					shiftDateBounds(input.date, org.timezone).start,
					input.startTime,
					input.endTime,
					input.status ?? "draft",
					input.creatorUserId,
				],
			);
			return id;
		},

		/** Confirmed employment terms from `from` on (open-ended). */
		async terms(
			who: FixtureEmployee,
			input: {
				from: string;
				createdBy: string;
				employmentProfile?: "regular" | "apprentice" | "minijob";
				arbzgScope?: "standard" | "executive_exempt";
				weeklyContractMinutes?: number;
				scheduleMode?: "hours_only" | null;
			},
		): Promise<void> {
			await admin.query(
				`insert into employee_employment_history
				 (employee_id, organization_id, valid_from, valid_from_date, contract_type,
				  weekly_contract_minutes, schedule_mode, employment_profile, arbzg_scope,
				  review_state, created_by, updated_at)
				 values ($1, $2, $3, $4, 'fixed', $5, $6, $7, $8, 'confirmed', $9, now())`,
				[
					who.employeeId,
					who.organizationId,
					`${input.from}T00:00:00Z`,
					input.from,
					input.weeklyContractMinutes ?? 2400,
					input.scheduleMode === undefined ? "hours_only" : input.scheduleMode,
					input.employmentProfile ?? "regular",
					input.arbzgScope ?? "standard",
					input.createdBy,
				],
			);
		},

		/** An organization-wide regulated work policy with a daily maximum. */
		async regulatedPolicy(
			org: FixtureOrganization,
			input: { createdBy: string; maxDailyMinutes: number },
		): Promise<string> {
			const id = randomUUID();
			await admin.query(
				`insert into work_policy (id, organization_id, name, schedule_enabled, created_by, updated_at)
				 values ($1, $2, $4, false, $3, now())`,
				[id, org.id, input.createdBy, `Policy ${id}`],
			);
			const {
				rows: [version],
			} = await admin.query<{ id: string }>(
				`insert into work_policy_version
				 (policy_id, organization_id, version_number, effective_from_date, schedule_enabled,
				  regulation_enabled, presence_enabled, is_legacy_baseline, created_by)
				 values ($1, $2, 1, '1970-01-01', false, true, false, true, $3) returning id`,
				[id, org.id, input.createdBy],
			);
			await admin.query(
				`insert into work_policy_regulation (policy_id, policy_version_id, max_daily_minutes, updated_at)
				 values ($1, $2, $3, now())`,
				[id, version.id, input.maxDailyMinutes],
			);
			await admin.query(
				`insert into work_policy_assignment
				 (policy_id, organization_id, assignment_type, priority, created_by, updated_at)
				 values ($1, $2, 'organization', 0, $3, now())`,
				[id, org.id, input.createdBy],
			);
			return id;
		},

		async blockJarbschgPublish(org: FixtureOrganization): Promise<void> {
			await admin.query(
				`insert into organization_statutory_preference (organization_id, block_jarbschg_shift_publish)
				 values ($1, true)
				 on conflict (organization_id) do update set block_jarbschg_shift_publish = true`,
				[org.id],
			);
		},

		async violations(who: FixtureEmployee): Promise<
			{
				violation_type: string;
				policy_id: string | null;
				work_period_id: string | null;
				details: string;
			}[]
		> {
			const { rows } = await admin.query(
				`select violation_type, policy_id, work_period_id, details from work_policy_violation
				 where organization_id = $1 and employee_id = $2 order by violation_type::text`,
				[who.organizationId, who.employeeId],
			);
			return rows;
		},
	};
}
