/**
 * PostgreSQL contract: platform analytics prices kiosk seats at the kiosk price (#886).
 */
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { monthlyRevenueCentsSql } from "./billing-sql";
import { getPlatformAnalyticsData } from "./service";

type Row = { interval: string | null; seats: number; kiosk_seats: number };

async function monthlyRevenueCents(rows: Row[]) {
	const values = sql.join(
		rows.map((row) => sql`(${row.interval}::text, ${row.seats}::int, ${row.kiosk_seats}::int)`),
		sql`, `,
	);
	const result = await db.execute<{ cents: string | number | null }>(sql`
		select coalesce(sum(${monthlyRevenueCentsSql({
			seats: sql`s.seats`,
			kioskSeats: sql`s.kiosk_seats`,
			billingInterval: sql`s.interval`,
		})}), 0) as cents
		from (values ${values}) as s(interval, seats, kiosk_seats)
	`);
	const resultRows = Array.isArray(result) ? result : result.rows;
	return Number(resultRows[0]?.cents);
}

describe("platform analytics monthly revenue SQL", () => {
	it("is €22 for an organization with 3 full and 5 kiosk monthly seats", async () => {
		expect(await monthlyRevenueCents([{ interval: "month", seats: 8, kiosk_seats: 5 }])).toBe(2200);
	});

	it("keeps the yearly kiosk half euro and treats any other interval as monthly", async () => {
		expect(
			await monthlyRevenueCents([
				{ interval: "year", seats: 8, kiosk_seats: 5 },
				{ interval: null, seats: 1, kiosk_seats: 1 },
			]),
		).toBe(1650 + 200);
	});

	it("prices every seat as a full seat when no kiosk seats are recorded", async () => {
		expect(
			await monthlyRevenueCents([
				{ interval: "month", seats: 8, kiosk_seats: 0 },
				{ interval: "year", seats: 10, kiosk_seats: 0 },
			]),
		).toBe(3200 + 3000);
	});
});

/**
 * Platform analytics sums every organization, so each case measures the MRR its
 * own subscription adds (suites in this project never run in parallel).
 */
describe("platform analytics MRR with kiosk seats", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function currentMrr() {
		const data = await getPlatformAnalyticsData({ range: "7d", bucket: "day" }, true);
		return data.kpis.mrr ?? 0;
	}

	async function subscribe(input: { interval: string; seats: number; kioskSeats: number }) {
		const organizationId = await fixture.createOrganization();
		await fixture.pool.query(
			`insert into subscription (organization_id, status, billing_interval, current_seats, current_kiosk_seats)
			 values ($1, 'active', $2, $3, $4)`,
			[organizationId, input.interval, input.seats, input.kioskSeats],
		);
		return organizationId;
	}

	it("adds €22 for an organization with 3 full and 5 kiosk monthly seats", async () => {
		const before = await currentMrr();
		await subscribe({ interval: "month", seats: 8, kioskSeats: 5 });

		expect((await currentMrr()) - before).toBeCloseTo(22, 2);
	});

	it("keeps the yearly kiosk half euro and reads seat audits with their kiosk split", async () => {
		const before = await currentMrr();
		const organizationId = await subscribe({ interval: "year", seats: 8, kioskSeats: 5 });
		// The estimated history reads the latest audit's kiosk split; this runs that join on real rows.
		await fixture.pool.query(
			`insert into billing_seat_audit (organization_id, action, previous_seats, new_seats, previous_kiosk_seats, new_kiosk_seats)
			 values ($1, 'member_added', 7, 8, 4, 5)`,
			[organizationId],
		);

		// 3 full yearly seats at €3 + 5 kiosk yearly seats at €1.50.
		expect((await currentMrr()) - before).toBeCloseTo(16.5, 2);
	});
});