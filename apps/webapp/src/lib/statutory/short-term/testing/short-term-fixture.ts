/**
 * Seeding for the short-term employment PostgreSQL suites (#1990), on top of `statutoryFixture`.
 * Raw SQL on purpose: seeding must not depend on the code under test. Terms and employment
 * agreements go through the production writers instead, so their rows look as in production (a
 * terms row only ends where later terms supersede it; a fixed end lives on the agreement).
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { commitContractChange } from "@/lib/contracts/commit-contract-change";
import {
	createInitialEmploymentAgreement,
	recordFixedTermExtension,
} from "@/lib/contracts/fixed-term-agreements";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import type { FixtureEmployee, FixtureOrganization, FixtureUser } from "@/test/statutory-fixtures";

export function shortTermFixture(admin: Pool, creator: () => Promise<FixtureUser>) {
	const subareas = new Map<string, string>();

	async function subareaOf(org: FixtureOrganization): Promise<string> {
		const known = subareas.get(org.id);
		if (known) return known;
		const { userId } = await creator();
		const locationId = randomUUID();
		const subareaId = randomUUID();
		await admin.query(
			`INSERT INTO location (id, organization_id, name, created_by, updated_at)
			 VALUES ($1, $2, 'Store', $3, now())`,
			[locationId, org.id, userId],
		);
		await admin.query(
			`INSERT INTO location_subarea (id, location_id, name, created_by, updated_at)
			 VALUES ($1, $2, 'Floor', $3, now())`,
			[subareaId, locationId, userId],
		);
		subareas.set(org.id, subareaId);
		return subareaId;
	}

	return {
		/** Forget per-organization state between tests (organizations are recreated). */
		reset() {
			subareas.clear();
		},

		/**
		 * Confirmed employee terms from `from`, committed as a contract change: they run until later
		 * terms of the employment period take over (production terms have no end of their own).
		 * Only a work policy plans real week days: `weeklyMinutes` alone (which the resolver spreads
		 * Monday–Friday) and `scheduleSource: "published_shifts"` leave the week to the shifts and
		 * work actually done.
		 */
		async terms(
			employee: FixtureEmployee,
			options: {
				from: string;
				profile?: "short_term" | "regular" | "minijob";
				hourlyRate?: number | null;
				weeklyMinutes?: number | null;
				/** A work policy from `workPolicy()` whose schedule plans the work days. */
				workPolicyId?: string;
				scheduleSource?: "policy" | "published_shifts";
			},
		): Promise<void> {
			const { userId } = await creator();
			const hourly = options.hourlyRate !== null;
			await commitContractChange(db, {
				organizationId: employee.organizationId,
				employeeId: employee.employeeId,
				actorUserId: userId,
				validFromDate: options.from,
				reviewState: "confirmed",
				contractType: hourly ? "hourly" : "fixed",
				hourlyRate: hourly ? (options.hourlyRate ?? 15) : null,
				currency: "EUR",
				employmentProfile: options.profile ?? "short_term",
				weeklyContractMinutes: options.weeklyMinutes ?? null,
				workPolicyId: options.workPolicyId ?? null,
				scheduleSource: options.scheduleSource ?? null,
			});
		},

		/**
		 * The employment period's agreement: fixed-term from `startsOn` to `endsOn` (both
		 * inclusive), as Settings → Contracts records it.
		 */
		async fixedTermAgreement(
			employee: FixtureEmployee,
			startsOn: string,
			endsOn: string,
		): Promise<void> {
			const { userId } = await creator();
			await createInitialEmploymentAgreement(db, {
				organizationId: employee.organizationId,
				employeeId: employee.employeeId,
				actorUserId: userId,
				kind: "fixed_term",
				startsOn,
				endsOn,
				reason: "Seasonal work",
			});
		},

		/**
		 * The next link of the employment period's agreement chain: fixed-term from `startsOn` to
		 * `endsOn` (both inclusive), as an extension in Settings → Contracts records it.
		 */
		async fixedTermExtension(
			employee: FixtureEmployee,
			startsOn: string,
			endsOn: string,
		): Promise<void> {
			const { userId } = await creator();
			await recordFixedTermExtension(db, {
				organizationId: employee.organizationId,
				employeeId: employee.employeeId,
				actorUserId: userId,
				kind: "fixed_term",
				startsOn,
				endsOn,
				reason: "Seasonal work",
				departureSyncAction: "leave_unchanged",
			});
		},

		/** A work policy planning Monday to Friday every week (the 3-month limit). */
		async weekdayPolicy(org: FixtureOrganization) {
			return this.workPolicy(org, [["monday", "tuesday", "wednesday", "thursday", "friday"]]);
		},

		/**
		 * A work policy with a detailed schedule cycle: `weeks[n]` lists the work days of cycle week
		 * n + 1, 4 hours each. The cycle is anchored on Monday 1970-01-05, so cycle week 1 is every
		 * week whose Monday lies a multiple of `weeks.length` weeks after it.
		 */
		async workPolicy(org: FixtureOrganization, weeks: readonly (readonly string[])[]) {
			const { userId } = await creator();
			const {
				rows: [policy],
			} = await admin.query<{ id: string }>(
				`INSERT INTO work_policy
				 (organization_id, name, schedule_enabled, regulation_enabled, presence_enabled, created_by, updated_at)
				 VALUES ($1, $2, true, false, false, $3, now()) RETURNING id`,
				[org.id, `Rota ${randomUUID().slice(0, 8)}`, userId],
			);
			const {
				rows: [version],
			} = await admin.query<{ id: string }>(
				`INSERT INTO work_policy_version
				 (organization_id, policy_id, version_number, effective_from_date, schedule_enabled,
				  regulation_enabled, presence_enabled, is_legacy_baseline, sealed_at, created_by)
				 VALUES ($1, $2, 1, '1970-01-05', true, false, false, true, NULL, $3) RETURNING id`,
				[org.id, policy.id, userId],
			);
			const {
				rows: [schedule],
			} = await admin.query<{ id: string }>(
				`INSERT INTO work_policy_schedule
				 (policy_id, policy_version_id, schedule_cycle, schedule_type, working_days_preset, updated_at)
				 VALUES ($1, $2, $3, 'detailed', 'custom', now()) RETURNING id`,
				[policy.id, version.id, weeks.length > 1 ? "biweekly" : "weekly"],
			);
			const allDays = [
				"monday",
				"tuesday",
				"wednesday",
				"thursday",
				"friday",
				"saturday",
				"sunday",
			];
			for (const [index, workDays] of weeks.entries()) {
				for (const day of allDays) {
					const isWorkDay = workDays.includes(day);
					await admin.query(
						`INSERT INTO work_policy_schedule_day
						 (schedule_id, policy_version_id, day_of_week, hours_per_day, is_work_day, cycle_week)
						 VALUES ($1, $2, $3, $4, $5, $6)`,
						[schedule.id, version.id, day, isWorkDay ? "4.00" : "0.00", isWorkDay, index + 1],
					);
				}
			}
			return policy.id;
		},

		/**
		 * Assigns a work policy from `workPolicy()` to the whole organization (inherited by every
		 * employee without their own policy) or, with `employee`, to that employee alone (as a
		 * manager would, so terms without a policy do not release it).
		 */
		async assignPolicy(
			org: FixtureOrganization,
			policyId: string,
			employee?: FixtureEmployee,
		): Promise<void> {
			const { userId } = await creator();
			await admin.query(
				`INSERT INTO work_policy_assignment
				 (policy_id, organization_id, assignment_type, employee_id, priority, source_kind,
				  is_active, created_by, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, true, $7, now())`,
				employee
					? [policyId, org.id, "employee", employee.employeeId, 2, "manager_assignment", userId]
					: [policyId, org.id, "organization", null, 0, "legacy", userId],
			);
		},

		/** An open clock-in (active work period) from an organization-local wall time on `date`. */
		async openWork(
			org: FixtureOrganization,
			employee: FixtureEmployee,
			date: string,
			startTime: string,
		): Promise<string> {
			const start = Temporal.ZonedDateTime.from(`${date}T${startTime}[${org.timezone}]`);
			const clockInId = randomUUID();
			const workPeriodId = randomUUID();
			await admin.query(
				`INSERT INTO time_entry (
					id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
					timezone, timezone_source, hash, created_by, created_at
				 ) VALUES ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
				[
					clockInId,
					employee.employeeId,
					org.id,
					new Date(start.epochMilliseconds),
					start.offsetNanoseconds / 60_000_000_000,
					org.timezone,
					`t1990-${clockInId}`,
					employee.userId,
				],
			);
			await withCanonicalRecords(admin, (client) =>
				client.query(
					`INSERT INTO work_period (
						id, employee_id, organization_id, clock_in_id, start_time, is_active, updated_at
					 ) VALUES ($1, $2, $3, $4, $5, true, $5)`,
					[workPeriodId, employee.employeeId, org.id, clockInId, new Date(start.epochMilliseconds)],
				),
			);
			return workPeriodId;
		},

		/**
		 * Clocks out an open clock-in (`openWork`) at an organization-local wall time on `date`,
		 * storing the duration rounded to the nearest minute as clock-out does.
		 */
		async clockOut(
			org: FixtureOrganization,
			workPeriodId: string,
			date: string,
			endTime: string,
		): Promise<void> {
			const end = Temporal.ZonedDateTime.from(`${date}T${endTime}[${org.timezone}]`);
			await withCanonicalRecords(admin, (client) =>
				client.query(
					`UPDATE work_period
					 SET end_time = $2::timestamptz,
						 duration_minutes = floor(extract(epoch from ($2::timestamptz - start_time)) / 60 + 0.5),
						 is_active = false,
						 updated_at = $2::timestamptz
					 WHERE id = $1`,
					[workPeriodId, new Date(end.epochMilliseconds)],
				),
			);
		},

		/** A completed work period between two organization-local wall times starting on `date`. */
		async work(
			org: FixtureOrganization,
			employee: FixtureEmployee,
			date: string,
			startTime = "09:00",
			endTime = "13:00",
		): Promise<string> {
			const start = Temporal.ZonedDateTime.from(`${date}T${startTime}[${org.timezone}]`);
			let end = Temporal.ZonedDateTime.from(`${date}T${endTime}[${org.timezone}]`);
			if (Temporal.ZonedDateTime.compare(end, start) <= 0) end = end.add({ days: 1 });
			const clockInId = randomUUID();
			const workPeriodId = randomUUID();
			await admin.query(
				`INSERT INTO time_entry (
					id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
					timezone, timezone_source, hash, created_by, created_at
				 ) VALUES ($1, $2, $3, 'clock_in', $4, $5, $6, 'backfill', $7, $8, $4)`,
				[
					clockInId,
					employee.employeeId,
					org.id,
					new Date(start.epochMilliseconds),
					start.offsetNanoseconds / 60_000_000_000,
					org.timezone,
					`t1990-${clockInId}`,
					employee.userId,
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
						employee.employeeId,
						org.id,
						clockInId,
						new Date(start.epochMilliseconds),
						new Date(end.epochMilliseconds),
						start.until(end).total("minutes"),
					],
				),
			);
			return workPeriodId;
		},

		/** A draft (default) or published shift stored at the organization-local midnight. */
		async shift(
			org: FixtureOrganization,
			employee: FixtureEmployee,
			date: string,
			startTime = "09:00",
			endTime = "13:00",
			status: "draft" | "published" = "draft",
		): Promise<string> {
			const { userId } = await creator();
			const id = randomUUID();
			const midnight = Temporal.PlainDate.from(date).toZonedDateTime({ timeZone: org.timezone });
			await admin.query(
				`INSERT INTO shift
				 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
				[
					id,
					org.id,
					employee.employeeId,
					await subareaOf(org),
					new Date(midnight.epochMilliseconds),
					startTime,
					endTime,
					status,
					userId,
				],
			);
			return id;
		},

		/**
		 * An absence from `startDate` to `endDate` (both inclusive, full days), approved unless
		 * `status` says otherwise, in a new category of `type` (`requiresWorkTime` as home office has).
		 */
		async absence(
			employee: FixtureEmployee,
			startDate: string,
			endDate: string,
			options: {
				type?: "sick" | "vacation" | "home_office";
				status?: "approved" | "pending" | "rejected";
				requiresWorkTime?: boolean;
			} = {},
		): Promise<void> {
			const categoryId = randomUUID();
			await admin.query(
				`INSERT INTO absence_category (id, organization_id, type, name, requires_work_time, updated_at)
				 VALUES ($1, $2, $3, $4, $5, now())`,
				[
					categoryId,
					employee.organizationId,
					options.type ?? "sick",
					`Category ${categoryId.slice(0, 8)}`,
					options.requiresWorkTime ?? false,
				],
			);
			await admin.query(
				`INSERT INTO absence_entry
				 (id, employee_id, category_id, start_date, end_date, status, organization_id, updated_at)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
				[
					randomUUID(),
					employee.employeeId,
					categoryId,
					startDate,
					endDate,
					options.status ?? "approved",
					employee.organizationId,
				],
			);
		},

		/** Prior-employer short-term days or months in `calendarYear`. */
		async priorShortTerm(
			employee: FixtureEmployee,
			kind: "prior_short_term_work_days" | "prior_short_term_months",
			calendarYear: number,
			count: number,
		): Promise<string> {
			const { userId } = await creator();
			const {
				rows: [row],
			} = await admin.query<{ id: string }>(
				`INSERT INTO employee_statutory_offset
				 (organization_id, employee_id, offset_kind, valid_from_date, valid_until_date, count_value, note, created_by)
				 VALUES ($1, $2, $3, $4, $5, $6, 'Prior employer certificate', $7)
				 RETURNING id`,
				[
					employee.organizationId,
					employee.employeeId,
					kind,
					`${calendarYear}-01-01`,
					`${calendarYear + 1}-01-01`,
					count,
					userId,
				],
			);
			return row.id;
		},
	};
}
