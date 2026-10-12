/**
 * #1063 runtime evidence: the period submission status overview read from real rows.
 *
 * Local contract: pnpm --filter webapp test:integration
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import type { PeriodSubmissionOverviewScope } from "./overview";
import { loadPeriodSubmissionOverview } from "./overview-store";

// A Monday-week cadence since January in Europe/Berlin; the week of 2026-03-02 has ended.
const WEEK_START = "2026-03-02";
const NOW = parseInstant("2026-03-09T09:00:00Z");

describe("the period submission overview on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;
	let organizationId: string;
	let ownerUserId: string;
	let manager: { employeeId: string; userId: string };

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
		// The schedule reader is imported lazily; load it here, not inside the first test's timeout.
		await import("@/lib/calendar/work-policy-requirements");
	}, 60_000);

	afterAll(async () => {
		await fixture.close();
	});

	async function switchOnWeekly(organization: string) {
		await fixture.pool.query(
			`insert into period_submission_cadence_change
			 (id, organization_id, cadence, week_start_day, changed_at)
			 values ($1, $2, 'weekly', 'monday', '2026-01-01T00:00:00Z')`,
			[randomUUID(), organization],
		);
	}

	async function manage(employeeId: string, managerEmployeeId = manager.employeeId) {
		await fixture.pool.query(
			`insert into employee_managers (id, employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, $3, true, $4)`,
			[randomUUID(), employeeId, managerEmployeeId, ownerUserId],
		);
	}

	async function named(name: string, organization = organizationId) {
		const person = await fixture.employee({ organizationId: organization });
		await fixture.pool.query(`update "user" set name = $2 where id = $1`, [person.userId, name]);
		return person;
	}

	async function submission(
		person: { employeeId: string; userId: string },
		status: "pending" | "approved" | "rejected" | "withdrawn" | "outdated",
		organization = organizationId,
	) {
		const decided = status === "approved" || status === "rejected" || status === "outdated";
		const closed = status === "withdrawn" || status === "outdated";
		await fixture.pool.query(
			`insert into period_submission
			 (organization_id, employee_id, cadence, week_start_day, timezone, start_date, end_date,
			  cadence_start_date, cadence_end_date, range_start, range_end, status, submitted_by,
			  submitted_at, decided_at, decision_reason, closed_at, closed_cause)
			 values ($1, $2, 'weekly', 'monday', 'Europe/Berlin', '2026-03-02', '2026-03-08',
			  '2026-03-02', '2026-03-08', '2026-03-01T23:00:00Z', '2026-03-08T23:00:00Z', $3, $4,
			  '2026-03-08T12:00:00Z', $5, $6, $7, $8)`,
			[
				organization,
				person.employeeId,
				status,
				person.userId,
				decided ? "2026-03-09T08:00:00Z" : null,
				status === "rejected" ? "Missing Friday" : null,
				closed ? "2026-03-09T08:30:00Z" : null,
				closed ? "change" : null,
			],
		);
	}

	const overview = (
		scope: PeriodSubmissionOverviewScope,
		requestedPeriod?: string,
		organization = organizationId,
	) =>
		loadPeriodSubmissionOverview(db, {
			organizationId: organization,
			scope,
			requestedPeriod,
			now: NOW,
		});

	async function statuses(scope: PeriodSubmissionOverviewScope) {
		const result = await overview(scope);
		if (result.kind !== "ok") throw new Error(`overview is ${result.kind}`);
		return Object.fromEntries(
			result.rows.map((row) => [row.name, `${row.status}${row.highlighted ? " !" : ""}`]),
		);
	}

	beforeEach(async () => {
		({ organizationId, ownerUserId } = await fixture.organization("Europe/Berlin"));
		await fixture.pool.query(`update "user" set name = 'Owner' where id = $1`, [ownerUserId]);
		manager = await named("Manager");
		await fixture.pool.query("update employee set role = 'manager' where id = $1", [
			manager.employeeId,
		]);
		await switchOnWeekly(organizationId);
	});

	it("selects the newest ended period by default and lists the periods to pick from", async () => {
		const result = await overview({ kind: "all" });
		if (result.kind !== "ok") throw new Error(`overview is ${result.kind}`);
		expect(result.selected).toEqual({
			startDate: WEEK_START,
			endDate: "2026-03-08",
			cadence: "weekly",
		});
		expect(result.periods.slice(0, 3).map((period) => period.startDate)).toEqual([
			"2026-03-09",
			"2026-03-02",
			"2026-02-23",
		]);

		expect(result.running).toBe(false);

		const picked = await overview({ kind: "all" }, "2026-02-23");
		expect(picked.kind === "ok" && picked.selected.startDate).toBe("2026-02-23");
		const running = await overview({ kind: "all" }, "2026-03-09");
		expect(running.kind === "ok" && running.running).toBe(true);
	});

	it("shows admins every covered employee with their status, highlighting who owes the period", async () => {
		const anna = await named("Anna");
		const bert = await named("Bert");
		const cleo = await named("Cleo");
		const dora = await named("Dora");
		await submission(anna, "pending");
		await submission(bert, "rejected");
		await submission(cleo, "approved");
		await submission(dora, "outdated");

		expect(await statuses({ kind: "all" })).toEqual({
			Owner: "awaiting_submission !",
			Manager: "awaiting_submission !",
			Anna: "submitted",
			Bert: "rejected !",
			Cleo: "approved",
			Dora: "sent_back_after_change !",
		});
	});

	it("shows managers only the covered employees they manage", async () => {
		const managed = await named("Managed");
		await named("Someone else");
		await manage(managed.employeeId);
		await submission(managed, "approved");

		expect(await statuses({ kind: "managed", managerEmployeeId: manager.employeeId })).toEqual({
			Managed: "approved",
		});
	});

	it("leaves out employees not expected to submit the period", async () => {
		const kiosk = await named("Kiosk");
		await fixture.pool.query(`update "user" set email = $1 where id = $2`, [
			`kiosk-${kiosk.userId.replaceAll("-", "")}@kiosk.invalid`,
			kiosk.userId,
		]);
		const away = await named("Away");
		await fixture.absence({
			organizationId,
			employeeId: away.employeeId,
			startDate: WEEK_START,
			endDate: "2026-03-08",
		});
		const inactive = await named("Inactive");
		await fixture.pool.query("update employee set is_active = false where id = $1", [
			inactive.employeeId,
		]);
		for (const person of [kiosk, away, inactive]) await manage(person.employeeId);

		expect(await statuses({ kind: "managed", managerEmployeeId: manager.employeeId })).toEqual({});
		expect(Object.keys(await statuses({ kind: "all" })).toSorted()).toEqual(["Manager", "Owner"]);
	});

	it("reads only the organization's own employees and submissions", async () => {
		const other = await fixture.organization("Europe/Berlin");
		await switchOnWeekly(other.organizationId);
		const stranger = await named("Stranger", other.organizationId);
		await submission(stranger, "pending", other.organizationId);

		expect(Object.keys(await statuses({ kind: "all" })).toSorted()).toEqual(["Manager", "Owner"]);
	});

	it("is off for an organization that never collected period submissions", async () => {
		const other = await fixture.organization("Europe/Berlin");
		await expect(overview({ kind: "all" }, undefined, other.organizationId)).resolves.toEqual({
			kind: "off",
		});
	});
});
