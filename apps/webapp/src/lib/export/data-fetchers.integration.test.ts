/**
 * #794: the organization data export leaves out work periods deleted by an
 * approved deletion correction. Running periods stay: the export is a record
 * export and carries `isActive`. Runs against PostgreSQL.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { fetchWorkPeriods, streamWorkPeriods } = await import("./data-fetchers");

const ids = {
	organization: "t794-data-export-org",
	user: "t794-data-export-user",
	employee: "d7940000-0000-4000-8000-000000000021",
} as const;

describe("work period data export on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from work_period where organization_id = $1", [ids.organization]);
		await admin.query("delete from time_entry where organization_id = $1", [ids.organization]);
		await admin.query("delete from organization where id = $1", [ids.organization]);
		await admin.query('delete from "user" where id = $1', [ids.user]);
	}

	async function workPeriod(options: {
		start: string;
		end?: string;
		minutes?: number;
		deleted?: boolean;
	}): Promise<string> {
		const id = randomUUID();
		const clockInId = randomUUID();
		await admin.query(
			`insert into time_entry
			 (id, employee_id, organization_id, type, timestamp, utc_offset_minutes, timezone, timezone_source, hash, created_by)
			 values ($1, $2, $3, 'clock_in', $4, 0, 'UTC', 'user_setting', $6, $5)`,
			[clockInId, ids.employee, ids.organization, options.start, ids.user, clockInId],
		);
		await admin.query(
			`insert into work_period
			 (id, employee_id, organization_id, clock_in_id, start_time, end_time,
			  duration_minutes, is_active, deleted_at, deleted_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
			[
				id,
				ids.employee,
				ids.organization,
				clockInId,
				options.start,
				options.end ?? null,
				options.minutes ?? null,
				!options.end,
				options.deleted ? "2026-04-01T00:00:00Z" : null,
				options.deleted ? ids.user : null,
			],
		);
		return id;
	}

	let completed: string;
	let running: string;

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T794 data export', $1, 'UTC', now())`,
			[ids.organization],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, $1, 't794-data-export@example.test', now(), now())`,
			[ids.user],
		);
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $2, $3, 'employee', now())`,
			[ids.employee, ids.user, ids.organization],
		);
		completed = await workPeriod({
			start: "2026-03-10T08:00:00Z",
			end: "2026-03-10T10:00:00Z",
			minutes: 120,
		});
		await workPeriod({
			start: "2026-03-11T08:00:00Z",
			end: "2026-03-11T11:00:00Z",
			minutes: 180,
			deleted: true,
		});
		running = await workPeriod({ start: "2026-03-12T08:00:00Z" });
	});
	afterAll(cleanup);

	it("exports completed and running work periods but not deleted ones", async () => {
		const exported = await fetchWorkPeriods(ids.organization);

		expect(exported.map((period) => period.id).sort()).toEqual([completed, running].sort());
	});

	it("streams completed and running work periods but not deleted ones", async () => {
		const streamed: string[] = [];
		for await (const batch of streamWorkPeriods(ids.organization, [ids.employee])) {
			streamed.push(...batch.map((period) => period.id));
		}

		expect(streamed.sort()).toEqual([completed, running].sort());
	});
});
