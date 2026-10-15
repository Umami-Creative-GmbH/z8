/**
 * #1224 (spec #1212): every completed work period has a canonical work record.
 * The database checks it for every new and changed row (migration 0234, added
 * `NOT VALID`); history written before the check keeps its half pairs, which
 * the backfill attaches outside closed months.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
	type ClosedMonthDatabaseFixture,
	createClosedMonthDatabaseFixture,
} from "@/lib/time-tracking/closed-months/testing/closed-month-database.test.fixture";
import { asHistory, CANONICAL_RECORD_CHECK } from "./__tests__/historical-work";

describe("the canonical work record check on PostgreSQL (#1224)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: ClosedMonthDatabaseFixture;

	beforeAll(async () => {
		fixture = await createClosedMonthDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function someone() {
		const org = await fixture.organization("UTC");
		const person = await fixture.employee({ organizationId: org.organizationId });
		return { ...person, organizationId: org.organizationId };
	}

	function violation() {
		return expect.objectContaining({ code: "23514", constraint: CANONICAL_RECORD_CHECK });
	}

	it("is added NOT VALID: it checks new and changed rows only", async () => {
		const { rows } = await fixture.pool.query(
			`select convalidated, pg_get_constraintdef(oid) as definition from pg_constraint
			 where conrelid = 'public.work_period'::regclass and conname = $1`,
			[CANONICAL_RECORD_CHECK],
		);
		expect(rows).toEqual([
			{
				convalidated: false,
				definition:
					"CHECK ((is_active OR (deleted_at IS NOT NULL) OR (canonical_record_id IS NOT NULL))) NOT VALID",
			},
		]);
	});

	it("refuses inserting completed work without a canonical work record", async () => {
		const person = await someone();
		await expect(
			fixture.work({
				...person,
				start: "2026-04-07T08:00:00Z",
				end: "2026-04-07T16:00:00Z",
				canonical: false,
			}),
		).rejects.toEqual(violation());
	});

	it("refuses ending live work without a canonical work record", async () => {
		const person = await someone();
		const live = await fixture.work({ ...person, start: "2026-04-07T08:00:00Z", end: null });
		await expect(
			fixture.pool.query(
				`update work_period set is_active = false, end_time = '2026-04-07T16:00:00Z',
				 duration_minutes = 480 where id = $1`,
				[live.workPeriodId],
			),
		).rejects.toEqual(violation());
	});

	it("accepts completed work with its canonical work record, and deleted work without one", async () => {
		const person = await someone();
		const work = await fixture.work({
			...person,
			start: "2026-04-07T08:00:00Z",
			end: "2026-04-07T16:00:00Z",
		});
		const { rows } = await fixture.pool.query(
			"select canonical_record_id from work_period where id = $1",
			[work.workPeriodId],
		);
		expect(rows).toEqual([{ canonical_record_id: work.workPeriodId }]);

		const live = await fixture.work({ ...person, start: "2026-04-08T08:00:00Z", end: null });
		await fixture.pool.query(
			`update work_period set is_active = false, end_time = '2026-04-08T16:00:00Z',
			 duration_minutes = 480, deleted_at = now() where id = $1`,
			[live.workPeriodId],
		);
	});

	it("keeps a half pair written before the check, and refuses changing it without attaching", async () => {
		const person = await someone();
		const history = await fixture.work({
			...person,
			start: "2026-04-07T08:00:00Z",
			end: "2026-04-07T16:00:00Z",
			canonical: "history",
		});
		const { rows } = await fixture.pool.query(
			"select canonical_record_id from work_period where id = $1",
			[history.workPeriodId],
		);
		expect(rows).toEqual([{ canonical_record_id: null }]);
		await expect(
			fixture.pool.query("update work_period set duration_minutes = 479 where id = $1", [
				history.workPeriodId,
			]),
		).rejects.toEqual(violation());
		// History written by hand outside the fixture, too.
		await asHistory(fixture.pool, (client) =>
			client.query("update work_period set graph_revision = graph_revision + 1 where id = $1", [
				history.workPeriodId,
			]),
		);
	});
});
