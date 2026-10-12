/** #763 slice 6: the key request log's recent requests and 90-day retention on PostgreSQL. */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { db } = await import("@/db");
const { deleteExpiredKeyRequests, listRecentKeyRequests } = await import("./request-log");

const ids = { organization: "t763l-org", other: "t763l-other-org" } as const;
const now = Temporal.Instant.from("2026-10-10T12:00:00Z");

describe("the key request log on PostgreSQL", () => {
	const admin = integrationAdminPool();

	async function cleanup() {
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
	}

	async function request(
		organizationId: string,
		apiKeyId: string,
		requestedAt: string,
		status = 200,
	) {
		await admin.query(
			`insert into public_api_request_log (organization_id, api_key_id, method, route, status,
			   row_count, ip_address, requested_at)
			 values ($1, $2, 'GET', '/api/v1/employees', $3, 1, '203.0.113.7', $4)`,
			[organizationId, apiKeyId, status, requestedAt],
		);
	}

	beforeEach(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T763L', $1, now()), ($2, 'T763L other', $2, now())`,
			[ids.organization, ids.other],
		);
	});
	afterAll(cleanup);

	it("lists one key's requests of its organization, newest first", async () => {
		await request(ids.organization, "key-a", "2026-10-09T08:00:00Z");
		await request(ids.organization, "key-a", "2026-10-10T08:00:00Z", 429);
		await request(ids.organization, "key-b", "2026-10-10T09:00:00Z");
		await request(ids.other, "key-a", "2026-10-10T10:00:00Z");

		const rows = await listRecentKeyRequests(db, {
			organizationId: ids.organization,
			apiKeyId: "key-a",
		});
		expect(rows.map((row) => [row.requestedAt.toISOString(), row.status])).toEqual([
			["2026-10-10T08:00:00.000Z", 429],
			["2026-10-09T08:00:00.000Z", 200],
		]);
		expect(rows[0]).toMatchObject({
			method: "GET",
			route: "/api/v1/employees",
			rowCount: 1,
			ipAddress: "203.0.113.7",
		});
	});

	it("deletes entries older than 90 days in every organization, in batches", async () => {
		await request(ids.organization, "key-a", "2026-07-12T11:59:59Z");
		await request(ids.organization, "key-a", "2026-07-12T00:00:00Z");
		await request(ids.other, "key-z", "2026-01-01T00:00:00Z");
		await request(ids.organization, "key-a", "2026-07-12T12:00:00Z");
		await request(ids.organization, "key-a", "2026-10-01T00:00:00Z");

		expect(await deleteExpiredKeyRequests(db, { now, batchSize: 2 })).toBe(3);
		const { rows } = await admin.query<{ requested_at: Date }>(
			`select requested_at from public_api_request_log
			 where organization_id = any($1::text[]) order by requested_at`,
			[[ids.organization, ids.other]],
		);
		expect(rows.map((row) => row.requested_at.toISOString())).toEqual([
			"2026-07-12T12:00:00.000Z",
			"2026-10-01T00:00:00.000Z",
		]);
	});
});
