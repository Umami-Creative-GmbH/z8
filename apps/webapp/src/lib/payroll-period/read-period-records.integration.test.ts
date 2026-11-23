/**
 * #1900: the batched records loader of the payroll PDF day sheets against a disposable
 * PostgreSQL database. It reads the work and break records of already grant-resolved
 * employees for every local day of a period, in two organizations and two zones.
 */

import { Temporal } from "temporal-polyfill";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

const { readPeriodRecordsForEmployees } = await import("./read-period-records");

const admin = integrationAdminPool();
const ORG = "t1900r-org";
const OTHER_ORG = "t1900r-other";
const users = ["t1900r-owner", "t1900r-anna", "t1900r-ben", "t1900r-foreign"];
const ids = {
	anna: "d1900000-0000-4000-8000-000000000001",
	ben: "d1900000-0000-4000-8000-000000000002",
	foreign: "d1900000-0000-4000-8000-000000000003",
} as const;
const november = { startDate: "2026-11-01", endDate: "2026-11-30" };
const now = Temporal.Instant.from("2026-11-21T12:00:00Z");

async function cleanup() {
	await admin.query("delete from organization where id in ($1, $2)", [ORG, OTHER_ORG]);
	await admin.query('delete from "user" where id = any($1::text[])', [users]);
}

async function employee(id: string, userId: string, organizationId: string, number: string) {
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, employee_number, is_active, updated_at)
		 values ($1, $2, $3, 'employee', $4, true, now())`,
		[id, userId, organizationId, number],
	);
}

async function record(
	organizationId: string,
	employeeId: string,
	kind: "work" | "break" | "absence",
	startAt: string,
	endAt: string | null,
	approvalState: "draft" | "pending" | "approved" | "rejected" = "approved",
): Promise<string> {
	const minutes = endAt
		? Math.round(
				Temporal.Instant.from(startAt).until(Temporal.Instant.from(endAt)).total("minutes"),
			)
		: null;
	const { rows } = await admin.query(
		`insert into time_record (id, organization_id, employee_id, record_kind, start_at, end_at,
		   duration_minutes, approval_state, origin, created_by, updated_by, updated_at)
		 values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, 'manual',
		   't1900r-owner', 't1900r-owner', now()) returning id`,
		[organizationId, employeeId, kind, startAt, endAt, minutes, approvalState],
	);
	return rows[0].id;
}

async function seed() {
	await cleanup();
	await admin.query(
		`insert into organization (id, name, slug, timezone, created_at)
		 values ($1, $1, $1, 'Europe/Berlin', '2026-01-01'), ($2, $2, $2, 'Europe/Berlin', '2026-01-01')`,
		[ORG, OTHER_ORG],
	);
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at)
		 select user_id, user_id, user_id || '@example.test', now(), now() from unnest($1::text[]) as user_id`,
		[users],
	);
	await employee(ids.anna, "t1900r-anna", ORG, "ANN-1");
	await employee(ids.ben, "t1900r-ben", ORG, "BEN-1");
	await employee(ids.foreign, "t1900r-foreign", OTHER_ORG, "FOR-1");
}

describe("readPeriodRecordsForEmployees on PostgreSQL", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	beforeEach(seed);
	afterAll(cleanup);

	it("reads each employee's work and break records per local day in one batch", async () => {
		// Anna in Berlin: 22:00-06:00 on 9/10 November, a paid break at 02:00.
		await record(ORG, ids.anna, "work", "2026-11-09T21:00:00Z", "2026-11-10T05:00:00Z");
		const paidBreak = await record(
			ORG,
			ids.anna,
			"break",
			"2026-11-10T01:00:00Z",
			"2026-11-10T01:30:00Z",
		);
		await admin.query(
			`insert into time_record_break (record_id, organization_id, record_kind, is_paid)
			 values ($1, $2, 'break', true)`,
			[paidBreak, ORG],
		);
		// Pending and draft records are read; rejected records and absences are not.
		await record(ORG, ids.anna, "work", "2026-11-12T08:00:00Z", "2026-11-12T12:00:00Z", "pending");
		// A clocked break is the gap between two work records: 13:00-13:30 on 12 November.
		await record(ORG, ids.anna, "work", "2026-11-12T12:30:00Z", "2026-11-12T14:00:00Z");
		await record(ORG, ids.anna, "work", "2026-11-13T08:00:00Z", "2026-11-13T12:00:00Z", "rejected");
		await record(ORG, ids.anna, "absence", "2026-11-16T00:00:00Z", "2026-11-16T23:59:59Z");
		// Running since 20 November 08:00 Berlin; now is 21 November.
		await record(ORG, ids.anna, "work", "2026-11-20T07:00:00Z", null, "draft");
		// Outside the period: 31 October.
		await record(ORG, ids.anna, "work", "2026-10-31T08:00:00Z", "2026-10-31T12:00:00Z");
		// Ben in New York: 20:00-23:00 on 30 November is 1 December in UTC.
		await admin.query(
			`insert into user_settings (user_id, timezone, updated_at)
			 values ('t1900r-ben', 'America/New_York', now())`,
		);
		await record(ORG, ids.ben, "work", "2026-12-01T01:00:00Z", "2026-12-01T04:00:00Z");

		const records = await readPeriodRecordsForEmployees(ORG, {
			employees: [
				{ id: ids.anna, timezone: "Europe/Berlin" },
				{ id: ids.ben, timezone: "America/New_York" },
			],
			...november,
			now,
		});

		const days = (employeeId: string) =>
			Object.fromEntries(
				[...(records.get(employeeId) ?? new Map())].map(([date, list]) => [
					date,
					list.map((item: { kind: string; start: string; end: string | null }) => [
						item.kind,
						item.start,
						item.end,
					]),
				]),
			);
		expect(days(ids.anna)).toEqual({
			"2026-11-09": [["work", "2026-11-09T22:00", "2026-11-10T06:00"]],
			"2026-11-10": [
				["work", "2026-11-09T22:00", "2026-11-10T06:00"],
				["break", "2026-11-10T02:00", "2026-11-10T02:30"],
			],
			"2026-11-12": [
				["work", "2026-11-12T09:00", "2026-11-12T13:00"],
				["break", "2026-11-12T13:00", "2026-11-12T13:30"],
				["work", "2026-11-12T13:30", "2026-11-12T15:00"],
			],
			"2026-11-20": [["work", "2026-11-20T08:00", null]],
			"2026-11-21": [["work", "2026-11-20T08:00", null]],
		});
		expect(records.get(ids.anna)?.get("2026-11-10")?.[1]).toMatchObject({
			isPaid: true,
			durationMinutes: 30,
			approvalState: "approved",
		});
		expect(records.get(ids.anna)?.get("2026-11-12")?.[0]?.approvalState).toBe("pending");
		// The break between pending and approved work is not approved yet either.
		expect(records.get(ids.anna)?.get("2026-11-12")?.[1]).toMatchObject({
			approvalState: "pending",
			durationMinutes: 30,
			isPaid: false,
		});
		expect(records.get(ids.anna)?.get("2026-11-20")?.[0]).toMatchObject({
			approvalState: "draft",
			durationMinutes: null,
		});
		expect(days(ids.ben)).toEqual({
			"2026-11-30": [["work", "2026-11-30T20:00", "2026-11-30T23:00"]],
		});
	});

	it("never reads another organization's records", async () => {
		await record(OTHER_ORG, ids.foreign, "work", "2026-11-10T08:00:00Z", "2026-11-10T16:00:00Z");

		const records = await readPeriodRecordsForEmployees(ORG, {
			employees: [{ id: ids.foreign, timezone: "Europe/Berlin" }],
			...november,
			now,
		});

		expect(records.get(ids.foreign)?.size ?? 0).toBe(0);
	});

	it("reads nothing for no employees", async () => {
		const records = await readPeriodRecordsForEmployees(ORG, { employees: [], ...november, now });

		expect(records.size).toBe(0);
	});
});
