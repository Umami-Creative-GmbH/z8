/**
 * PostgreSQL contract (#836, Time Tracking ADR-0004): a location close covers the employees
 * assigned to the location when it is closed, including departed ones whose assignment
 * remains, and freezes each one's whole month, work at other locations included. Coverage and
 * ranges are fixed at close; reopening uses the existing employee, team and all choices.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	assertWorkOpen,
	closedMonthHistory,
	closedRangesForEmployee,
	closeMonth,
	reopenMonth,
	workInterval,
} from "./store";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "./testing/closed-month-database.test.fixture";

const now = parseInstant("2026-04-10T12:00:00Z");
const marchShift = workInterval(new Date("2026-03-10T08:00:00Z"), new Date("2026-03-10T16:00:00Z"));

describe("closing a month for a location on PostgreSQL", () => {
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function site(organizationId: string, ownerUserId: string, name?: string) {
		return fixture.location({ organizationId, createdBy: ownerUserId, name });
	}

	function closeFor(
		org: { organizationId: string; ownerUserId: string },
		scope: Parameters<typeof closeMonth>[1]["scope"],
	) {
		return closeMonth(fixture.db, {
			organizationId: org.organizationId,
			month: "2026-03",
			scope,
			actor: { kind: "user", userId: org.ownerUserId },
			now,
		});
	}

	function isOpen(organizationId: string, employeeId: string) {
		return assertWorkOpen(fixture.db, { organizationId, employeeId, intervals: [marchShift] }).then(
			() => true,
			() => false,
		);
	}

	it("freezes the whole month of an employee assigned to A and B, and leaves B-only staff open", async () => {
		const org = await fixture.organization("UTC");
		const siteA = await site(org.organizationId, org.ownerUserId, "A");
		const siteB = await site(org.organizationId, org.ownerUserId, "B");
		const both = await fixture.employee({ organizationId: org.organizationId });
		const onlyB = await fixture.employee({ organizationId: org.organizationId });
		for (const locationId of [siteA, siteB]) {
			await fixture.assignLocation({
				organizationId: org.organizationId,
				employeeId: both.employeeId,
				locationId,
			});
		}
		await fixture.assignLocation({
			organizationId: org.organizationId,
			employeeId: onlyB.employeeId,
			locationId: siteB,
		});

		const result = await closeFor(org, { kind: "location", locationId: siteA });

		expect(result).toMatchObject({ kind: "closed", employeeIds: [both.employeeId] });
		expect(await isOpen(org.organizationId, both.employeeId)).toBe(false);
		expect(await isOpen(org.organizationId, onlyB.employeeId)).toBe(true);
	});

	it("covers a departed employee whose assignment remains, but not a supervisor without one", async () => {
		const org = await fixture.organization("UTC");
		const siteA = await site(org.organizationId, org.ownerUserId);
		const departed = await fixture.employee({
			organizationId: org.organizationId,
			departed: true,
		});
		const supervisor = await fixture.employee({ organizationId: org.organizationId });
		await fixture.assignLocation({
			organizationId: org.organizationId,
			employeeId: departed.employeeId,
			locationId: siteA,
		});
		await fixture.superviseLocation({
			employeeId: supervisor.employeeId,
			locationId: siteA,
			createdBy: org.ownerUserId,
		});

		const result = await closeFor(org, { kind: "location", locationId: siteA });

		expect(result).toMatchObject({ kind: "closed", employeeIds: [departed.employeeId] });
		expect(await isOpen(org.organizationId, supervisor.employeeId)).toBe(true);
	});

	it("keeps coverage and frozen instants after assignment, timezone and team changes", async () => {
		const org = await fixture.organization("UTC");
		const siteA = await site(org.organizationId, org.ownerUserId);
		const teamA = await fixture.team(org.organizationId, "A");
		const covered = await fixture.employee({
			organizationId: org.organizationId,
			timezone: "Europe/Berlin",
		});
		const later = await fixture.employee({ organizationId: org.organizationId });
		await fixture.assignLocation({
			organizationId: org.organizationId,
			employeeId: covered.employeeId,
			locationId: siteA,
		});
		await closeFor(org, { kind: "location", locationId: siteA });

		await fixture.unassignLocation({ employeeId: covered.employeeId, locationId: siteA });
		await fixture.setUserTimezone(covered.userId, "Pacific/Auckland");
		await fixture.setEmployeeTeam(covered.employeeId, teamA);
		await fixture.assignLocation({
			organizationId: org.organizationId,
			employeeId: later.employeeId,
			locationId: siteA,
		});

		const [range] = await closedRangesForEmployee(fixture.db, {
			organizationId: org.organizationId,
			employeeId: covered.employeeId,
		});
		expect([range.start.toString(), range.endExclusive.toString()]).toEqual([
			"2026-02-28T23:00:00Z",
			"2026-03-31T22:00:00Z",
		]);
		// A new assignment alone does not close the month; another explicit close does.
		expect(await isOpen(org.organizationId, later.employeeId)).toBe(true);
		expect(await closeFor(org, { kind: "location", locationId: siteA })).toMatchObject({
			kind: "closed",
			employeeIds: [later.employeeId],
		});
	});

	it("covers only employees still open when a second location closes, without replacing ranges", async () => {
		const org = await fixture.organization("UTC");
		const siteA = await site(org.organizationId, org.ownerUserId, "A");
		const siteB = await site(org.organizationId, org.ownerUserId, "B");
		const both = await fixture.employee({ organizationId: org.organizationId });
		const onlyB = await fixture.employee({ organizationId: org.organizationId });
		for (const [employeeId, locationId] of [
			[both.employeeId, siteA],
			[both.employeeId, siteB],
			[onlyB.employeeId, siteB],
		]) {
			await fixture.assignLocation({ organizationId: org.organizationId, employeeId, locationId });
		}
		const closeA = await closeFor(org, { kind: "location", locationId: siteA });
		if (closeA.kind !== "closed") throw new Error(`A was not closed: ${closeA.kind}`);

		const closeB = await closeFor(org, { kind: "location", locationId: siteB });

		expect(closeB).toMatchObject({ kind: "closed", employeeIds: [onlyB.employeeId] });
		const rows = await fixture.pool.query<{ closed_month_id: string }>(
			"select closed_month_id from closed_month_employee where employee_id = $1",
			[both.employeeId],
		);
		expect(rows.rows).toEqual([{ closed_month_id: closeA.closedMonthId }]);
		expect(await closeFor(org, { kind: "location", locationId: siteB })).toEqual({
			kind: "nothing_to_close",
			month: "2026-03",
		});
	});

	it("is blocked by a covered employee's pending work, whatever the site, and only theirs", async () => {
		const org = await fixture.organization("UTC");
		const siteA = await site(org.organizationId, org.ownerUserId);
		const covered = await fixture.employee({ organizationId: org.organizationId });
		const elsewhere = await fixture.employee({ organizationId: org.organizationId });
		await fixture.assignLocation({
			organizationId: org.organizationId,
			employeeId: covered.employeeId,
			locationId: siteA,
		});
		// Work rows carry no site: a covered employee's pending request blocks the whole month.
		const pending = await fixture.work({
			organizationId: org.organizationId,
			employeeId: covered.employeeId,
			userId: covered.userId,
			start: "2026-03-05T08:00:00Z",
			end: "2026-03-05T12:00:00Z",
			approvalStatus: "pending",
		});
		await fixture.work({
			organizationId: org.organizationId,
			employeeId: elsewhere.employeeId,
			userId: elsewhere.userId,
			start: "2026-03-31T20:00:00Z",
			end: null,
		});

		const result = await closeFor(org, { kind: "location", locationId: siteA });

		expect(result).toEqual({
			kind: "blocked",
			month: "2026-03",
			blockers: [
				expect.objectContaining({ kind: "time_request", workPeriodId: pending.workPeriodId }),
			],
		});
		expect(await isOpen(org.organizationId, covered.employeeId)).toBe(true);
	});

	it("refuses another organization's or a missing location without closing anything", async () => {
		const org = await fixture.organization("UTC");
		const other = await fixture.organization("UTC");
		const foreignSite = await site(other.organizationId, other.ownerUserId);
		const stranger = await fixture.employee({ organizationId: other.organizationId });
		await fixture.assignLocation({
			organizationId: other.organizationId,
			employeeId: stranger.employeeId,
			locationId: foreignSite,
		});

		expect(await closeFor(org, { kind: "location", locationId: foreignSite })).toEqual({
			kind: "location_not_found",
		});
		expect(
			await closeFor(org, { kind: "location", locationId: "00000000-0000-4000-8000-000000000000" }),
		).toEqual({ kind: "location_not_found" });
		expect(await isOpen(other.organizationId, stranger.employeeId)).toBe(true);
		const closes = await fixture.pool.query(
			"select id from closed_month where organization_id = any($1)",
			[[org.organizationId, other.organizationId]],
		);
		expect(closes.rows).toEqual([]);
	});

	it("records the location and covered employees in history and audit, after the location is gone", async () => {
		const org = await fixture.organization("UTC");
		const siteA = await site(org.organizationId, org.ownerUserId, "Depot");
		const covered = await fixture.employee({ organizationId: org.organizationId });
		await fixture.assignLocation({
			organizationId: org.organizationId,
			employeeId: covered.employeeId,
			locationId: siteA,
		});
		const [{ name }] = (
			await fixture.pool.query<{ name: string }>("select name from location where id = $1", [siteA])
		).rows;
		const result = await closeFor(org, { kind: "location", locationId: siteA });

		await fixture.pool.query("delete from location where id = $1", [siteA]);

		const [entry] = await closedMonthHistory(fixture.db, { organizationId: org.organizationId });
		expect(entry).toMatchObject({
			kind: "close",
			id: result.kind === "closed" ? result.closedMonthId : null,
			scope: "location",
			locationId: siteA,
			locationName: name,
			employeeCount: 1,
		});
		const audit = await fixture.pool.query<{ metadata: string }>(
			"select metadata from audit_log where organization_id = $1 and entity_type = 'closed_month'",
			[org.organizationId],
		);
		expect(JSON.parse(audit.rows[0].metadata)).toMatchObject({
			month: "2026-03",
			scope: { kind: "location", locationId: siteA },
			locationName: name,
			employeeIds: [covered.employeeId],
		});
		expect(await isOpen(org.organizationId, covered.employeeId)).toBe(false);
	});

	it("reopens location closes by employee, recorded team or everything, leaving no second lock", async () => {
		const org = await fixture.organization("UTC");
		const siteA = await site(org.organizationId, org.ownerUserId, "A");
		const siteB = await site(org.organizationId, org.ownerUserId, "B");
		const teamA = await fixture.team(org.organizationId, "A");
		const both = await fixture.employee({ organizationId: org.organizationId });
		const inTeam = await fixture.employee({ organizationId: org.organizationId, teamId: teamA });
		const onlyB = await fixture.employee({ organizationId: org.organizationId });
		for (const [employeeId, locationId] of [
			[both.employeeId, siteA],
			[both.employeeId, siteB],
			[inTeam.employeeId, siteA],
			[onlyB.employeeId, siteB],
		]) {
			await fixture.assignLocation({ organizationId: org.organizationId, employeeId, locationId });
		}
		await closeFor(org, { kind: "location", locationId: siteA });
		await closeFor(org, { kind: "location", locationId: siteB });
		const reopen = (scope: Parameters<typeof reopenMonth>[1]["scope"]) =>
			reopenMonth(fixture.db, {
				organizationId: org.organizationId,
				month: "2026-03",
				scope,
				reason: "Correction",
				actorUserId: org.ownerUserId,
			});

		expect(await reopen({ kind: "employees", employeeIds: [both.employeeId] })).toMatchObject({
			kind: "reopened",
			employeeIds: [both.employeeId],
		});
		expect(await isOpen(org.organizationId, both.employeeId)).toBe(true);

		expect(await reopen({ kind: "team", teamId: teamA })).toMatchObject({
			kind: "reopened",
			employeeIds: [inTeam.employeeId],
		});
		expect(await isOpen(org.organizationId, inTeam.employeeId)).toBe(true);
		expect(await isOpen(org.organizationId, onlyB.employeeId)).toBe(false);

		expect(await reopen({ kind: "all" })).toMatchObject({
			kind: "reopened",
			employeeIds: [onlyB.employeeId],
		});
		expect(await isOpen(org.organizationId, onlyB.employeeId)).toBe(true);
	});

	it("has nothing to close for a location without assigned employees", async () => {
		const org = await fixture.organization("UTC");
		const empty = await site(org.organizationId, org.ownerUserId);

		expect(await closeFor(org, { kind: "location", locationId: empty })).toEqual({
			kind: "nothing_to_close",
			month: "2026-03",
		});
	});
});
