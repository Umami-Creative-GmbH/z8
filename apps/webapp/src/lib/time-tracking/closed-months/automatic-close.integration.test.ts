/**
 * PostgreSQL contract (#762): with automatic close set to N days, the daily job
 * closes, organization-wide, the latest month that ended N days ago on the
 * organization's calendar, and tells everyone allowed to close. A blocker stops
 * the close, notifies, and is retried every day, also after later months came
 * due. Only months that were never closed are closed, so a reopened month is
 * never closed automatically again.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "./testing/closed-month-database.test.fixture";

vi.mock("server-only", () => ({}));

const { closeMonthsAutomatically, saveClosedMonthSettings, runAutomaticMonthClose } = await import(
	"./automatic-close"
);
const { closedRangesForEmployee, closeMonth, reopenMonth } = await import("./store");

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
		const { rows } = await fixture.pool.query<{ user_id: string; metadata: string }>(
			"select user_id, metadata from notification where organization_id = $1 and type = $2",
			[organizationId, type],
		);
		return rows;
	}

	function closeAt(organizationId: string, instant: string, afterDays = 5) {
		return closeMonthsAutomatically(fixture.db, {
			organizationId,
			afterDays,
			timezone: "Europe/Berlin",
			now: parseInstant(instant),
		});
	}

	async function closedMonths(organizationId: string, employeeId: string) {
		return (await closedRangesForEmployee(fixture.db, { organizationId, employeeId })).map(
			(range) => range.month,
		);
	}

	it("closes a month once N days have passed since it ended, and tells everyone allowed to close", async () => {
		const { org, person } = await organizationWithAutomaticClose(5);

		// 5 April 23:00 in Berlin: only four days of April have passed; February is due.
		await expect(closeAt(org.organizationId, "2026-04-05T21:00:00Z")).resolves.toEqual([
			expect.objectContaining({ kind: "closed", month: "2026-02" }),
		]);
		// Just after midnight on 6 April in Berlin, March is due.
		await expect(closeAt(org.organizationId, "2026-04-05T22:30:00Z")).resolves.toEqual([
			expect.objectContaining({ kind: "closed", month: "2026-03" }),
		]);

		expect(await closedMonths(org.organizationId, person.employeeId)).toEqual([
			"2026-02",
			"2026-03",
		]);
		expect(
			(await notifications(org.organizationId, "month_closed_automatically")).map(
				(row) => row.user_id,
			),
		).toEqual([org.ownerUserId, org.ownerUserId]);
		const { rows } = await fixture.pool.query(
			"select distinct actor_kind, closed_by, covers_new_employees from closed_month where organization_id = $1",
			[org.organizationId],
		);
		expect(rows).toEqual([{ actor_kind: "system", closed_by: null, covers_new_employees: true }]);
	});

	it("closes a month only after long delays have passed, reaching back past the month before", async () => {
		const { org } = await organizationWithAutomaticClose(45);
		await closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-02",
			scope: { kind: "organization" },
			actor: { kind: "user", userId: org.ownerUserId },
			now: parseInstant("2026-04-01T00:00:00Z"),
		});

		// March ended on 1 April; 45 days later is 16 May.
		await expect(closeAt(org.organizationId, "2026-05-15T08:00:00Z", 45)).resolves.toEqual([
			{ kind: "closed_before", month: "2026-02" },
		]);
		await expect(closeAt(org.organizationId, "2026-05-16T08:00:00Z", 45)).resolves.toEqual([
			expect.objectContaining({ kind: "closed", month: "2026-03" }),
		]);
	});

	it("does not close with a blocker, lists it once per day, and retries after the next month came due", async () => {
		const { org, person } = await organizationWithAutomaticClose(5);
		const pending = await fixture.absence({
			organizationId: org.organizationId,
			employeeId: person.employeeId,
			startDate: "2026-03-30",
			endDate: "2026-03-31",
			status: "pending",
		});

		await expect(closeAt(org.organizationId, "2026-04-06T08:00:00Z")).resolves.toEqual([
			{ kind: "blocked", month: "2026-03", blockerCount: 1 },
		]);
		await expect(closeAt(org.organizationId, "2026-04-06T09:00:00Z")).resolves.toEqual([
			{ kind: "already_attempted", month: "2026-03" },
		]);
		const blocked = await notifications(org.organizationId, "month_close_blocked");
		expect(blocked.map((row) => row.user_id)).toEqual([org.ownerUserId]);
		expect(JSON.parse(blocked[0].metadata).i18n.params).toMatchObject({
			absenceRequests: 1,
			timeRequests: 0,
			liveWork: 0,
			periodSubmissions: 0,
		});

		// Still blocked when April comes due: both months are attempted, March first.
		await expect(closeAt(org.organizationId, "2026-05-06T08:00:00Z")).resolves.toEqual([
			{ kind: "blocked", month: "2026-03", blockerCount: 1 },
			expect.objectContaining({ kind: "closed", month: "2026-04" }),
		]);

		await fixture.pool.query("update absence_entry set status = 'approved' where id = $1", [
			pending,
		]);
		await expect(closeAt(org.organizationId, "2026-05-07T08:00:00Z")).resolves.toEqual([
			expect.objectContaining({ kind: "closed", month: "2026-03" }),
			{ kind: "closed_before", month: "2026-04" },
		]);
	});

	it("never closes a month that was closed before, also when it was reopened", async () => {
		const { org } = await organizationWithAutomaticClose(5);
		await closeAt(org.organizationId, "2026-04-06T08:00:00Z");
		await reopenMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope: { kind: "all" },
			reason: "Payroll correction",
			actorUserId: org.ownerUserId,
		});

		await expect(closeAt(org.organizationId, "2026-04-07T08:00:00Z")).resolves.toEqual([
			{ kind: "closed_before", month: "2026-03" },
		]);
	});

	it("runs only for organizations that turned automatic close on", async () => {
		const off = await fixture.organization("Europe/Berlin");
		await fixture.employee({ organizationId: off.organizationId });
		const { org } = await organizationWithAutomaticClose(5);

		await runAutomaticMonthClose(fixture.db, { now: parseInstant("2026-04-08T08:00:00Z") });

		const { rows } = await fixture.pool.query<{ organization_id: string }>(
			"select distinct organization_id from closed_month where organization_id = any($1::text[])",
			[[off.organizationId, org.organizationId]],
		);
		expect(rows.map((row) => row.organization_id)).toEqual([org.organizationId]);
	});
});
