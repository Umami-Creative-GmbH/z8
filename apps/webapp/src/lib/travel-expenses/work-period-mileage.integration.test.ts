/**
 * #1131 (spec #807): a mileage item pre-filled from work driven in the
 * employee's own vehicle, added to a draft trip or a new standalone report.
 * The item remembers its source work period, so a work period's driven
 * distance is in at most one expense report, also under concurrent requests.
 *
 * The real actions and stores run against a disposable PostgreSQL database;
 * only the session is replaced.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const harness = vi.hoisted(() => ({
	userId: null as string | null,
	organizationId: "t1131-org",
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				harness.userId
					? {
							user: { id: harness.userId, role: "user" },
							session: {
								id: `session-${harness.userId}`,
								userId: harness.userId,
								activeOrganizationId: harness.organizationId,
							},
						}
					: null,
		},
	},
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject() {
		throw new Error("not used");
	},
	async readPrivateObject() {
		throw new Error("not used");
	},
	async deletePrivateObject() {},
}));

vi.setConfig({ testTimeout: 60_000 });

const workMileage = await import(
	"@/app/[locale]/(app)/travel-expenses/work-period-mileage-actions"
);
const reportActions = await import("@/app/[locale]/(app)/travel-expenses/report-actions");
const mileageActions = await import("@/app/[locale]/(app)/travel-expenses/mileage-actions");
const policyActions = await import(
	"@/app/[locale]/(app)/settings/travel-expenses/mileage-policy-actions"
);
const { addWorkPeriodMileage } = await import("./work-period-mileage");
const { db } = await import("@/db");

const ids = {
	anna: "e1131000-0000-4000-8000-000000000001",
	bert: "e1131000-0000-4000-8000-000000000002",
	boss: "e1131000-0000-4000-8000-000000000003",
	foreigner: "e1131000-0000-4000-8000-000000000004",
} as const;
type Person = keyof typeof ids;

const periods = {
	/** Anna, own vehicle, 61 km, started 00:30 local (+02:00) on 15 September. */
	own: "a1131000-0000-4000-8000-000000000001",
	/** Anna, an organization vehicle. */
	company: "a1131000-0000-4000-8000-000000000002",
	/** Anna, own vehicle without a driven distance (start reading only). */
	noDistance: "a1131000-0000-4000-8000-000000000003",
	/** Bert's own-vehicle work in the same organization. */
	bert: "a1131000-0000-4000-8000-000000000004",
	/** Own-vehicle work in another organization. */
	foreign: "a1131000-0000-4000-8000-000000000005",
	/** Anna, own vehicle, deleted. */
	deleted: "a1131000-0000-4000-8000-000000000006",
	/** Anna, own vehicle, still running. */
	running: "a1131000-0000-4000-8000-000000000007",
} as const;
const vehicleId = "c1131000-0000-4000-8000-000000000001";

const admin = integrationAdminPool();

function owner(person: Person) {
	return {
		organizationId: person === "foreigner" ? "t1131-foreign" : "t1131-org",
		employeeId: ids[person],
		userId: `t1131-${person}`,
	};
}

async function cleanup() {
	await admin.query("delete from organization where id in ('t1131-org', 't1131-foreign')");
	await admin.query('delete from "user" where id like $1', ["t1131-%"]);
}

async function seedWork(input: {
	id: string;
	person: Person;
	vehicleKind: "own" | "organization";
	startKm?: number | null;
	endKm?: number | null;
	distanceKm: number | null;
	deleted?: boolean;
	running?: boolean;
}) {
	const { organizationId, employeeId, userId } = owner(input.person);
	const clockIn = input.id.replace(/^a/, "b");
	// 00:30 on 15 September at +02:00 is still 14 September in UTC.
	const startedAt = new Date("2026-09-14T22:30:00Z");
	const endedAt = new Date("2026-09-15T06:30:00Z");
	await admin.query(
		`insert into time_entry (id, employee_id, organization_id, type, timestamp, utc_offset_minutes,
			timezone_source, hash, created_by) values ($1, $2, $3, 'clock_in', $4, 120, 'test', md5(random()::text), $5)`,
		[clockIn, employeeId, organizationId, startedAt, userId],
	);
	await admin.query(
		`insert into work_period (id, employee_id, organization_id, clock_in_id, start_time, end_time,
			duration_minutes, is_active, updated_at, vehicle_kind, vehicle_id, odometer_start_km,
			odometer_end_km, driven_distance_km, deleted_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $5, $9, $10, $11, $12, $13, $14)`,
		[
			input.id,
			employeeId,
			organizationId,
			clockIn,
			startedAt,
			input.running ? null : endedAt,
			input.running ? null : 480,
			Boolean(input.running),
			input.vehicleKind,
			input.vehicleKind === "organization" ? vehicleId : null,
			input.startKm ?? null,
			input.endKm ?? null,
			input.distanceKm,
			input.deleted ? endedAt : null,
		],
	);
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at) values
		 ('t1131-org','Mileage from work','t1131-org','Europe/Berlin',now()),
		 ('t1131-foreign','Foreign','t1131-foreign','UTC',now())`,
	);
	const people: Array<[Person, string, string]> = [
		["anna", "member", "employee"],
		["bert", "member", "employee"],
		["boss", "admin", "admin"],
		["foreigner", "admin", "admin"],
	];
	for (const [name, memberRole, employeeRole] of people) {
		const { organizationId } = owner(name);
		await admin.query(
			'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,now(),now())',
			[`t1131-${name}`, name, `t1131-${name}@example.test`],
		);
		await admin.query(
			"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,$4,'approved',now())",
			[`t1131-member-${name}`, organizationId, `t1131-${name}`, memberRole],
		);
		await admin.query(
			"insert into employee (id,user_id,organization_id,role,updated_at) values ($1,$2,$3,$4,now())",
			[ids[name], `t1131-${name}`, organizationId, employeeRole],
		);
	}
	await admin.query(
		`insert into organization_vehicle (id, organization_id, name, licence_plate) values ($1, 't1131-org', 'Van', 'B-ZV 1131')`,
		[vehicleId],
	);
	await seedWork({ id: periods.own, person: "anna", vehicleKind: "own", distanceKm: 61 });
	await seedWork({
		id: periods.company,
		person: "anna",
		vehicleKind: "organization",
		startKm: 1000,
		endKm: 1040,
		distanceKm: 40,
	});
	await seedWork({
		id: periods.noDistance,
		person: "anna",
		vehicleKind: "own",
		startKm: 1000,
		distanceKm: null,
	});
	await seedWork({ id: periods.bert, person: "bert", vehicleKind: "own", distanceKm: 12 });
	await seedWork({ id: periods.foreign, person: "foreigner", vehicleKind: "own", distanceKm: 9 });
	await seedWork({
		id: periods.deleted,
		person: "anna",
		vehicleKind: "own",
		distanceKm: 20,
		deleted: true,
	});
	await seedWork({
		id: periods.running,
		person: "anna",
		vehicleKind: "own",
		distanceKm: 20,
		running: true,
	});
}

function signIn(person: Person) {
	harness.userId = `t1131-${person}`;
	harness.organizationId = owner(person).organizationId;
}

async function offer(workPeriodId: string, as: Person = "anna") {
	signIn(as);
	const result = await workMileage.getWorkPeriodMileageAction(workPeriodId);
	if (!result.success) throw new Error(result.error);
	return result.data;
}

async function add(workPeriodId: string, reportId: string | null = null, as: Person = "anna") {
	signIn(as);
	return workMileage.addWorkPeriodMileageAction({ workPeriodId, reportId });
}

async function load(reportId: string) {
	signIn("anna");
	const loaded = await reportActions.getMyTravelExpenseReport(reportId);
	if (!loaded.success) throw new Error(loaded.error);
	return loaded.data;
}

async function createTrip(as: Person = "anna") {
	signIn(as);
	const created = await reportActions.createTripReportAction();
	if (!created.success) throw new Error(created.error);
	return created.data.reportId;
}

async function activateCarRate(car: string) {
	signIn("boss");
	const result = await policyActions.activateMileagePolicyVersionAction({
		source: "organization",
		effectiveFrom: "2026-01-01",
		currency: "EUR",
		ratesPerKm: { car, other_motor_vehicle: "0.20" },
	});
	if (!result.success || result.data.status !== "activated") {
		throw new Error(`activation failed: ${JSON.stringify(result)}`);
	}
}

describe("mileage item from own-vehicle work (#1131)", () => {
	beforeEach(seed);
	afterAll(cleanup);

	it("creates a standalone mileage report pre-filled from the work and priced by the mileage policy", async () => {
		await activateCarRate("0.30");
		expect(await offer(periods.own)).toEqual({
			status: "available",
			// The work's local start date at its clock-in offset, not the UTC date.
			expenseDate: "2026-09-15",
			distanceKm: 61,
			trips: [],
		});

		const added = await add(periods.own);
		if (!added.success || added.data.status !== "added") {
			throw new Error(`add failed: ${JSON.stringify(added)}`);
		}
		const report = await load(added.data.reportId);
		expect(report.kind).toBe("standalone");
		expect(report.items).toHaveLength(1);
		const [item] = report.items;
		expect(item).toMatchObject({
			id: added.data.itemId,
			type: "mileage",
			expenseDate: "2026-09-15",
			mileage: {
				route: null,
				distanceKm: "61.00",
				vehicle: "car",
				amount: "18.30",
				currency: "EUR",
			},
		});
		expect(await offer(periods.own)).toEqual({
			status: "added",
			reportId: added.data.reportId,
		});
	});

	it("appends the item to a chosen draft trip, and the employee enters the route and may change the vehicle kind", async () => {
		await activateCarRate("0.30");
		const tripId = await createTrip();
		const available = await offer(periods.own);
		expect(available).toMatchObject({
			status: "available",
			trips: [{ id: tripId, purpose: null, startDate: null, endDate: null }],
		});

		const added = await add(periods.own, tripId);
		expect(added).toMatchObject({ success: true, data: { status: "added", reportId: tripId } });
		const [item] = (await load(tripId)).items;
		expect(item).toMatchObject({
			type: "mileage",
			expenseDate: "2026-09-15",
			mileage: { distanceKm: "61.00", vehicle: "car", amount: "18.30" },
		});

		signIn("anna");
		const saved = await mileageActions.saveMileageItemDraftAction({
			reportId: tripId,
			itemId: item!.id,
			expectedVersion: item!.version,
			values: {
				expenseDate: "2026-09-15",
				route: "Office – customer – back",
				distanceKm: "61",
				vehicle: "other_motor_vehicle",
				accountingReference: null,
			},
		});
		expect(saved).toMatchObject({
			success: true,
			data: {
				status: "saved",
				item: { mileage: { vehicle: "other_motor_vehicle", amount: "12.20" } },
			},
		});
		// Editing the item keeps it the work period's one item.
		expect(await offer(periods.own)).toEqual({ status: "added", reportId: tripId });
	});

	it("refuses a second item for the same work period, into any report", async () => {
		const tripId = await createTrip();
		const first = await add(periods.own);
		if (!first.success || first.data.status !== "added") throw new Error("first add failed");

		expect(await add(periods.own)).toEqual({
			success: true,
			data: { status: "already_added", reportId: first.data.reportId },
		});
		expect(await add(periods.own, tripId)).toEqual({
			success: true,
			data: { status: "already_added", reportId: first.data.reportId },
		});
		expect((await load(tripId)).items).toHaveLength(0);
		const { rows } = await admin.query(
			"select count(*)::int as count from travel_expense_report where organization_id = 't1131-org'",
		);
		expect(rows[0]).toEqual({ count: 2 });
	});

	it("lets exactly one of concurrent requests for the same work period add an item", async () => {
		const trips = [await createTrip(), await createTrip()];
		const results = await Promise.all([
			addWorkPeriodMileage(db, owner("anna"), { workPeriodId: periods.own, reportId: null }),
			addWorkPeriodMileage(db, owner("anna"), { workPeriodId: periods.own, reportId: trips[0]! }),
			addWorkPeriodMileage(db, owner("anna"), { workPeriodId: periods.own, reportId: trips[1]! }),
		]);
		expect(results.map((result) => result.kind).sort()).toEqual([
			"added",
			"already_added",
			"already_added",
		]);
		const winner = results.find((result) => result.kind === "added");
		for (const result of results) {
			if (result.kind === "already_added") {
				expect(result.reportId).toBe(winner?.kind === "added" ? winner.reportId : undefined);
			}
		}
		const { rows } = await admin.query(
			`select
				(select count(*)::int from travel_expense_report_item where source_work_period_id = $1) as items,
				(select count(*)::int from travel_expense_report where organization_id = 't1131-org') as reports`,
			[periods.own],
		);
		// A losing standalone request leaves no empty report behind.
		expect(rows[0]).toEqual({
			items: 1,
			reports:
				winner?.kind === "added" && winner.reportId !== trips[0] && winner.reportId !== trips[1]
					? 3
					: 2,
		});
	});

	it("offers the work again once its mileage item is removed from the trip", async () => {
		const tripId = await createTrip();
		await add(periods.own, tripId);
		const [item] = (await load(tripId)).items;
		signIn("anna");
		expect(
			await reportActions.removeTripReportItemAction({
				reportId: tripId,
				itemId: item!.id,
				expectedVersion: item!.version,
			}),
		).toMatchObject({ success: true, data: { status: "removed" } });

		expect(await offer(periods.own)).toMatchObject({ status: "available" });
		expect(await add(periods.own)).toMatchObject({ success: true, data: { status: "added" } });
	});

	it("offers the work again once its standalone draft report is deleted", async () => {
		const first = await add(periods.own);
		if (!first.success || first.data.status !== "added") throw new Error("first add failed");
		signIn("anna");
		expect(
			await reportActions.deleteDraftTravelExpenseReportAction({ reportId: first.data.reportId }),
		).toMatchObject({ success: true });

		expect(await offer(periods.own)).toMatchObject({ status: "available" });
	});

	it("offers only the employee's own completed own-vehicle work with a driven distance", async () => {
		for (const workPeriodId of [
			periods.company,
			periods.noDistance,
			periods.deleted,
			periods.running,
			periods.bert,
			periods.foreign,
		]) {
			expect(await offer(workPeriodId)).toEqual({ status: "unavailable" });
			expect(await add(workPeriodId)).toEqual({ success: false, error: "Work period not found" });
		}
		// Bert's and the foreign administrator's own work is theirs to add, not Anna's.
		expect(await offer(periods.bert, "bert")).toMatchObject({ status: "available" });
		expect(await offer(periods.foreign, "foreigner")).toMatchObject({ status: "available" });
		// Nothing of Anna's leaks to the other organization, even by id.
		expect(await offer(periods.own, "foreigner")).toEqual({ status: "unavailable" });
		const { rows } = await admin.query(
			"select count(*)::int as count from travel_expense_report_item where source_work_period_id is not null",
		);
		expect(rows[0]).toEqual({ count: 0 });
	});

	it("adds only into the employee's own draft trip", async () => {
		const bertsTrip = await createTrip("bert");
		expect(await add(periods.own, bertsTrip)).toEqual({
			success: false,
			error: "Expense report not found",
		});
		expect((await offer(periods.own)).status).toBe("available");
		// Each employee picks from their own draft trips only.
		expect(await offer(periods.bert, "bert")).toMatchObject({
			status: "available",
			trips: [{ id: bertsTrip }],
		});
	});

	it("keeps the mileage item when its work period is hard-deleted, without the link", async () => {
		const added = await add(periods.own);
		if (!added.success || added.data.status !== "added") throw new Error("add failed");
		await admin.query("delete from work_period where id = $1", [periods.own]);
		const { rows } = await admin.query(
			"select organization_id, source_work_period_id, mileage_distance_km from travel_expense_report_item where id = $1",
			[added.data.itemId],
		);
		expect(rows[0]).toEqual({
			organization_id: "t1131-org",
			source_work_period_id: null,
			mileage_distance_km: "61.00",
		});
	});
});
