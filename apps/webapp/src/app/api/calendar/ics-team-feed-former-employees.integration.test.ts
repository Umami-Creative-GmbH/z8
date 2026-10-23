/**
 * PostgreSQL contract for former employees in a team calendar feed (#1438):
 * their absences stop at the moment they left. That moment isn't recorded yet,
 * so absences starting after today (organization timezone) are left out and
 * past ones stay.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { Temporal } from "temporal-polyfill";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { digestIcsFeedSecret } from "@/lib/calendar-sync/ics-feed-secret";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("@/lib/rate-limit", () => ({
	getClientIp: () => "203.0.113.7",
	checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: 0, retryAfter: 0 }),
	createRateLimitResponse: () => new Response(null, { status: 429 }),
}));

const publicFeed = await import("./ics/[secret]/route");

/** A departure cutoff in the past, so that a pending departure is due. */
const PAST_CUTOFF = "2026-09-15T00:00:00Z";
const SECRET = "d4".repeat(32);

const today = Temporal.Now.plainDateISO("UTC");
const day = (days: number) => today.add({ days }).toString();

describe("team calendar feed and former employees (#1438)", () => {
	vi.setConfig({ testTimeout: 180_000, hookTimeout: 180_000 });
	let fixture: LifecycleDatabaseFixture;
	let current: string;
	let deactivated: string;
	let departed: SeededEmployee;
	const absences = new Map<string, string>();

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		await fixture.pool.query(`update organization set timezone = 'UTC' where id = $1`, [
			fixture.organizationId,
		]);
		current = fixture.employeeId;
		deactivated = (await fixture.seedEmployee({ isActive: false })).employeeId;
		departed = await fixture.seedEmployee();
		await fixture.pool.query(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, created_by, request_id, request_fingerprint, revision, status)
			 values ($1, $2, $3, 'scheduled', '2026-09-14', 'UTC', $4, $5, gen_random_uuid(), 'test', 1, 'pending')`,
			[
				fixture.organizationId,
				departed.employeeId,
				departed.employmentPeriodId,
				PAST_CUTOFF,
				fixture.ownerUserId,
			],
		);

		const teamId = randomUUID();
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, 'Ops', now())`,
			[teamId, fixture.organizationId],
		);
		const categoryId = randomUUID();
		await fixture.pool.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, requires_work_time, counts_against_vacation, is_active, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', true, false, true, true, now())`,
			[categoryId, fixture.organizationId],
		);
		for (const [name, employeeId] of [
			["current", current],
			["deactivated", deactivated],
			["departed", departed.employeeId],
		] as const) {
			await fixture.pool.query(`update employee set team_id = $1 where id = $2`, [
				teamId,
				employeeId,
			]);
			for (const [when, start, end] of [
				["past", day(-10), day(-9)],
				["today", day(0), day(1)],
				["future", day(5), day(6)],
			] as const) {
				const id = randomUUID();
				absences.set(`${name}:${when}`, id);
				await fixture.pool.query(
					`insert into absence_entry
					 (id, employee_id, category_id, start_date, end_date, status, organization_id, updated_at)
					 values ($1, $2, $3, $4, $5, 'approved', $6, now())`,
					[id, employeeId, categoryId, start, end, fixture.organizationId],
				);
			}
		}

		await fixture.pool.query(
			`insert into ics_feed (organization_id, feed_type, team_id, secret_digest, secret_hash_version, created_by, updated_at)
			 values ($1, 'team', $2, $3, 'v1', $4, now())`,
			[fixture.organizationId, teamId, digestIcsFeedSecret(SECRET), fixture.ownerUserId],
		);
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function feedAbsenceIds() {
		const response = await publicFeed.GET(
			new NextRequest(`https://app.example.test/api/calendar/ics/${SECRET}`),
			{ params: Promise.resolve({ secret: SECRET }) },
		);
		expect(response.status).toBe(200);
		// Unfold folded ICS lines before reading the UIDs.
		const body = (await response.text()).replace(/\r\n[ \t]/g, "");
		return [...body.matchAll(/UID:absence-([0-9a-f-]{36})@/g)].map((match) => match[1]);
	}

	it("keeps a former employee's past absences and leaves out those starting after today", async () => {
		const ids = new Set(await feedAbsenceIds());
		const shown = [...absences.entries()]
			.filter(([, id]) => ids.has(id))
			.map(([key]) => key)
			.toSorted();

		expect(shown).toEqual(
			[
				"current:past",
				"current:today",
				"current:future",
				"deactivated:past",
				"deactivated:today",
				"departed:past",
				"departed:today",
			].toSorted(),
		);
	});
});
