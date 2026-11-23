/**
 * Raw-SQL seeding for the Minijob monitor suites (#1989): confirmed Minijob terms, completed work,
 * shifts and external offsets. Builds on `statutoryFixture`, which owns cleanup.
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { shiftDateBounds } from "@/lib/scheduling/shift-date";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import type {
	FixtureEmployee,
	FixtureOrganization,
	FixtureUser,
	StatutoryFixture,
} from "@/test/statutory-fixtures";

export function minijobFixture(admin: Pool, fx: StatutoryFixture) {
	const subareas = new Map<string, string>();

	async function subareaOf(org: FixtureOrganization, creator: FixtureUser): Promise<string> {
		const known = subareas.get(org.id);
		if (known) return known;
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await admin.query(
			`INSERT INTO location (id, organization_id, name, created_by, updated_at)
			 VALUES ($1, $2, 'Store', $3, now())`,
			[locationId, org.id, creator.userId],
		);
		await admin.query(
			`INSERT INTO location_subarea (id, location_id, name, created_by, updated_at)
			 VALUES ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, creator.userId],
		);
		subareas.set(org.id, subareaId);
		return subareaId;
	}

	return {
		/** Clears per-run state; call with `fx.cleanup`. */
		reset() {
			subareas.clear();
		},

		/**
		 * Confirmed hourly terms from `from` (inclusive) to `until` (exclusive, null = open-ended).
		 */
		async terms(
			worker: FixtureEmployee,
			creator: FixtureUser,
			options: {
				from: string;
				until?: string | null;
				hourlyRate: number | null;
				profile?: "minijob" | "regular" | "short_term";
			},
		): Promise<void> {
			const until = options.until ?? null;
			await admin.query(
				`INSERT INTO employee_employment_history (
					employee_id, organization_id, valid_from, valid_until, valid_from_date, valid_until_date,
					contract_type, hourly_rate, employment_profile, weekly_contract_minutes, work_model,
					schedule_mode, review_state, created_by, updated_at
				) VALUES ($1, $2, $3::date, $4::date, $3::date, $4::date, 'hourly', $5, $6, 600,
					'onsite', 'hours_only', 'confirmed', $7, now())`,
				[
					worker.employeeId,
					worker.organizationId,
					options.from,
					until,
					options.hourlyRate,
					options.profile ?? "minijob",
					creator.userId,
				],
			);
		},

		/** A completed work period of `minutes` starting at `time` organization-local on `date`. */
		async work(
			org: FixtureOrganization,
			worker: FixtureEmployee,
			date: string,
			minutes: number,
			time = "08:00",
		): Promise<string> {
			const start = Temporal.ZonedDateTime.from(`${date}T${time}[${org.timezone}]`);
			const end = start.add({ minutes });
			const clockInId = randomUUID();
			const workPeriodId = randomUUID();
			await admin.query(
				`INSERT INTO time_entry (
					id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
					timezone, timezone_source, hash, created_by, created_at
				) VALUES ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
				[
					clockInId,
					worker.employeeId,
					org.id,
					new Date(start.epochMilliseconds),
					start.offsetNanoseconds / 60_000_000_000,
					org.timezone,
					`t1989-${clockInId}`,
					worker.userId,
				],
			);
			await withCanonicalRecords(admin, (client) =>
				client.query(
					`INSERT INTO work_period (
						id, employee_id, organization_id, clock_in_id,
						start_time, end_time, duration_minutes, is_active, updated_at
					) VALUES ($1, $2, $3, $4, $5, $6, $7, false, $5)`,
					[
						workPeriodId,
						worker.employeeId,
						org.id,
						clockInId,
						new Date(start.epochMilliseconds),
						new Date(end.epochMilliseconds),
						minutes,
					],
				),
			);
			return workPeriodId;
		},

		/**
		 * `totalMinutes` of completed work in `month` (`YYYY-MM`), split into periods of at most
		 * ten hours on consecutive days from the 2nd.
		 */
		async monthWork(
			org: FixtureOrganization,
			worker: FixtureEmployee,
			month: string,
			totalMinutes: number,
		): Promise<void> {
			let remaining = totalMinutes;
			let day = Temporal.PlainDate.from(`${month}-02`);
			while (remaining > 0) {
				const minutes = Math.min(600, remaining);
				await this.work(org, worker, day.toString(), minutes);
				remaining -= minutes;
				day = day.add({ days: 1 });
			}
		},

		/** A shift on the organization-local `date`; returns its id. */
		async shift(
			org: FixtureOrganization,
			worker: FixtureEmployee,
			creator: FixtureUser,
			options: {
				date: string;
				startTime: string;
				endTime: string;
				status?: "draft" | "published";
			},
		): Promise<string> {
			const id = randomUUID();
			await admin.query(
				`INSERT INTO shift (id, organization_id, employee_id, subarea_id, date, start_time, end_time,
					status, created_by, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
				[
					id,
					org.id,
					worker.employeeId,
					await subareaOf(org, creator),
					shiftDateBounds(options.date, org.timezone).start,
					options.startTime,
					options.endTime,
					options.status ?? "published",
					creator.userId,
				],
			);
			return id;
		},

		/** An active external Minijob offset for whole months `[from, until)`. */
		async externalOffset(
			worker: FixtureEmployee,
			creator: FixtureUser,
			options: { from: string; until: string | null; amountCents: number },
		): Promise<string> {
			const {
				rows: [row],
			} = await admin.query<{ id: string }>(
				`INSERT INTO employee_statutory_offset (organization_id, employee_id, offset_kind,
					valid_from_date, valid_until_date, amount_cents, currency, note, created_by)
				 VALUES ($1, $2, 'external_minijob_monthly_earnings', $3, $4, $5, 'EUR', 'Second Minijob', $6)
				 RETURNING id`,
				[
					worker.organizationId,
					worker.employeeId,
					options.from,
					options.until,
					options.amountCents,
					creator.userId,
				],
			);
			return row.id;
		},

		fx,
	};
}
