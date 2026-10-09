/**
 * Spec #766 "Retention": consent records and access-log entries hold no
 * position, so the stamp purge never touches them. They follow the audit-log
 * lifetime instead: access-log entries older than it are deleted, and consent
 * and decline records once they have been out of force for longer than it.
 * Notice versions stay. Runs on PostgreSQL against the real triggers.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import { integrationAdminPool } from "@/test/integration-database";

const { deletePositionRecordsPastAuditLifetime } = await import("./record-retention");
const { purgeExpiredPositionStamps } = await import("./purge");

const LIFETIME_DAYS = 365;

const ids = {
	organizationA: "tret-org-a",
	organizationB: "tret-org-b",
	users: ["tret-user-1", "tret-user-2", "tret-user-3", "tret-user-4", "tret-user-5"],
	employees: [
		"e7e70000-0000-4000-8000-000000000001",
		"e7e70000-0000-4000-8000-000000000002",
		"e7e70000-0000-4000-8000-000000000003",
		"e7e70000-0000-4000-8000-000000000004",
		"e7e70000-0000-4000-8000-000000000005",
	],
} as const;

describe("position record retention on PostgreSQL", () => {
	const pool = integrationAdminPool();
	let now: Instant;

	function daysAgo(days: number, extraMilliseconds = 0): string {
		return now
			.subtract({ hours: days * 24 })
			.add({ milliseconds: extraMilliseconds })
			.toString();
	}

	async function cleanup() {
		await pool.query("delete from organization where id in ($1, $2)", [
			ids.organizationA,
			ids.organizationB,
		]);
		await pool.query('delete from "user" where id = any($1::text[])', [ids.users]);
	}

	async function seed() {
		const at = "2024-01-01T00:00:00Z";
		await pool.query(
			`insert into organization (id, name, slug, created_at) values ($1, $1, $1, $3), ($2, $2, $2, $3)`,
			[ids.organizationA, ids.organizationB, at],
		);
		await pool.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', $2, $2 from unnest($1::text[]) as user_id`,
			[ids.users, at],
		);
		for (const [index, employeeId] of ids.employees.entries()) {
			// The last employee belongs to organization B.
			const organizationId = index === 4 ? ids.organizationB : ids.organizationA;
			await pool.query(
				`insert into employee (id, user_id, organization_id, role, updated_at)
				 values ($1, $2, $3, 'employee', $4)`,
				[employeeId, ids.users[index], organizationId, at],
			);
		}
	}

	async function logAccess(organizationId: string, accessedAt: string, subjects: string[]) {
		const id = randomUUID();
		await pool.query(
			`insert into position_stamp_access_log (id, organization_id, viewer_user_id, kind, work_period_ids, accessed_at)
			 values ($1, $2, $3, 'work_period_detail', array[$4::uuid], $5)`,
			[id, organizationId, ids.users[0], randomUUID(), accessedAt],
		);
		for (const employeeId of subjects) {
			await pool.query(
				`insert into position_stamp_access_log_subject (access_log_id, organization_id, employee_id)
				 values ($1, $2, $3)`,
				[id, organizationId, employeeId],
			);
		}
		return id;
	}

	async function publishNotice(organizationId: string, version: number, createdAt: string) {
		const id = randomUUID();
		await pool.query(
			`insert into position_notice (id, organization_id, version, purpose_statement, retention_days, template_revision, created_at)
			 values ($1, $2, $3, 'Proof of on-site work', 30, 1, $4)`,
			[id, organizationId, version, createdAt],
		);
		return id;
	}

	async function consent(
		organizationId: string,
		employeeId: string,
		noticeId: string,
		grantedAt: string,
		withdrawnAt: string | null = null,
	) {
		const id = randomUUID();
		await pool.query(
			`insert into position_consent (id, organization_id, employee_id, notice_id, granted_at, withdrawn_at)
			 values ($1, $2, $3, $4, $5, $6)`,
			[id, organizationId, employeeId, noticeId, grantedAt, withdrawnAt],
		);
		return id;
	}

	async function decline(
		organizationId: string,
		employeeId: string,
		noticeId: string,
		declinedAt: string,
	) {
		const id = randomUUID();
		await pool.query(
			`insert into position_notice_decline (id, organization_id, employee_id, notice_id, declined_at)
			 values ($1, $2, $3, $4, $5)`,
			[id, organizationId, employeeId, noticeId, declinedAt],
		);
		return id;
	}

	async function remainingConsents() {
		const { rows } = await pool.query<{ id: string }>(
			"select id from position_consent where organization_id in ($1, $2) order by id",
			[ids.organizationA, ids.organizationB],
		);
		return rows.map((row) => row.id);
	}

	async function accessLogIds() {
		const { rows } = await pool.query<{ id: string }>(
			"select id from position_stamp_access_log where organization_id in ($1, $2) order by id",
			[ids.organizationA, ids.organizationB],
		);
		return rows.map((row) => row.id);
	}

	async function subjectLogIds() {
		const { rows } = await pool.query<{ access_log_id: string }>(
			`select distinct access_log_id from position_stamp_access_log_subject
			  where organization_id in ($1, $2) order by access_log_id`,
			[ids.organizationA, ids.organizationB],
		);
		return rows.map((row) => row.access_log_id);
	}

	beforeEach(async () => {
		now = systemClock.nowInstant().round({ smallestUnit: "millisecond", roundingMode: "floor" });
		await cleanup();
		await seed();
	});

	afterAll(async () => {
		await cleanup();
	});

	it("deletes access-log entries older than the audit-log lifetime, with their subjects, in every organization", async () => {
		const [e1, e2, , , e5] = ids.employees;
		const old = await logAccess(ids.organizationA, daysAgo(400), [e1, e2]);
		const justPast = await logAccess(ids.organizationA, daysAgo(LIFETIME_DAYS, -1), [e1]);
		const atCutoff = await logAccess(ids.organizationA, daysAgo(LIFETIME_DAYS), [e1]);
		const recent = await logAccess(ids.organizationA, daysAgo(30), [e2]);
		const otherOrganization = await logAccess(ids.organizationB, daysAgo(500), [e5]);

		const result = await deletePositionRecordsPastAuditLifetime(db, {
			now,
			lifetimeDays: LIFETIME_DAYS,
		});

		expect(result.accessLogEntries).toBe(3);
		const kept = [atCutoff, recent].sort();
		expect(await accessLogIds()).toEqual(kept);
		expect(await subjectLogIds()).toEqual(kept);
		expect([old, justPast, otherOrganization].some((id) => kept.includes(id))).toBe(false);
	});

	it("deletes consents out of force (withdrawn or lapsed) for longer than the lifetime, and never one in force", async () => {
		const [e1, e2, e3, e4, e5] = ids.employees;
		const a = ids.organizationA;
		// Organization A: version 2 lapsed version 1 400 days ago, version 3 (current) lapsed version 2 100 days ago.
		const v1 = await publishNotice(a, 1, daysAgo(900));
		const v2 = await publishNotice(a, 2, daysAgo(400));
		const v3 = await publishNotice(a, 3, daysAgo(100));
		const lapsedLongAgo = await consent(a, e1, v1, daysAgo(800));
		const lapsedRecently = await consent(a, e1, v2, daysAgo(390));
		const withdrawnLongAgo = await consent(a, e2, v1, daysAgo(850), daysAgo(820));
		const active = await consent(a, e2, v3, daysAgo(90));
		const withdrawnBeforeLapse = await consent(a, e3, v2, daysAgo(395), daysAgo(380));
		const withdrawnRecently = await consent(a, e4, v2, daysAgo(395), daysAgo(300));
		// Organization B's only notice is still current after 700 days.
		const b = ids.organizationB;
		const current = await publishNotice(b, 1, daysAgo(700));
		const withdrawnThenRegranted = await consent(b, e5, current, daysAgo(690), daysAgo(600));
		const regranted = await consent(b, e5, current, daysAgo(550));

		const result = await deletePositionRecordsPastAuditLifetime(db, {
			now,
			lifetimeDays: LIFETIME_DAYS,
		});

		expect(result.consents).toBe(4);
		const remaining = await remainingConsents();
		expect(remaining).toEqual([lapsedRecently, active, withdrawnRecently, regranted].sort());
		for (const deleted of [
			lapsedLongAgo,
			withdrawnLongAgo,
			withdrawnBeforeLapse,
			withdrawnThenRegranted,
		]) {
			expect(remaining).not.toContain(deleted);
		}
		// Notice versions stay: they are the works council's history.
		const { rows: notices } = await pool.query(
			"select id from position_notice where organization_id in ($1, $2)",
			[a, b],
		);
		expect(notices).toHaveLength(4);
	});

	it("keeps an employee's latest answer to the current notice, even a withdrawal older than the lifetime", async () => {
		const [e1, e2] = ids.employees;
		const a = ids.organizationA;
		const current = await publishNotice(a, 1, daysAgo(900));
		const standingWithdrawal = await consent(a, e1, current, daysAgo(800), daysAgo(700));
		const earlierWithdrawal = await consent(a, e2, current, daysAgo(850), daysAgo(800));
		const laterWithdrawal = await consent(a, e2, current, daysAgo(600), daysAgo(500));

		const result = await deletePositionRecordsPastAuditLifetime(db, {
			now,
			lifetimeDays: LIFETIME_DAYS,
		});

		expect(result.consents).toBe(1);
		expect(await remainingConsents()).toEqual([standingWithdrawal, laterWithdrawal].sort());
		expect(await remainingConsents()).not.toContain(earlierWithdrawal);
	});

	it("keeps a consent while a stamp captured under it remains, so it never deletes a position", async () => {
		const [e1] = ids.employees;
		const a = ids.organizationA;
		const v1 = await publishNotice(a, 1, daysAgo(900));
		await publishNotice(a, 2, daysAgo(400));
		const lapsed = await consent(a, e1, v1, daysAgo(800));
		const { rows } = await pool.query<{ id: string }>(
			`insert into time_entry (employee_id, organization_id, type, timestamp, utc_offset_minutes,
				timezone_source, hash, created_by)
			 values ($1, $2, 'clock_in', $3, 0, 'test', md5(random()::text), $4) returning id`,
			[e1, a, daysAgo(500), ids.users[0]],
		);
		// Past its purge date, but the daily purge has not run yet.
		await pool.query(
			`insert into position_stamp (organization_id, employee_id, time_entry_id, consent_id, latitude,
				longitude, accuracy_meters, fixed_at, captured_at, purge_at)
			 values ($1, $2, $3, $4, 52.52, 13.405, 15, $5, $5, $6)`,
			[a, e1, rows[0]?.id, lapsed, daysAgo(500), daysAgo(470)],
		);

		const first = await deletePositionRecordsPastAuditLifetime(db, {
			now,
			lifetimeDays: LIFETIME_DAYS,
		});
		expect(first.consents).toBe(0);
		const { rows: stamps } = await pool.query(
			"select id from position_stamp where organization_id = $1",
			[a],
		);
		expect(stamps).toHaveLength(1);

		await purgeExpiredPositionStamps(db, { now });
		const second = await deletePositionRecordsPastAuditLifetime(db, {
			now,
			lifetimeDays: LIFETIME_DAYS,
		});
		expect(second.consents).toBe(1);
		expect(await remainingConsents()).toEqual([]);
	});

	it("deletes declines of notices superseded for longer than the lifetime, and keeps declines of the current notice", async () => {
		const [e1, e2, e3, , e5] = ids.employees;
		const a = ids.organizationA;
		const v1 = await publishNotice(a, 1, daysAgo(900));
		const v2 = await publishNotice(a, 2, daysAgo(400));
		const v3 = await publishNotice(a, 3, daysAgo(100));
		const supersededLongAgo = await decline(a, e1, v1, daysAgo(850));
		const supersededRecently = await decline(a, e1, v2, daysAgo(395));
		const current = await decline(a, e2, v3, daysAgo(50));
		const b = ids.organizationB;
		const currentForYears = await decline(b, e5, await publishNotice(b, 1, daysAgo(700)), daysAgo(650));
		await decline(a, e3, v1, daysAgo(890));

		const result = await deletePositionRecordsPastAuditLifetime(db, {
			now,
			lifetimeDays: LIFETIME_DAYS,
		});

		expect(result.declines).toBe(2);
		const { rows } = await pool.query<{ id: string }>(
			"select id from position_notice_decline where organization_id in ($1, $2) order by id",
			[a, b],
		);
		expect(rows.map((row) => row.id)).toEqual(
			[supersededRecently, current, currentForYears].sort(),
		);
		expect(rows.map((row) => row.id)).not.toContain(supersededLongAgo);
	});

	it("is idempotent: a repeated run deletes nothing more", async () => {
		const [e1, e2] = ids.employees;
		const a = ids.organizationA;
		const v1 = await publishNotice(a, 1, daysAgo(900));
		await publishNotice(a, 2, daysAgo(400));
		await consent(a, e1, v1, daysAgo(800));
		await decline(a, e2, v1, daysAgo(800));
		await logAccess(a, daysAgo(400), [e1]);

		const input = { now, lifetimeDays: LIFETIME_DAYS };
		expect(await deletePositionRecordsPastAuditLifetime(db, input)).toEqual({
			accessLogEntries: 1,
			consents: 1,
			declines: 1,
		});
		expect(await deletePositionRecordsPastAuditLifetime(db, input)).toEqual({
			accessLogEntries: 0,
			consents: 0,
			declines: 0,
		});
	});

	it("refuses every other delete of access-log entries, but lets organization and employee deletion cascade", async () => {
		const [e1, e2] = ids.employees;
		const recent = await logAccess(ids.organizationA, daysAgo(30), [e1, e2]);
		await logAccess(ids.organizationA, daysAgo(40), [e2]);

		await expect(
			pool.query("delete from position_stamp_access_log where id = $1", [recent]),
		).rejects.toThrow(/append-only/);
		await expect(
			pool.query("delete from position_stamp_access_log_subject where access_log_id = $1", [
				recent,
			]),
		).rejects.toThrow(/append-only/);

		// Deleting an employee removes them as a subject; the entries stay.
		await pool.query("delete from employee where id = $1", [e2]);
		expect(await accessLogIds()).toHaveLength(2);
		const { rows: subjects } = await pool.query<{ employee_id: string }>(
			"select employee_id from position_stamp_access_log_subject where organization_id = $1",
			[ids.organizationA],
		);
		expect(subjects).toEqual([{ employee_id: e1 }]);

		await pool.query("delete from organization where id = $1", [ids.organizationA]);
		expect(await accessLogIds()).toEqual([]);
		expect(await subjectLogIds()).toEqual([]);
	});
});
