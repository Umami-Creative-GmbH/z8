/**
 * PostgreSQL contract for the statistics KPI reads (#1938): work clipped to the
 * window, live work, manual entry share, roster movement and users signed in.
 */
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { timeEntry, timeRecord, timeRecordWork, workPeriod } from "@/db/schema";
import { dateFromInstant, parseInstant } from "@/lib/datetime/temporal-core";
import { DatabaseService, makeDatabaseService } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { comparisonWindowsAt } from "./comparison-windows";
import {
	completedWorkPeriods,
	countClockedIn,
	countIncompleteSetup,
	countStaleLiveWork,
	countUsersSignedIn,
	manualEntryShare,
	rosterMovement,
	type StatisticsScope,
	workedMinutes,
} from "./statistics-reads";

// Thursday Nov 5, 12:00 UTC; the organization counts in UTC.
const NOW = parseInstant("2026-11-05T12:00:00Z");
const windows = comparisonWindowsAt(NOW, "UTC");

describe("statistics reads", () => {
	let fixture: LifecycleDatabaseFixture;
	let scope: StatisticsScope;
	let otherOrganizationId: string;

	const run = <A, E>(effect: Effect.Effect<A, E, DatabaseService>) =>
		Effect.runPromise(
			Effect.provideService(effect, DatabaseService, makeDatabaseService(fixture.db as never)),
		);

	async function work(
		target: SeededEmployee & { organizationId?: string },
		input: { start: string; end?: string; origin?: "clock" | "manual"; deleted?: boolean },
	) {
		const organizationId = target.organizationId ?? fixture.organizationId;
		const start = dateFromInstant(parseInstant(input.start));
		const end = input.end ? dateFromInstant(parseInstant(input.end)) : null;
		const entry = (type: "clock_in" | "clock_out", timestamp: Date) => ({
			organizationId,
			employeeId: target.employeeId,
			type,
			timestamp,
			utcOffsetMinutes: 0,
			timezone: "UTC",
			timezoneSource: "backfill",
			hash: randomUUID(),
			createdBy: fixture.ownerUserId,
		});
		const entries = await fixture.db
			.insert(timeEntry)
			.values(
				end ? [entry("clock_in", start), entry("clock_out", end)] : [entry("clock_in", start)],
			)
			.returning({ id: timeEntry.id, type: timeEntry.type });
		const clockIn = entries.find((row) => row.type === "clock_in");
		const clockOut = entries.find((row) => row.type === "clock_out");
		let recordId: string | null = null;
		if (end) {
			recordId = randomUUID();
			await fixture.db.insert(timeRecord).values({
				id: recordId,
				organizationId,
				employeeId: target.employeeId,
				recordKind: "work",
				startAt: start,
				endAt: end,
				durationMinutes: Math.round((end.getTime() - start.getTime()) / 60_000),
				approvalState: "approved",
				origin: input.origin ?? "clock",
				createdBy: fixture.ownerUserId,
			});
			await fixture.db.insert(timeRecordWork).values({ recordId, organizationId });
		}
		await fixture.db.insert(workPeriod).values({
			organizationId,
			employeeId: target.employeeId,
			clockInId: clockIn?.id ?? "",
			clockOutId: clockOut?.id ?? null,
			startTime: start,
			endTime: end,
			durationMinutes: end ? Math.round((end.getTime() - start.getTime()) / 60_000) : null,
			isActive: !end,
			approvalStatus: "approved",
			canonicalRecordId: recordId,
			deletedAt: input.deleted ? end : null,
		});
	}

	async function created(target: SeededEmployee, at: string) {
		await fixture.pool.query("update employee set created_at = $2 where id = $1", [
			target.employeeId,
			at,
		]);
	}

	async function deactivation(
		target: SeededEmployee,
		input: { deactivatedAt: string; reactivatedAt?: string },
	) {
		await fixture.pool.query(
			`insert into employee_deactivation
			 (organization_id, employee_id, deactivated_at, created_by, reason, status,
			  request_id, request_fingerprint, reactivated_at)
			 values ($1, $2, $3, $4, 'employee_deactivated', 'applied', gen_random_uuid(), 'test', $5)`,
			[
				fixture.organizationId,
				target.employeeId,
				input.deactivatedAt,
				fixture.ownerUserId,
				input.reactivatedAt ?? null,
			],
		);
	}

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query("update organization set timezone = 'UTC' where id = $1", [
			fixture.organizationId,
		]);
		// Everyone seeded below existed long before this month unless a test says otherwise.
		await fixture.pool.query(
			"update employee set created_at = '2026-01-01T00:00:00Z' where organization_id = $1",
			[fixture.organizationId],
		);
		scope = { organizationWide: true, organizationId: fixture.organizationId };
		otherOrganizationId = await fixture.createOrganization();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	describe("work", () => {
		beforeAll(async () => {
			const worker = await fixture.seedEmployee();
			const liveToday = await fixture.seedEmployee();
			const liveForDays = await fixture.seedEmployee();
			const elsewhere = await fixture.seedEmployee({ organizationId: otherOrganizationId });

			// Crosses the month start: only Nov 1, 00:00–02:00 counts this month.
			await work(worker, { start: "2026-10-31T22:00:00Z", end: "2026-11-01T02:00:00Z" });
			// Inside the comparison window (Oct 1–5, until 12:00).
			await work(worker, {
				start: "2026-10-03T08:00:00Z",
				end: "2026-10-03T10:00:00Z",
				origin: "manual",
			});
			// After the comparison window's end on Oct 5: not compared.
			await work(worker, { start: "2026-10-05T13:00:00Z", end: "2026-10-05T15:00:00Z" });
			await work(worker, {
				start: "2026-11-02T08:00:00Z",
				end: "2026-11-02T10:00:00Z",
				origin: "manual",
			});
			// Deleted work never counts.
			await work(worker, {
				start: "2026-11-04T08:00:00Z",
				end: "2026-11-04T11:00:00Z",
				deleted: true,
			});
			// Live work counts up to now: 3 h, and 52 h for work started on Nov 3.
			await work(liveToday, { start: "2026-11-05T09:00:00Z" });
			await work(liveForDays, { start: "2026-11-03T08:00:00Z" });
			// Another organization's work never counts.
			await work(
				{ ...elsewhere, organizationId: otherOrganizationId },
				{ start: "2026-11-02T08:00:00Z", end: "2026-11-02T18:00:00Z" },
			);
		});

		it("counts only the part of work inside each window, and live work up to now", async () => {
			await expect(run(workedMinutes(scope, windows))).resolves.toEqual({
				current: 120 + 120 + 180 + 52 * 60,
				previous: 120,
			});
		});

		it("counts work periods completed inside each window", async () => {
			await expect(run(completedWorkPeriods(scope, windows))).resolves.toEqual({
				current: 2,
				previous: 1,
			});
		});

		it("measures the manual entry share in completed hours this month", async () => {
			await expect(run(manualEntryShare(scope, windows.current))).resolves.toEqual({
				manualMinutes: 120,
				totalMinutes: 240,
			});
		});

		it("counts employees with live work, and those clocked in for more than 24 hours", async () => {
			await expect(run(countClockedIn(scope))).resolves.toBe(2);
			await expect(run(countStaleLiveWork(scope, NOW))).resolves.toBe(1);
		});
	});

	describe("roster", () => {
		let movement: { roster: number; joined: number; left: number };
		let rosterBefore: number;

		beforeAll(async () => {
			// Everyone seeded so far existed before this month and stays on the roster.
			await fixture.pool.query(
				"update employee set created_at = '2026-01-01T00:00:00Z' where organization_id = $1",
				[fixture.organizationId],
			);
			const before = await run(rosterMovement(scope, windows.current));
			expect(before).toMatchObject({ joined: 0, left: 0 });
			rosterBefore = before.roster;

			const joined = await fixture.seedEmployee();
			await created(joined, "2026-11-03T09:00:00Z");

			const left = await fixture.seedEmployee();
			await created(left, "2026-01-01T00:00:00Z");
			await fixture.pool.query("update employee set is_active = false where id = $1", [
				left.employeeId,
			]);
			await fixture.pool.query("update employee set deactivated_at = $2 where id = $1", [
				left.employeeId,
				"2026-11-02T10:00:00Z",
			]);
			await deactivation(left, { deactivatedAt: "2026-11-02T10:00:00Z" });

			// Switched off on Nov 3 and back on Nov 4: on the roster at both ends of the window.
			const bounced = await fixture.seedEmployee();
			await created(bounced, "2026-01-01T00:00:00Z");
			await deactivation(bounced, {
				deactivatedAt: "2026-11-03T10:00:00Z",
				reactivatedAt: "2026-11-04T10:00:00Z",
			});

			// Off since October, back on Nov 4: joined this month.
			const returned = await fixture.seedEmployee();
			await created(returned, "2026-01-01T00:00:00Z");
			await deactivation(returned, {
				deactivatedAt: "2026-10-20T10:00:00Z",
				reactivatedAt: "2026-11-04T10:00:00Z",
			});

			// Left in October: in neither count.
			const leftEarlier = await fixture.seedEmployee();
			await created(leftEarlier, "2026-01-01T00:00:00Z");
			await fixture.pool.query("update employee set is_active = false where id = $1", [
				leftEarlier.employeeId,
			]);
			await fixture.pool.query("update employee set deactivated_at = $2 where id = $1", [
				leftEarlier.employeeId,
				"2026-10-15T10:00:00Z",
			]);

			movement = await run(rosterMovement(scope, windows.current));
		});

		it("counts who is on the roster now", () => {
			// joined, bounced and returned are on it; left and leftEarlier are not.
			expect(movement.roster).toBe(rosterBefore + 3);
		});

		it("counts who joined and who left since the start of the month", () => {
			expect(movement.joined).toBe(1 + 1);
			expect(movement.left).toBe(1);
		});

		it("counts employees on the roster with no team or work policy as incomplete setup", async () => {
			// No seeded employee has a primary team or a work policy.
			await expect(run(countIncompleteSetup(scope, NOW))).resolves.toBe(movement.roster);
		});
	});

	describe("users signed in", () => {
		it("counts distinct users with an unexpired session in this organization", async () => {
			const twice = await fixture.seedEmployee();
			const expired = await fixture.seedEmployee();
			// A session's active organization must be one its user belongs to.
			const elsewhere = await fixture.seedEmployee({ organizationId: otherOrganizationId });
			const session = async (userId: string, organizationId: string, expiresAt: string) =>
				fixture.pool.query(
					`insert into session (id, expires_at, token, created_at, updated_at, user_id, active_organization_id)
					 values ($1, $2, $3, now(), now(), $4, $5)`,
					[randomUUID(), expiresAt, randomUUID(), userId, organizationId],
				);
			await session(twice.userId, fixture.organizationId, "2026-11-06T00:00:00Z");
			await session(twice.userId, fixture.organizationId, "2026-11-07T00:00:00Z");
			await session(expired.userId, fixture.organizationId, "2026-11-05T11:00:00Z");
			await session(elsewhere.userId, otherOrganizationId, "2026-11-06T00:00:00Z");

			await expect(run(countUsersSignedIn(fixture.organizationId, NOW))).resolves.toBe(1);
		});
	});
});
