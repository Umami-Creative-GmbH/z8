/**
 * PostgreSQL contract (#762): with automatic close set to N days, the daily job
 * closes the month before organization-wide once N days have passed since it
 * ended on the organization's calendar, and tells everyone allowed to close. A
 * blocker stops the close, notifies, and is retried the next day. A month that
 * was reopened is never closed automatically again.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "./testing/closed-month-database.test.fixture";

vi.mock("server-only", () => ({}));

const { closeMonthAutomatically, saveClosedMonthSettings, runAutomaticMonthClose } = await import(
	"./automatic-close"
);
const { closedRangesForEmployee, reopenMonth } = await import("./store");

describe("automatic month close on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function organizationWithAutomaticClose(afterDays = 5) {
		const org = await fixture.organization("Europe/Berlin");
		const person = await fixture.employee({ organizationId: org.organizationId });
		await saveClosedMonthSettings(fixture.db, {
			organizationId: org.organizationId,
			actorUserId: org.ownerUserId,
			settings: { autoCloseEnabled: true, autoCloseAfterDays: afterDays },
		});
		return { org, person };
	}

	async function notifications(organizationId: string, type: string) {
		const { rows } = await fixture.pool.query<{ user_id: string }>(
			"select user_id from notification where organization_id = $1 and type = $2",
			[organizationId, type],
		);
		return rows.map((row) => row.user_id);
	}

	async function closeAt(organizationId: string, instant: string, afterDays = 5) {
		return closeMonthAutomatically(fixture.db, {
			organizationId,
			afterDays,
			timezone: "Europe/Berlin",
			now: parseInstant(instant),
		});
	}

	it("closes the month before once N days have passed, and tells everyone allowed to close", async () => {
		const { org, person } = await organizationWithAutomaticClose(5);

		// 5 April 23:00 in Berlin: only four days have passed.
		expect(await closeAt(org.organizationId, "2026-04-05T21:00:00Z")).toEqual({ kind: "not_due" });
		// Just after midnight on 6 April in Berlin.
		await expect(closeAt(org.organizationId, "2026-04-05T22:30:00Z")).resolves.toMatchObject({
			kind: "closed",
			month: "2026-03",
		});

		expect(
			(
				await closedRangesForEmployee(fixture.db, {
					organizationId: org.organizationId,
					employeeId: person.employeeId,
				})
			).map((range) => range.month),
		).toEqual(["2026-03"]);
		expect(await notifications(org.organizationId, "month_closed_automatically")).toEqual([
			org.ownerUserId,
		]);
		const { rows } = await fixture.pool.query(
			"select actor_kind, closed_by, covers_new_employees from closed_month where organization_id = $1",
			[org.organizationId],
		);
		expect(rows).toEqual([{ actor_kind: "system", closed_by: null, covers_new_employees: true }]);
	});

	it("does not close with a blocker, notifies once per day, and retries the next day", async () => {
		const { org, person } = await organizationWithAutomaticClose(5);
		const pending = await fixture.absence({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			startDate: "2026-03-30",
			endDate: "2026-03-31",
			status: "pending",
		});

		await expect(closeAt(org.organizationId, "2026-04-06T08:00:00Z")).resolves.toMatchObject({
			kind: "blocked",
			blockerCount: 1,
		});
		await expect(closeAt(org.organizationId, "2026-04-06T09:00:00Z")).resolves.toMatchObject({
			kind: "already_attempted",
		});
		expect(await notifications(org.organizationId, "month_close_blocked")).toEqual([
			org.ownerUserId,
		]);

		await fixture.pool.query("update absence_entry set status = 'approved' where id = $1", [
			pending,
		]);
		await expect(closeAt(org.organizationId, "2026-04-07T08:00:00Z")).resolves.toMatchObject({
			kind: "closed",
		});
	});

	it("never closes a reopened month again", async () => {
		const { org } = await organizationWithAutomaticClose(5);
		await closeAt(org.organizationId, "2026-04-06T08:00:00Z");
		await reopenMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "all" },
			reason: "Payroll correction",
			actorUserId: org.ownerUserId,
		});

		await expect(closeAt(org.organizationId, "2026-04-07T08:00:00Z")).resolves.toEqual({
			kind: "reopened_before",
			month: "2026-03",
		});
	});

	it("runs only for organizations that turned automatic close on", async () => {
		const off = await fixture.organization("Europe/Berlin");
		await fixture.employee({ organizationId: off.organizationId });
		const { org } = await organizationWithAutomaticClose(5);

		await runAutomaticMonthClose(fixture.db, { now: parseInstant("2026-04-08T08:00:00Z") });

		const { rows } = await fixture.pool.query<{ organization_id: string }>(
			"select organization_id from closed_month where organization_id = any($1::text[])",
			[[off.organizationId, org.organizationId]],
		);
		expect(rows.map((row) => row.organization_id)).toEqual([org.organizationId]);
	});
});
