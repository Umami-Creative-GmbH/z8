/** #763 slice 4: GET /api/v1/work-periods on PostgreSQL. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import { callPublicApi, createTestKey, walkPublicApi } from "../testing/public-api-fixture";
import { listWorkPeriods } from "./work-periods";

const ids = {
	organization: "t763w-org",
	other: "t763w-other-org",
	admin: "t763w-admin",
	ana: "t763w-ana",
	otto: "t763w-otto",
} as const;
const users = [ids.admin, ids.ana, ids.otto];
const october = "?from=2026-10-01T00:00:00Z&to=2026-11-01T00:00:00Z";

describe("work periods in the Public API", () => {
	const admin = integrationAdminPool();
	let key: string;
	let ana: string;
	const periods: Record<string, string> = {};

	async function cleanup() {
		await admin.query("delete from apikey where reference_id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query("delete from organization where id = any($1::text[])", [
			[ids.organization, ids.other],
		]);
		await admin.query('delete from "user" where id = any($1::text[])', [users]);
	}

	async function entry(
		organizationId: string,
		employeeId: string,
		type: "clock_in" | "clock_out" | "correction",
		at: string,
		offsetMinutes: number,
		superseded = false,
	) {
		const { rows } = await admin.query<{ id: string }>(
			`insert into time_entry (employee_id, organization_id, type, timestamp, hash, created_by,
			   utc_offset_minutes, timezone, timezone_source, is_superseded)
			 values ($1, $2, $3, $4::timestamptz at time zone 'UTC', md5(random()::text), $5, $6, 'Europe/Berlin', 'browser', $7)
			 returning id`,
			[employeeId, organizationId, type, at, ids.admin, offsetMinutes, superseded],
		);
		return rows[0].id;
	}

	async function period(
		name: string,
		input: {
			organizationId?: string;
			employeeId?: string;
			start: [string, number];
			end?: [string, number];
			correctedStart?: [string, number];
			approvalStatus?: string;
			deleted?: boolean;
		},
	) {
		const organizationId = input.organizationId ?? ids.organization;
		const employeeId = input.employeeId ?? ana;
		let clockInId = await entry(
			organizationId,
			employeeId,
			"clock_in",
			...input.start,
			!!input.correctedStart,
		);
		let start = input.start[0];
		if (input.correctedStart) {
			clockInId = await entry(organizationId, employeeId, "correction", ...input.correctedStart);
			start = input.correctedStart[0];
		}
		const clockOutId = input.end
			? await entry(organizationId, employeeId, "clock_out", ...input.end)
			: null;
		const { rows } = await admin.query<{ id: string }>(
			`insert into work_period (employee_id, organization_id, clock_in_id, clock_out_id, start_time,
			   end_time, duration_minutes, is_active, approval_status, deleted_at, updated_at)
			 values ($1, $2, $3, $4, $5::timestamptz at time zone 'UTC',
			   $6::timestamptz at time zone 'UTC',
			   case when $6::timestamptz is null then null
			     else (extract(epoch from ($6::timestamptz - $5::timestamptz)) / 60)::int end,
			   $6::timestamptz is null, $7, case when $8 then now() end, now())
			 returning id`,
			[
				employeeId,
				organizationId,
				clockInId,
				clockOutId,
				start,
				input.end?.[0] ?? null,
				input.approvalStatus ?? "approved",
				input.deleted ?? false,
			],
		);
		periods[name] = rows[0].id;
	}

	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, created_at) values
			 ($1, 'T763W', $1, now()), ($2, 'T763W other', $2, now())`,
			[ids.organization, ids.other],
		);
		await admin.query(
			`insert into "user" (id, name, email, created_at, updated_at)
			 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
			[users],
		);
		const { rows } = await admin.query<{ id: string; user_id: string }>(
			`insert into employee (user_id, organization_id, role, is_active, updated_at) values
			 ($1, $3, 'employee', true, now()), ($2, $4, 'employee', true, now())
			 returning id, user_id`,
			[ids.ana, ids.otto, ids.organization, ids.other],
		);
		ana = rows.find((row) => row.user_id === ids.ana)?.id as string;
		const otto = rows.find((row) => row.user_id === ids.otto)?.id as string;

		await period("berlin", {
			start: ["2026-10-01T06:00:00Z", 120],
			end: ["2026-10-01T14:00:00Z", 120],
		});
		await period("corrected", {
			start: ["2026-10-02T07:00:00Z", 120],
			correctedStart: ["2026-10-02T06:30:00Z", 120],
			end: ["2026-10-02T15:00:00Z", 120],
		});
		await period("travel", {
			start: ["2026-10-05T06:00:00Z", 120],
			end: ["2026-10-05T16:00:00Z", -240],
		});
		// Written by SQL, with microseconds a millisecond cursor cannot hold.
		await period("micro", {
			start: ["2026-10-04T06:00:00.123456Z", 120],
			end: ["2026-10-04T07:00:00.000000Z", 120],
		});
		await period("pending", {
			start: ["2026-10-06T06:00:00Z", 120],
			end: ["2026-10-06T10:00:00Z", 120],
			approvalStatus: "pending",
		});
		await period("rejected", {
			start: ["2026-10-07T06:00:00Z", 120],
			end: ["2026-10-07T10:00:00Z", 120],
			approvalStatus: "rejected",
		});
		await period("deleted", {
			start: ["2026-10-08T06:00:00Z", 120],
			end: ["2026-10-08T10:00:00Z", 120],
			deleted: true,
		});
		await period("september", {
			start: ["2026-09-30T21:59:59Z", 120],
			end: ["2026-09-30T23:00:00Z", 120],
		});
		await period("november", {
			start: ["2026-11-01T00:00:00Z", 60],
			end: ["2026-11-01T02:00:00Z", 60],
		});
		await period("running", { start: ["2026-10-31T07:00:00Z", 60] });
		await period("foreign", {
			organizationId: ids.other,
			employeeId: otto,
			start: ["2026-10-01T08:00:00Z", 0],
			end: ["2026-10-01T09:00:00Z", 0],
		});
		key = await createTestKey(ids.organization, ids.admin, ["time-entries:read"]);
	});
	afterAll(cleanup);

	it("returns UTC instants with each event's recorded offset", async () => {
		const rows = await walkPublicApi(listWorkPeriods, key, october);
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get(periods.berlin)).toEqual({
			id: periods.berlin,
			employeeId: ana,
			projectId: null,
			start: { at: "2026-10-01T06:00:00.000Z", utcOffset: "+02:00" },
			end: { at: "2026-10-01T14:00:00.000Z", utcOffset: "+02:00" },
			durationMinutes: 480,
			approvalStatus: "approved",
		});
		expect(byId.get(periods.travel)).toMatchObject({
			start: { at: "2026-10-05T06:00:00.000Z", utcOffset: "+02:00" },
			end: { at: "2026-10-05T16:00:00.000Z", utcOffset: "-04:00" },
			durationMinutes: 600,
		});
	});

	it("returns corrected work in its corrected state and running work with no end", async () => {
		const rows = await walkPublicApi(listWorkPeriods, key, october);
		const byId = new Map(rows.map((row) => [row.id, row]));
		expect(byId.get(periods.corrected)).toMatchObject({
			start: { at: "2026-10-02T06:30:00.000Z", utcOffset: "+02:00" },
			end: { at: "2026-10-02T15:00:00.000Z" },
		});
		expect(byId.get(periods.running)).toMatchObject({
			start: { at: "2026-10-31T07:00:00.000Z", utcOffset: "+01:00" },
			end: null,
			durationMinutes: null,
		});
		expect(byId.get(periods.pending)).toMatchObject({ approvalStatus: "pending" });
	});

	it("selects by start instant and leaves out rejected, deleted and other organizations' work", async () => {
		const rows = await walkPublicApi(listWorkPeriods, key, october);
		expect(new Set(rows.map((row) => row.id))).toEqual(
			new Set([
				periods.berlin,
				periods.corrected,
				periods.travel,
				periods.pending,
				periods.micro,
				periods.running,
			]),
		);
		// A range in another offset selects the same instants.
		const shifted = await walkPublicApi(
			listWorkPeriods,
			key,
			"?from=2026-10-01T02:00:00%2B02:00&to=2026-10-01T23:00:00%2B02:00",
		);
		expect(shifted.map((row) => row.id)).toEqual([periods.berlin]);
		const filtered = await walkPublicApi(listWorkPeriods, key, `${october}&employeeId=${ana}`);
		expect(filtered).toHaveLength(6);
	});

	it("walks the cursor over every period once, in start order", async () => {
		const rows = await walkPublicApi(listWorkPeriods, key, october, 1);
		expect(rows).toHaveLength(6);
		expect(new Set(rows.map((row) => row.id)).size).toBe(6);
		const starts = rows.map((row) => (row.start as { at: string }).at);
		expect(starts).toEqual([...starts].sort());
	});

	it("requires a from/to range of at most 366 days", async () => {
		for (const query of [
			"",
			"?from=2026-10-01T00:00:00Z",
			"?from=2026-01-01T00:00:00Z&to=2027-01-03T00:00:00Z",
			"?from=2026-10-02T00:00:00Z&to=2026-10-01T00:00:00Z",
			"?from=2026-10-01&to=2026-10-02",
		]) {
			const { status, body } = await callPublicApi(listWorkPeriods, key, query);
			expect(status, query).toBe(400);
			expect(body.type).toBe("validation_failed");
		}
	});
});
