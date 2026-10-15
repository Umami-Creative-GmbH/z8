/**
 * #1121 (spec #807): vehicle use pre-fill (the assigned driver's vehicle first,
 * the start reading from the vehicle's last recorded end reading) and the
 * plausibility warnings that need the database, on PostgreSQL. Nothing is mocked.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { withCanonicalRecords } from "@/lib/time-tracking/work-records/__tests__/historical-work";
import { integrationAdminPool } from "@/test/integration-database";
import { loadWorkVehicleUseFormContext } from "./form-context";
import { checkWorkVehicleUsePlausibility } from "./plausibility-check";
import type { WorkVehicleUse } from "./work-vehicle-use";

const ORG = "t1121-org";
const OTHER_ORG = "t1121-other-org";
const ids = {
	driver: "f1121000-0000-4000-8000-000000000001",
	teamDriver: "f1121000-0000-4000-8000-000000000002",
	memberDriver: "f1121000-0000-4000-8000-000000000003",
	colleague: "f1121000-0000-4000-8000-000000000004",
	foreign: "f1121000-0000-4000-8000-000000000005",
	drivers: "f1121000-0000-4000-8000-0000000000a1",
	foreignTeam: "f1121000-0000-4000-8000-0000000000a2",
	van: "f1121000-0000-4000-8000-0000000000b1",
	truck: "f1121000-0000-4000-8000-0000000000b2",
	archived: "f1121000-0000-4000-8000-0000000000b3",
	aCar: "f1121000-0000-4000-8000-0000000000b4",
	foreignCar: "f1121000-0000-4000-8000-0000000000b5",
} as const;
type Person = "driver" | "teamDriver" | "memberDriver" | "colleague" | "foreign";
const people: Person[] = ["driver", "teamDriver", "memberDriver", "colleague", "foreign"];
const userOf = (person: Person) => `t1121-${person}`;
const SEEDED_AT = new Date("2026-06-01T00:00:00Z");

const pool = integrationAdminPool();
const periods: Record<string, string> = {};

async function cleanup() {
	await pool.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await pool.query('delete from "user" where id like $1', ["t1121-%"]);
}

/** Inserts one work period with its clock-in entry; `end` null is live work. */
async function work(
	person: Person,
	start: string,
	end: string | null,
	use: {
		vehicleId: string | null;
		startKm?: number | null;
		endKm?: number | null;
		distanceKm?: number | null;
	},
	options: { deleted?: boolean; organizationId?: string } = {},
) {
	const organizationId = options.organizationId ?? ORG;
	const clockInId = randomUUID();
	const id = randomUUID();
	await pool.query(
		`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
		   timezone, timezone_source, hash, created_by, created_at)
		 values ($1, $2, $3, 'clock_in', $4, 0, 'UTC', 'backfill', $6, $5, $4)`,
		[clockInId, ids[person], organizationId, new Date(start), userOf(person), `hash-${clockInId}`],
	);
	const startKm = use.startKm ?? null;
	const endKm = use.endKm ?? null;
	await withCanonicalRecords(pool, (client) =>
		client.query(
			`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, end_time,
			   duration_minutes, is_active, vehicle_kind, vehicle_id, odometer_start_km, odometer_end_km,
			   driven_distance_km, deleted_at, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $5)`,
			[
				id,
				ids[person],
				organizationId,
				clockInId,
				new Date(start),
				end ? new Date(end) : null,
				end ? Math.round((Date.parse(end) - Date.parse(start)) / 60_000) : null,
				end === null,
				use.vehicleId ? "organization" : "own",
				use.vehicleId,
				startKm,
				endKm,
				startKm !== null && endKm !== null ? endKm - startKm : (use.distanceKm ?? null),
				options.deleted ? new Date(end ?? start) : null,
			],
		),
	);
	return id;
}

async function seed() {
	await cleanup();
	for (const organizationId of [ORG, OTHER_ORG]) {
		await pool.query(
			`insert into organization (id, name, slug, timezone, created_at) values ($1, $1, $1, 'UTC', $2)`,
			[organizationId, SEEDED_AT],
		);
		await pool.query(
			`insert into vehicle_use_setting (organization_id, enabled) values ($1, true)`,
			[organizationId],
		);
	}
	await pool.query(
		`insert into team (id, organization_id, name, updated_at) values
		 ($1, $3, 'Drivers', now()), ($2, $4, 'Foreign', now())`,
		[ids.drivers, ids.foreignTeam, ORG, OTHER_ORG],
	);
	for (const person of people) {
		const organizationId = person === "foreign" ? OTHER_ORG : ORG;
		await pool.query(
			'insert into "user" (id, name, email, created_at, updated_at) values ($1, $1, $2, $3, $3)',
			[userOf(person), `${userOf(person)}@example.test`, SEEDED_AT],
		);
		await pool.query(
			`insert into employee (id, user_id, organization_id, role, team_id, updated_at)
			 values ($1, $2, $3, 'employee', $4, $5)`,
			[
				ids[person],
				userOf(person),
				organizationId,
				person === "teamDriver" ? ids.drivers : person === "foreign" ? ids.foreignTeam : null,
				SEEDED_AT,
			],
		);
	}
	for (const [organizationId, person] of [
		[ORG, "driver"],
		[OTHER_ORG, "foreign"],
	] as const) {
		await pool.query(
			`insert into vehicle_use_assignment (organization_id, assignment_type, priority, mode, created_by)
			 values ($1, 'organization', 0, 'asked', $2)`,
			[organizationId, userOf(person)],
		);
	}
	// The member driver belongs to the team without it being their primary team.
	await pool.query(
		`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3), ($1, $2, $4)`,
		[ORG, ids.drivers, ids.memberDriver, ids.driver],
	);
	await pool.query(
		`insert into organization_vehicle (id, organization_id, name, licence_plate, archived_at) values
		 ($1, $6, 'Van', 'B-VN 100', null),
		 ($2, $6, 'Truck', 'B-TR 200', null),
		 ($3, $6, 'Old car', 'B-OC 1', $8),
		 ($4, $6, 'A car', 'B-AC 2', null),
		 ($5, $7, 'Foreign car', 'M-FC 9', null)`,
		[ids.van, ids.truck, ids.archived, ids.aCar, ids.foreignCar, ORG, OTHER_ORG, SEEDED_AT],
	);
	await pool.query(
		`insert into organization_vehicle_driver (organization_id, vehicle_id, employee_id, team_id) values
		 ($1, $2, $5, null),
		 ($1, $3, null, $6),
		 ($1, $4, $5, null),
		 ($7, $8, $9, null),
		 ($7, $8, null, $10)`,
		[
			ORG,
			ids.van,
			ids.truck,
			ids.archived,
			ids.driver,
			ids.drivers,
			OTHER_ORG,
			ids.foreignCar,
			ids.foreign,
			ids.foreignTeam,
		],
	);

	periods.colleagueVan = await work("colleague", "2026-07-20T08:00:00Z", "2026-07-20T12:00:00Z", {
		vehicleId: ids.van,
		startKm: 11_900,
		endKm: 12_000,
	});
	periods.driverVan = await work("driver", "2026-07-21T08:00:00Z", "2026-07-21T12:00:00Z", {
		vehicleId: ids.van,
		startKm: 12_000,
		endKm: 12_400,
	});
	// A deleted period never counts, even with the highest reading.
	await work(
		"driver",
		"2026-07-22T13:00:00Z",
		"2026-07-22T14:00:00Z",
		{ vehicleId: ids.van, startKm: 99_000, endKm: 99_999 },
		{ deleted: true },
	);
	// Only a start reading: no end reading recorded.
	await work("teamDriver", "2026-07-23T08:00:00Z", "2026-07-23T09:00:00Z", {
		vehicleId: ids.van,
		startKm: 12_500,
	});
	periods.laterVan = await work("colleague", "2026-07-25T08:00:00Z", "2026-07-25T12:00:00Z", {
		vehicleId: ids.van,
		startKm: 12_600,
		endKm: 13_000,
	});
	await work("driver", "2026-07-24T08:00:00Z", "2026-07-24T12:00:00Z", {
		vehicleId: ids.truck,
		startKm: 50_000,
		endKm: 50_250,
	});
	await work(
		"foreign",
		"2026-07-26T08:00:00Z",
		"2026-07-26T12:00:00Z",
		{ vehicleId: ids.foreignCar, startKm: 1_000, endKm: 1_100 },
		{ organizationId: OTHER_ORG },
	);
	// The colleague is clocked in with the truck since 2026-07-27 07:00.
	await work("colleague", "2026-07-27T07:00:00Z", null, { vehicleId: ids.truck, startKm: 50_300 });
	// The driver is clocked in with their own vehicle.
	await work("driver", "2026-07-27T07:30:00Z", null, { vehicleId: null, startKm: 7 });
}

function van(startKm: number | null, endKm: number | null, distanceKm: number | null = null) {
	return {
		vehicle: { kind: "organization", vehicleId: ids.van },
		startKm,
		endKm,
		distanceKm: startKm !== null && endKm !== null ? endKm - startKm : distanceKm,
	} satisfies WorkVehicleUse;
}

function truck(startKm: number | null) {
	return {
		vehicle: { kind: "organization", vehicleId: ids.truck },
		startKm,
		endKm: null,
		distanceKm: null,
	} satisfies WorkVehicleUse;
}

function check(
	person: Person,
	use: WorkVehicleUse,
	start: Instant,
	end: Instant | null,
	options: { excludeWorkPeriodId?: string; organizationId?: string } = {},
) {
	return checkWorkVehicleUsePlausibility(db, {
		organizationId: options.organizationId ?? ORG,
		employeeId: ids[person],
		use,
		start,
		end,
		...(options.excludeWorkPeriodId ? { excludeWorkPeriodId: options.excludeWorkPeriodId } : {}),
	});
}

describe("vehicle use pre-fill and plausibility on PostgreSQL (#1121)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

	beforeAll(async () => {
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	describe("pre-fill", () => {
		async function context(person: Person, options: Record<string, unknown> = {}) {
			return loadWorkVehicleUseFormContext(db, {
				organizationId: person === "foreign" ? OTHER_ORG : ORG,
				employeeId: ids[person],
				...options,
			});
		}

		it("suggests the vehicles assigned to the employee first, then their teams' vehicles", async () => {
			expect((await context("driver")).suggestedVehicleIds).toEqual([ids.van, ids.truck]);
		});

		it("applies a team assignment to its members, by primary team or membership", async () => {
			expect((await context("teamDriver")).suggestedVehicleIds).toEqual([ids.truck]);
			expect((await context("memberDriver")).suggestedVehicleIds).toEqual([ids.truck]);
		});

		it("suggests nothing without an assignment, and never an archived or another organization's vehicle", async () => {
			expect((await context("colleague")).suggestedVehicleIds).toEqual([]);
			expect((await context("driver")).suggestedVehicleIds).not.toContain(ids.archived);
			expect((await context("foreign")).suggestedVehicleIds).toEqual([ids.foreignCar]);
		});

		it("lists the picker's vehicles with the suggested ones first", async () => {
			expect((await context("driver")).vehicles.map((vehicle) => vehicle.id)).toEqual([
				ids.van,
				ids.truck,
				ids.aCar,
			]);
		});

		it("pre-fills each vehicle's last recorded end reading in the same organization", async () => {
			const { lastEndKmByVehicleId } = await context("driver");
			expect(lastEndKmByVehicleId).toEqual({ [ids.van]: 13_000, [ids.truck]: 50_250 });
		});

		it("reads the last end reading before a work's start, without the work itself", async () => {
			expect(
				(await context("driver", { readingsBefore: parseInstant("2026-07-24T00:00:00Z") }))
					.lastEndKmByVehicleId,
			).toEqual({ [ids.van]: 12_400 });
			expect(
				(
					await context("driver", {
						readingsBefore: parseInstant("2026-07-24T00:00:00Z"),
						excludeWorkPeriodId: periods.driverVan,
					})
				).lastEndKmByVehicleId,
			).toEqual({ [ids.van]: 12_000 });
		});

		it("never reads another organization's readings", async () => {
			expect((await context("foreign")).lastEndKmByVehicleId).toEqual({ [ids.foreignCar]: 1_100 });
		});

		it("has nothing to suggest while vehicle use is off", async () => {
			await pool.query(
				"update vehicle_use_setting set enabled = false where organization_id = $1",
				[ORG],
			);
			try {
				const off = await context("driver");
				expect(off.mode).toBe("off");
				expect(off.suggestedVehicleIds).toEqual([]);
				expect(off.lastEndKmByVehicleId).toEqual({});
			} finally {
				await pool.query(
					"update vehicle_use_setting set enabled = true where organization_id = $1",
					[ORG],
				);
			}
		});
	});

	describe("warnings", () => {
		it("warns when the start reading is below the vehicle's last end reading before the work", async () => {
			const start = parseInstant("2026-07-24T08:00:00Z");
			const end = parseInstant("2026-07-24T10:00:00Z");
			expect(await check("driver", van(12_399, 12_450), start, end)).toEqual([
				{ code: "start_below_last_end", lastRecordedEndKm: 12_400 },
			]);
			expect(await check("driver", van(12_400, 12_450), start, end)).toEqual([]);
		});

		it("does not compare an edited work period with its own end reading", async () => {
			expect(
				await check(
					"driver",
					van(11_950, 12_400),
					parseInstant("2026-07-21T08:00:00Z"),
					parseInstant("2026-07-21T12:00:00Z"),
					{ excludeWorkPeriodId: periods.driverVan },
				),
			).toEqual([{ code: "start_below_last_end", lastRecordedEndKm: 12_000 }]);
		});

		it("warns when another employee's live work already records the vehicle", async () => {
			expect(
				await check("driver", truck(50_300), parseInstant("2026-07-27T09:00:00Z"), null),
			).toEqual([{ code: "vehicle_on_other_live_work" }]);
		});

		it("does not warn for the employee's own live work or work that ended before it started", async () => {
			expect(
				await check("colleague", truck(50_300), parseInstant("2026-07-27T09:00:00Z"), null),
			).toEqual([]);
			expect(
				await check(
					"driver",
					{ ...truck(50_250), endKm: 50_290, distanceKm: 40 },
					parseInstant("2026-07-26T08:00:00Z"),
					parseInstant("2026-07-26T10:00:00Z"),
				),
			).toEqual([]);
		});

		it("warns about speed and distance with the work period's interval", async () => {
			expect(
				await check(
					"driver",
					van(null, null, 1_501),
					parseInstant("2026-07-28T06:00:00Z"),
					parseInstant("2026-07-28T16:00:00Z"),
				),
			).toEqual([
				{ code: "speed_above_limit", averageKmh: 150.1 },
				{ code: "distance_above_limit", distanceKm: 1_501 },
			]);
		});

		it("reads nothing of a vehicle outside the organization", async () => {
			expect(
				await check("foreign", van(1, 2), parseInstant("2026-07-28T06:00:00Z"), null, {
					organizationId: OTHER_ORG,
				}),
			).toEqual([]);
		});
	});
});
