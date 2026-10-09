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
