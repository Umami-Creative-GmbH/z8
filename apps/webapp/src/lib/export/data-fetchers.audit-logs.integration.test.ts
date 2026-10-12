/**
 * #1045: the organization data export holds every audit row of the exported
 * organization and none of another, including rows that a member of both
 * organizations performed elsewhere. Runs against PostgreSQL.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { env } from "@/env";
import { integrationAdminPool } from "@/test/integration-database";

const { fetchAuditLogs, streamAuditLogs } = await import("./data-fetchers");

const ids = {
	organization: "t1045-audit-export-org",
	other: "t1045-audit-export-other-org",
	sharedUser: "t1045-audit-export-shared-user",
	sharedEmployee: "10450000-0000-4000-8000-000000000001",
	sharedOtherEmployee: "10450000-0000-4000-8000-000000000002",
} as const;

// One more row than a batch, so the export has to read past the first page.
const ownRows = Number(env.EXPORT_FETCH_BATCH_SIZE) + 1;

describe("audit log data export on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const admin = integrationAdminPool();
	let ownIds: string[];

	async function cleanup() {
		await admin.query("delete from audit_log where organization_id = any($1)", [
			[ids.organization, ids.other],
		]);
		await admin.query("delete from organization where id = any($1)", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = $1', [ids.sharedUser]);
	}

	async function insertAuditRows(options: {
		organizationId: string;
		count: number;
		entityType: string;
		entityId: string;
		start: string;
	}): Promise<string[]> {
		const { rows } = await admin.query<{ id: string }>(
			`insert into audit_log
			 (organization_id, entity_type, entity_id, action, performed_by, timestamp)
			 select $1, $2, $3, 'update', $4, $5::timestamp + make_interval(secs => n)
			 from generate_series(1, $6) as n
			 returning id`,
			[
				options.organizationId,
				options.entityType,
				options.entityId,
				ids.sharedUser,
				options.start,
				options.count,
			],
		);
		return rows.map((row) => row.id);
	}

	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, 'T1045 audit export', $1, 'UTC', now()),
			        ($2, 'T1045 other org', $2, 'UTC', now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 values ($1, $1, 't1045-audit-export@example.test', now(), now())`,
			[ids.sharedUser],
		);
		// The same user is a member of both organizations.
		await admin.query(
			`insert into employee (id, user_id, organization_id, role, updated_at)
			 values ($1, $3, $4, 'admin', now()), ($2, $3, $5, 'admin', now())`,
			[ids.sharedEmployee, ids.sharedOtherEmployee, ids.sharedUser, ids.organization, ids.other],
		);

		ownIds = await insertAuditRows({
			organizationId: ids.organization,
			count: ownRows,
			entityType: "employee",
			entityId: ids.sharedEmployee,
			start: "2026-01-01T00:00:00Z",
		});
		// The other organization's rows are all newer, performed by the shared
		// user, and some even name this organization's employee.
		await insertAuditRows({
			organizationId: ids.other,
			count: ownRows,
			entityType: "employee",
			entityId: ids.sharedOtherEmployee,
			start: "2026-06-01T00:00:00Z",
		});
		await insertAuditRows({
			organizationId: ids.other,
			count: 3,
			entityType: "employee",
			entityId: ids.sharedEmployee,
			start: "2026-07-01T00:00:00Z",
		});
	});
	afterAll(cleanup);

	it("exports every row of the organization and none of another", async () => {
		const exported = await fetchAuditLogs(ids.organization);

		expect(exported).toHaveLength(ownRows);
		expect(exported.map((log) => log.id).sort()).toEqual([...ownIds].sort());
		expect(exported[0].timestamp.getTime()).toBeGreaterThan(
			exported[exported.length - 1].timestamp.getTime(),
		);
	});

	it("streams every row of the organization and none of another", async () => {
		const streamed: string[] = [];
		let batches = 0;
		for await (const batch of streamAuditLogs(ids.organization)) {
			batches++;
			streamed.push(...batch.map((log) => log.id));
		}

		expect(batches).toBe(2);
		expect(streamed.sort()).toEqual([...ownIds].sort());
	});
});
