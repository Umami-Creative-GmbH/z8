/**
 * PostgreSQL contract (#762, Time Tracking ADR-0004): behind every writer, the
 * database refuses any insert, update or delete of work records or absences
 * touching a closed range, before or after the change. Notes stay editable.
 * Erasing the whole employee or organization still succeeds. A close and an
 * absence writer serialize on the organization configuration guard, so the
 * close sees what the writer committed and the writer sees the close.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as authSchema from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { openIntegrationPool } from "@/test/integration-database";
import { acquireOrganizationConfigurationGuard } from "@/lib/time-tracking/work-transaction/ranks";
import { MONTH_CLOSED_SQLSTATE, monthClosedRefusalOf } from "./refusal";
import { assertAbsenceDaysOpen, closeMonth, reopenMonth } from "./store";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "./testing/closed-month-database.test.fixture";

const now = parseInstant("2026-04-10T12:00:00Z");
const monthClosed = { code: MONTH_CLOSED_SQLSTATE, detail: "2026-03" };

describe("the closed-month database refusal", () => {
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	/** An organization in UTC with one employee whose March holds work and an absence. */
	async function closedMarch() {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		const march = await fixture.work({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			userId: person.userId,
			start: "2026-03-10T08:00:00Z",
			end: "2026-03-10T16:00:00Z",
		});
		// A night shift from 31 March 22:00 into 1 April.
		const night = await fixture.work({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			userId: person.userId,
			start: "2026-03-31T22:00:00Z",
			end: "2026-04-01T02:00:00Z",
		});
		// A vacation from 28 March to 3 April.
		const vacation = await fixture.absence({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			startDate: "2026-03-28",
			endDate: "2026-04-03",
		});
		const closed = await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});
		expect(closed.kind).toBe("closed");
		return { org, person, march, night, vacation };
	}

	it("refuses raw inserts, updates and deletes of work touching the closed range", async () => {
		const { org, person, march, night } = await closedMarch();
		const { pool } = fixture;

		await expect(
			fixture.work({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				userId: person.userId,
				start: "2026-03-20T08:00:00Z",
				end: "2026-03-20T09:00:00Z",
			}),
		).rejects.toMatchObject(monthClosed);
		await expect(
			pool.query("update work_period set end_time = end_time - interval '1 hour' where id = $1", [
				march.workPeriodId,
			]),
		).rejects.toMatchObject(monthClosed);
		// Moving the night shift's April end still changes work touching March.
		await expect(
			pool.query("update work_period set end_time = end_time + interval '1 hour' where id = $1", [
				night.workPeriodId,
			]),
		).rejects.toMatchObject(monthClosed);
		await expect(
			pool.query("update work_period set work_location_type = 'home' where id = $1", [
				march.workPeriodId,
			]),
		).rejects.toMatchObject(monthClosed);
		await expect(
			pool.query("delete from work_period where id = $1", [march.workPeriodId]),
		).rejects.toMatchObject(monthClosed);
		await expect(
			pool.query(
				"update time_entry set timestamp = timestamp + interval '1 minute' where id = $1",
				[march.clockInId],
			),
		).rejects.toMatchObject(monthClosed);
		await expect(
			pool.query("delete from time_entry where id = $1", [march.clockOutId]),
		).rejects.toMatchObject(monthClosed);
	});

	it("refuses moving work from an open month into the closed one", async () => {
		const { org, person } = await closedMarch();
		const april = await fixture.work({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			userId: person.userId,
			start: "2026-04-05T08:00:00Z",
			end: "2026-04-05T16:00:00Z",
		});

		await expect(
			fixture.pool.query(
				"update work_period set start_time = '2026-03-30 08:00', end_time = '2026-03-30 16:00' where id = $1",
				[april.workPeriodId],
			),
		).rejects.toMatchObject(monthClosed);
		await expect(
			fixture.pool.query(
				"update work_period set end_time = end_time + interval '1 hour' where id = $1",
				[april.workPeriodId],
			),
		).resolves.toMatchObject({ rowCount: 1 });
	});

	it("leaves notes on closed work editable", async () => {
		const { march } = await closedMarch();

		await expect(
			fixture.pool.query("update time_entry set notes = 'Client visit' where id = $1", [
				march.clockOutId,
			]),
		).resolves.toMatchObject({ rowCount: 1 });
	});

	it("refuses raw inserts, updates and deletes of absences touching the closed month, but not their notes", async () => {
		const { org, person, vacation } = await closedMarch();
		const { pool } = fixture;

		await expect(
			fixture.absence({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				startDate: "2026-02-27",
				endDate: "2026-03-02",
			}),
		).rejects.toMatchObject(monthClosed);
		await expect(
			pool.query("update absence_entry set end_date = '2026-04-02' where id = $1", [vacation]),
		).rejects.toMatchObject(monthClosed);
		await expect(
			pool.query("update absence_entry set status = 'rejected' where id = $1", [vacation]),
		).rejects.toMatchObject(monthClosed);
		await expect(
			pool.query("delete from absence_entry where id = $1", [vacation]),
		).rejects.toMatchObject(monthClosed);
		await expect(
			pool.query("update absence_entry set notes = 'Booked in January' where id = $1", [vacation]),
		).resolves.toMatchObject({ rowCount: 1 });
		await expect(
			fixture.absence({
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				startDate: "2026-04-10",
				endDate: "2026-04-12",
			}),
		).resolves.toEqual(expect.any(String));
	});

	it("surfaces the database refusal as the typed month-closed refusal", async () => {
		const { march } = await closedMarch();

		const error = await fixture.db
			.delete(schema.workPeriod)
			.where(eq(schema.workPeriod.id, march.workPeriodId))
			.then(
				() => null,
				(failure: unknown) => failure,
			);

		expect(monthClosedRefusalOf(error)).toMatchObject({
			_tag: "MonthClosedError",
			month: "2026-03",
		});
	});

	it("lets a reopened employee's March change again", async () => {
		const { org, person, march } = await closedMarch();
		await reopenMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "employees", employeeIds: [person.employeeId] },
			reason: "Forgotten overtime",
			actorUserId: org.ownerUserId,
		});

		await expect(
			fixture.pool.query(
				"update work_period set end_time = end_time - interval '1 hour' where id = $1",
				[march.workPeriodId],
			),
		).resolves.toMatchObject({ rowCount: 1 });
	});

	it("still erases a whole employee and a whole organization", async () => {
		const first = await closedMarch();
		await fixture.pool.query("delete from employee where id = $1", [first.person.employeeId]);
		const { rows: leftWork } = await fixture.pool.query(
			"select id from work_period where employee_id = $1",
			[first.person.employeeId],
		);
		expect(leftWork).toEqual([]);

		const second = await closedMarch();
		await fixture.pool.query("delete from organization where id = $1", [second.org.organizationId]);
		const { rows: leftAbsences } = await fixture.pool.query(
			"select id from absence_entry where employee_id = $1",
			[second.person.employeeId],
		);
		expect(leftAbsences).toEqual([]);
	});

	it("serializes a close with an absence writer: the close sees the committed request", async () => {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		const writerPool = openIntegrationPool({ max: 1 });
		const writer = drizzle({ client: writerPool, schema: { ...authSchema, ...schema } });

		let releaseWriter: () => void = () => {};
		const writerHolds = new Promise<void>((resolve) => {
			releaseWriter = resolve;
		});
		let writerChecked: () => void = () => {};
		const checked = new Promise<void>((resolve) => {
			writerChecked = resolve;
		});
		// The absence writer checks March under the shared guard, then records a
		// pending request about March and holds its transaction open.
		const absenceWrite = writer.transaction(async (tx) => {
			await assertAbsenceDaysOpen(tx, {
				organizationId: org.organizationId,
				employeeId: person.employeeId,
				days: [{ startDate: "2026-03-30", endDate: "2026-03-31" }],
			});
			writerChecked();
			await writerHolds;
			const category = await fixture.pool.query<{ id: string }>(
				"insert into absence_category (id, organization_id, type, name, updated_at) values (gen_random_uuid(), $1, 'vacation', 'Vacation', now()) returning id",
				[org.organizationId],
			);
			await tx.insert(schema.absenceEntry).values({
				employeeId: person.employeeId,
				organizationId: org.organizationId,
				categoryId: category.rows[0].id,
				startDate: "2026-03-30",
				endDate: "2026-03-31",
				status: "pending",
			});
		});
		await checked;

		const close = closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});
		// The close waits on the writer's shared guard instead of deciding without it.
		const raced = await Promise.race([
			close.then(() => "closed"),
			new Promise((resolve) => setTimeout(() => resolve("waiting"), 300)),
		]);
		expect(raced).toBe("waiting");
		releaseWriter();
		await absenceWrite;

		await expect(close).resolves.toMatchObject({
			kind: "blocked",
			blockers: [expect.objectContaining({ kind: "absence_request" })],
		});
		await writerPool.end();
	});

	it("serializes a close with a work writer holding the configuration guard shared", async () => {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		const writerPool = openIntegrationPool({ max: 1 });
		const writer = writerPool.connect();
		const client = await writer;
		let closeSettled = false;
		try {
			// A coordinator writer takes the guard shared, then starts work in March.
			await client.query("begin");
			await acquireOrganizationConfigurationGuard(
				drizzle({ client, schema: { ...authSchema, ...schema } }),
				org.organizationId,
			);
			const clockIn = await client.query<{ id: string }>(
				`insert into time_entry (employee_id, organization_id, type, timestamp, utc_offset_minutes,
				 timezone, timezone_source, hash, created_by)
				 values ($1, $2, 'clock_in', '2026-03-31 20:00', 0, 'UTC', 'backfill', 'race', $3) returning id`,
				[person.employeeId, org.organizationId, person.userId],
			);
			await client.query(
				`insert into work_period (employee_id, organization_id, clock_in_id, start_time, is_active, updated_at)
				 values ($1, $2, $3, '2026-03-31 20:00', true, now())`,
				[person.employeeId, org.organizationId, clockIn.rows[0].id],
			);

			const close = closeMonth(fixture.db, {
				organizationId: org.organizationId,
				month: "2026-03",
				scope: { kind: "organization" },
				actor: { kind: "user", userId: org.ownerUserId },
				now,
			}).finally(() => {
				closeSettled = true;
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			expect(closeSettled).toBe(false);
			await client.query("commit");

			await expect(close).resolves.toMatchObject({
				kind: "blocked",
				blockers: [expect.objectContaining({ kind: "live_work" })],
			});
		} finally {
			client.release();
			await writerPool.end();
		}
	});

	it("refuses an absence writer that comes after the close, even under its own guard", async () => {
		const { org, person } = await closedMarch();

		await expect(
			fixture.db.transaction((tx) =>
				assertAbsenceDaysOpen(tx, {
					organizationId: org.organizationId,
					employeeId: person.employeeId,
					days: [{ startDate: "2026-03-31", endDate: "2026-04-01" }],
				}),
			),
		).rejects.toMatchObject({ _tag: "MonthClosedError", month: "2026-03" });
	});
});
