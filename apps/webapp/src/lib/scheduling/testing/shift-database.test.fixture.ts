/**
 * Shift seeding for PostgreSQL suites of `shift.date` readers (#942), over the
 * employee lifecycle fixture. Shifts are stored the way `upsertShift` stores
 * them: at the organization-local midnight of their calendar date.
 */
import { randomUUID } from "node:crypto";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

/** The organization-local calendar day every suite schedules around. */
export const SHIFT_DAY = "2026-10-09";

/** `shift.date` of the day before, `SHIFT_DAY` itself and the day after, per organization zone. */
export const STORED_SHIFT_DATES = {
	"Europe/Berlin": {
		previous: "2026-10-07T22:00:00Z",
		day: "2026-10-08T22:00:00Z",
		next: "2026-10-09T22:00:00Z",
	},
	"America/New_York": {
		previous: "2026-10-08T04:00:00Z",
		day: "2026-10-09T04:00:00Z",
		next: "2026-10-10T04:00:00Z",
	},
	UTC: {
		previous: "2026-10-08T00:00:00Z",
		day: "2026-10-09T00:00:00Z",
		next: "2026-10-10T00:00:00Z",
	},
} as const;

export type ShiftTestTimezone = keyof typeof STORED_SHIFT_DATES;

export const SHIFT_TEST_TIMEZONES = Object.keys(STORED_SHIFT_DATES) as ShiftTestTimezone[];

export interface ShiftTestOrganization {
	organizationId: string;
	timezone: ShiftTestTimezone;
	locationId: string;
	subareaId: string;
	creator: SeededEmployee;
}

export interface SeedShiftInput {
	/** Unassigned (open) when null. */
	employeeId: string | null;
	/** `shift.date` as an ISO instant, usually from `STORED_SHIFT_DATES`. */
	stored: string;
	startTime?: string;
	endTime?: string;
	status?: "draft" | "published";
	subareaId?: string;
}

export type ShiftDatabaseFixture = LifecycleDatabaseFixture & {
	/** An organization in `timezone` with one location and subarea. */
	organization(timezone: ShiftTestTimezone): Promise<ShiftTestOrganization>;
	subarea(org: ShiftTestOrganization, name: string): Promise<string>;
	shift(org: ShiftTestOrganization, input: SeedShiftInput): Promise<string>;
	/** Live work of `person` clocked in at `startedAt` (an ISO instant). */
	liveWork(org: ShiftTestOrganization, person: SeededEmployee, startedAt: string): Promise<string>;
};

export async function createShiftDatabaseFixture(): Promise<ShiftDatabaseFixture> {
	const fixture = await createLifecycleDatabaseFixture();

	async function subarea(org: Omit<ShiftTestOrganization, "subareaId">, name: string) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into location_subarea (id, location_id, name, created_by, updated_at)
			 values ($1, $2, $3, $4, now())`,
			[id, org.locationId, name, org.creator.userId],
		);
		return id;
	}

	return {
		...fixture,
		async organization(timezone) {
			const organizationId = await fixture.createOrganization();
			await fixture.pool.query("update organization set timezone = $2 where id = $1", [
				organizationId,
				timezone,
			]);
			const creator = await fixture.seedEmployee({ organizationId, role: "owner" });
			const locationId = randomUUID();
			await fixture.pool.query(
				`insert into location (id, organization_id, name, created_by, updated_at)
				 values ($1, $2, 'Store', $3, now())`,
				[locationId, organizationId, creator.userId],
			);
			const org = { organizationId, timezone, locationId, creator };
			return { ...org, subareaId: await subarea(org, "Floor") };
		},
		subarea,
		async shift(org, input) {
			const id = randomUUID();
			await fixture.pool.query(
				`insert into shift
				 (id, organization_id, employee_id, subarea_id, date, start_time, end_time, status, created_by, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
				[
					id,
					org.organizationId,
					input.employeeId,
					input.subareaId ?? org.subareaId,
					new Date(input.stored),
					input.startTime ?? "08:00",
					input.endTime ?? "16:00",
					input.status ?? "published",
					org.creator.userId,
				],
			);
			return id;
		},
		async liveWork(org, person, startedAt) {
			const clockInId = randomUUID();
			const id = randomUUID();
			await fixture.pool.query(
				`insert into time_entry
				 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone_source, hash, created_by)
				 values ($1, $2, $3, 'clock_in', $4, 0, 'test', md5(random()::text), $5)`,
				[clockInId, person.employeeId, org.organizationId, new Date(startedAt), person.userId],
			);
			await fixture.pool.query(
				`insert into work_period
				 (id, employee_id, organization_id, clock_in_id, start_time, is_active, updated_at)
				 values ($1, $2, $3, $4, $5, true, now())`,
				[id, person.employeeId, org.organizationId, clockInId, new Date(startedAt)],
			);
			return id;
		},
	};
}
