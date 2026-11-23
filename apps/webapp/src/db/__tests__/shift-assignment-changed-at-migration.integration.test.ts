/**
 * #1992: migration 0333 adds `shift.assignment_changed_at`, the instant from which § 12 Abs. 3
 * TzBfG call-in notice runs, and backfills existing shifts conservatively: never earlier than the
 * latest change the row records, so no shift moved or reassigned before deploy gains notice it
 * never had. Runs the migration file against a minimal shift table in a scratch schema.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PoolClient } from "pg";
import { Temporal } from "temporal-polyfill";
import { afterAll, describe, expect, it } from "vitest";
import { fullNoticeDays, notificationDay } from "@/lib/statutory/on-call/notice";
import { localInstant } from "@/lib/statutory/on-call/testing/on-call-fixture";
import { integrationAdminPool } from "@/test/integration-database";

const SCHEMA = "t1992_migration";
const admin = integrationAdminPool();
const migration = readFileSync(
	join(process.cwd(), "drizzle/0333_shift_assignment_changed_at.sql"),
	"utf8",
);

const id = (n: number) => `19920000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Shift = [
	n: number,
	status: "draft" | "published",
	createdAt: string,
	publishedAt: string | null,
	updatedAt: string,
	/** The shift day's organization-local midnight, as `shift.date` stores it (UTC). */
	date?: string,
];

/** Shifts of the cases that do not care about the shift day lie well after every change. */
const LATER_DAY = "2026-03-01 23:00";

async function withScratchShifts<T>(
	shifts: Shift[],
	run: (client: PoolClient) => Promise<T>,
): Promise<T> {
	const client = await admin.connect();
	try {
		await client.query(`drop schema if exists ${SCHEMA} cascade`);
		await client.query(`create schema ${SCHEMA}`);
		await client.query(`set search_path to ${SCHEMA}, public`);
		await client.query(`
			create table shift (
				id uuid primary key, status text not null, date timestamp not null,
				published_at timestamp, created_at timestamp default now() not null,
				updated_at timestamp not null);
		`);
		for (const [n, status, createdAt, publishedAt, updatedAt, date = LATER_DAY] of shifts) {
			await client.query(
				"insert into shift (id, status, date, created_at, published_at, updated_at) values ($1, $2, $3, $4, $5, $6)",
				[id(n), status, date, createdAt, publishedAt, updatedAt],
			);
		}
		return await run(client);
	} finally {
		await client.query("reset search_path");
		client.release();
	}
}

async function migrate(client: PoolClient) {
	for (const statement of migration.split("--> statement-breakpoint")) {
		await client.query(statement);
	}
}

async function changedAt(client: PoolClient) {
	const { rows } = await client.query<{ id: string; changed: string }>(
		"select id, to_char(assignment_changed_at, 'YYYY-MM-DD HH24:MI') as changed from shift order by id",
	);
	return Object.fromEntries(rows.map((row) => [row.id, row.changed]));
}

describe("0333 shift assignment_changed_at backfill", () => {
	afterAll(async () => {
		await admin.query(`drop schema if exists ${SCHEMA} cascade`);
	});

	it("dates every existing shift from the latest change it records, never from its creation alone", async () => {
		await withScratchShifts(
			[
				// Published, then reassigned or moved: notice runs from that change at the earliest.
				[1, "published", "2026-01-01 08:00", "2026-01-05 09:00", "2026-01-10 10:00"],
				// Published and left alone: notice runs from publication.
				[2, "published", "2026-01-01 08:00", "2026-01-05 09:00", "2026-01-05 09:00"],
				// A draft edited after creation: its last edit (publication will come later still).
				[3, "draft", "2026-01-01 08:00", null, "2026-01-03 12:00"],
				// A draft never touched.
				[4, "draft", "2026-01-01 08:00", null, "2026-01-01 08:00"],
			],
			async (client) => {
				await migrate(client);
				expect(await changedAt(client)).toEqual({
					[id(1)]: "2026-01-10 10:00",
					[id(2)]: "2026-01-05 09:00",
					[id(3)]: "2026-01-03 12:00",
					[id(4)]: "2026-01-01 08:00",
				});
			},
		);
	});

	it("keeps the short-notice finding of a shift edited after it ran", async () => {
		const timezone = "Europe/Berlin";
		// Published Wednesday 2026-01-07 for Thursday 2026-01-08 09:00–13:00 (Berlin), edited Friday
		// (a note, an end-time correction). `date` holds Thursday's Berlin midnight in UTC.
		await withScratchShifts(
			[
				[
					1,
					"published",
					"2026-01-05 08:00",
					"2026-01-07 09:00",
					"2026-01-09 10:00",
					"2026-01-07 23:00",
				],
			],
			async (client) => {
				await migrate(client);
				const { rows } = await client.query<{ changed: Date }>(
					"select assignment_changed_at at time zone 'UTC' as changed from shift",
				);
				expect(rows).toHaveLength(1);
				const stamp = Temporal.Instant.fromEpochMilliseconds(rows[0]?.changed.getTime() ?? 0);
				const shiftEnd = localInstant("2026-01-08", "13:00", timezone);
				// Announced before the shift ended, so the monitor still judges it, and no later than
				// the shift day: 0 full days of notice.
				expect(Temporal.Instant.compare(stamp, shiftEnd)).toBeLessThan(0);
				const notifiedOn = notificationDay(stamp, timezone);
				expect(Math.max(0, fullNoticeDays(notifiedOn, Temporal.PlainDate.from("2026-01-08")))).toBe(
					0,
				);
			},
		);
	});

	it("is idempotent and keeps a recorded assignment change", async () => {
		await withScratchShifts(
			[[1, "published", "2026-01-01 08:00", "2026-01-05 09:00", "2026-01-10 10:00"]],
			async (client) => {
				await migrate(client);
				await client.query(
					"update shift set assignment_changed_at = '2026-02-01 07:00', updated_at = '2026-02-02 07:00'",
				);
				await migrate(client);
				expect(await changedAt(client)).toEqual({ [id(1)]: "2026-02-01 07:00" });

				await client.query(
					`insert into shift (id, status, date, updated_at) values ($1, 'draft', $2, now())`,
					[id(2), LATER_DAY],
				);
				const { rows } = await client.query<{ fresh: boolean }>(
					"select assignment_changed_at is not null as fresh from shift where id = $1",
					[id(2)],
				);
				expect(rows).toEqual([{ fresh: true }]);
			},
		);
	});
});
