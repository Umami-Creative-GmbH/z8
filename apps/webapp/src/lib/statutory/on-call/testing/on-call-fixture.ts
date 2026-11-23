/**
 * PostgreSQL seeding for the § 12 TzBfG on-call suites (#1992), on top of `statutoryFixture`.
 * Raw SQL on purpose: seeding must not depend on the code under test. Shifts are stored like
 * `upsertShift` stores them (`shift.date` = organization-local midnight); work and wall times are
 * organization-local.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import type {
	FixtureEmployee,
	FixtureOrganization,
	StatutoryFixture,
} from "@/test/statutory-fixtures";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";

export type OnCallHoursKind = "exact" | "minimum" | "maximum" | "unspecified";

export interface OnCallOrganization extends FixtureOrganization {
	readonly subareaId: string;
	readonly plannerUserId: string;
}

/** An instant from an organization-local wall time. */
export function localInstant(date: string, time: string, timezone: string): Temporal.Instant {
	return Temporal.PlainDateTime.from(`${date}T${time}`)
		.toZonedDateTime(timezone, { disambiguation: "compatible" })
		.toInstant();
}

function asDate(instant: Temporal.Instant): Date {
	return new Date(instant.epochMilliseconds);
}

export function onCallFixture(admin: Pool, fx: StatutoryFixture) {
	return {
		/** An organization with a location, a subarea and a planner who creates shifts. */
		async organization(key: string, timezone = "Europe/Berlin"): Promise<OnCallOrganization> {
			const org = await fx.organization(key, timezone);
			const planner = await fx.user(`${key}-planner`);
			const locationId = randomUUID();
			await admin.query(
				`INSERT INTO location (id, organization_id, name, created_by, updated_at)
				 VALUES ($1, $2, 'Store', $3, now())`,
				[locationId, org.id, planner.userId],
			);
			const subareaId = randomUUID();
			await admin.query(
				`INSERT INTO location_subarea (id, location_id, name, created_by, updated_at)
				 VALUES ($1, $2, 'Floor', $3, now())`,
				[subareaId, locationId, planner.userId],
			);
			return { ...org, subareaId, plannerUserId: planner.userId };
		},

		/** Confirmed on-call terms from `from` (inclusive) until `until` (exclusive, optional). */
		async onCallTerms(
			org: OnCallOrganization,
			who: FixtureEmployee,
			terms: {
				kind: OnCallHoursKind;
				weeklyMinutes?: number | null;
				dailyMinutes?: number | null;
				from?: string;
				until?: string | null;
				employmentPeriodId?: string | null;
			},
		): Promise<void> {
			const from = terms.from ?? "2025-01-01";
			await admin.query(
				`INSERT INTO employee_employment_history (
					employee_id, organization_id, employment_period_id, valid_from, valid_from_date,
					valid_until, valid_until_date, contract_type, hourly_rate, schedule_source,
					on_call_hours_kind, on_call_weekly_minutes, on_call_daily_minutes, review_state,
					created_by, updated_at
				 ) VALUES ($1, $2, $3, $4::date, $4, $5::date, $5, 'hourly', 15.00, 'on_call', $6, $7, $8,
					'confirmed', $9, now())`,
				[
					who.employeeId,
					org.id,
					terms.employmentPeriodId ?? null,
					from,
					terms.until ?? null,
					terms.kind,
					terms.kind === "unspecified" ? null : (terms.weeklyMinutes ?? 1200),
					terms.dailyMinutes ?? null,
					org.plannerUserId,
				],
			);
		},

		/** Regular (non on-call) confirmed terms. */
		async regularTerms(org: OnCallOrganization, who: FixtureEmployee): Promise<void> {
			await admin.query(
				`INSERT INTO employee_employment_history (
					employee_id, organization_id, valid_from, valid_from_date, contract_type,
					weekly_contract_minutes, schedule_source, review_state, created_by, updated_at
				 ) VALUES ($1, $2, '2025-01-01', '2025-01-01', 'fixed', 2400, 'published_shifts',
					'confirmed', $3, now())`,
				[who.employeeId, org.id, org.plannerUserId],
			);
		},

		/** A recorded employment period from `startedAt` (an ISO instant). */
		async employmentPeriod(
			org: OnCallOrganization,
			who: FixtureEmployee,
			startedAt: string,
			endedAt: string | null = null,
		): Promise<string> {
			const {
				rows: [row],
			} = await admin.query<{ id: string }>(
				`INSERT INTO employee_employment_period (
					organization_id, employee_id, status, started_at, start_provenance, ended_at
				 ) VALUES ($1, $2, $3, $4, 'recorded', $5) RETURNING id`,
				[org.id, who.employeeId, endedAt ? "closed" : "open", startedAt, endedAt],
			);
			return row.id;
		},

		/** A shift on the organization-local day `date`. */
		async shift(
			org: OnCallOrganization,
			input: {
				employeeId: string | null;
				date: string;
				startTime: string;
				endTime: string;
				status?: "draft" | "published";
				publishedAt?: Temporal.Instant | null;
				assignmentChangedAt?: Temporal.Instant;
			},
		): Promise<string> {
			const id = randomUUID();
			const changedAt = input.assignmentChangedAt ?? Temporal.Instant.from("2026-01-01T00:00:00Z");
			await admin.query(
				`INSERT INTO shift (
					id, organization_id, employee_id, subarea_id, date, start_time, end_time, status,
					published_at, assignment_changed_at, created_by, created_at, updated_at
				 ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $10)`,
				[
					id,
					org.id,
					input.employeeId,
					org.subareaId,
					shiftDateBounds(input.date, org.timezone).start,
					input.startTime,
					input.endTime,
					input.status ?? "published",
					input.publishedAt ? asDate(input.publishedAt) : null,
					asDate(changedAt),
					org.plannerUserId,
				],
			);
			return id;
		},

		/** Completed work between two organization-local wall times of `date` (end may pass midnight). */
		async work(
			org: OnCallOrganization,
			who: FixtureEmployee,
			input: { date: string; startTime: string; endTime: string },
		): Promise<void> {
			const start = localInstant(input.date, input.startTime, org.timezone);
			let end = localInstant(input.date, input.endTime, org.timezone);
			if (Temporal.Instant.compare(end, start) <= 0) {
				const next = Temporal.PlainDate.from(input.date).add({ days: 1 }).toString();
				end = localInstant(next, input.endTime, org.timezone);
			}
			const offsetMinutes =
				start.toZonedDateTimeISO(org.timezone).offsetNanoseconds / 60_000_000_000;
			const clockInId = randomUUID();
			await admin.query(
				`INSERT INTO time_entry (
					id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
					timezone, timezone_source, hash, created_by, created_at
				 ) VALUES ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
				[
					clockInId,
					who.employeeId,
					org.id,
					asDate(start),
					offsetMinutes,
					org.timezone,
					`t1992-${clockInId}`,
					who.userId,
				],
			);
			await withCanonicalRecords(admin, (client) =>
				client.query(
					`INSERT INTO work_period (
						id, employee_id, organization_id, clock_in_id, start_time, end_time,
						duration_minutes, is_active, updated_at
					 ) VALUES ($1, $2, $3, $4, $5, $6, $7, false, $5)`,
					[
						randomUUID(),
						who.employeeId,
						org.id,
						clockInId,
						asDate(start),
						asDate(end),
						start.until(end).total("minutes"),
					],
				),
			);
		},

		/** A running clock-in (`is_active`, no end yet) from an organization-local wall time. */
		async openWork(
			org: OnCallOrganization,
			who: FixtureEmployee,
			input: { date: string; startTime: string },
		): Promise<void> {
			const start = localInstant(input.date, input.startTime, org.timezone);
			const offsetMinutes =
				start.toZonedDateTimeISO(org.timezone).offsetNanoseconds / 60_000_000_000;
			const clockInId = randomUUID();
			await admin.query(
				`INSERT INTO time_entry (
					id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
					timezone, timezone_source, hash, created_by, created_at
				 ) VALUES ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
				[
					clockInId,
					who.employeeId,
					org.id,
					asDate(start),
					offsetMinutes,
					org.timezone,
					`t1992-${clockInId}`,
					who.userId,
				],
			);
			await admin.query(
				`INSERT INTO work_period (
					id, employee_id, organization_id, clock_in_id, start_time, is_active, updated_at
				 ) VALUES ($1, $2, $3, $4, $5, true, $5)`,
				[randomUUID(), who.employeeId, org.id, clockInId, asDate(start)],
			);
		},

		/** An approved absence of a new category of `type`. */
		async absence(
			org: OnCallOrganization,
			who: FixtureEmployee,
			input: {
				type: "sick" | "vacation" | "unpaid" | "parental" | "home_office";
				startDate: string;
				endDate: string;
				status?: "approved" | "pending";
			},
		): Promise<void> {
			const categoryId = randomUUID();
			await admin.query(
				`INSERT INTO absence_category (id, organization_id, type, name, requires_work_time, updated_at)
				 VALUES ($1, $2, $3, $4, $5, now())`,
				[categoryId, org.id, input.type, input.type, input.type === "home_office"],
			);
			await admin.query(
				`INSERT INTO absence_entry (employee_id, organization_id, category_id, start_date, end_date, status, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, now())`,
				[
					who.employeeId,
					org.id,
					categoryId,
					input.startDate,
					input.endDate,
					input.status ?? "approved",
				],
			);
		},

		/** A public holiday on `date` assigned to the employee. */
		async holiday(org: OnCallOrganization, who: FixtureEmployee, date: string): Promise<void> {
			const categoryId = randomUUID();
			const holidayId = randomUUID();
			await admin.query(
				`INSERT INTO holiday_category (id, organization_id, type, name, updated_at)
				 VALUES ($1, $2, 'public_holiday', 'Public holiday', now())`,
				[categoryId, org.id],
			);
			await admin.query(
				`INSERT INTO holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at)
				 VALUES ($1, $2, $3, 'Holiday', $4, $5, $6, now())`,
				[
					holidayId,
					org.id,
					categoryId,
					`${date}T00:00:00Z`,
					`${date}T23:59:59.999Z`,
					org.plannerUserId,
				],
			);
			await admin.query(
				`INSERT INTO holiday_assignment (holiday_id, organization_id, assignment_type, employee_id, created_by, updated_at)
				 VALUES ($1, $2, 'employee', $3, $4, now())`,
				[holidayId, org.id, who.employeeId, org.plannerUserId],
			);
		},
	};
}
