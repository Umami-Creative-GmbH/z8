/**
 * #1018: cover summaries against a disposable PostgreSQL database. The job
 * finds the deputies whose cover starts and the approvers who are back, judges
 * each day in the absent approver's timezone, counts what waits through the
 * real inbox handlers and what the deputy decided from the acting-for record,
 * claims each summary once and hands it to the notifier (recorded here).
 *
 * Run: pnpm --filter webapp test:integration src/lib/approvals/deputy/cover-summaries.integration.test.ts
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { CreateNotificationParams } from "@/lib/notifications/types";
import { integrationAdminPool } from "@/test/integration-database";

vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

const ORG = "t1018-summary-org";
const OTHER_ORG = "t1018-summary-other-org";
const SEEDED_AT = new Date("2026-03-01T00:00:00Z");

const ids = {
	x: "e1018000-0000-4000-8000-000000000001",
	y: "e1018000-0000-4000-8000-000000000002",
	y2: "e1018000-0000-4000-8000-000000000003",
	requester: "e1018000-0000-4000-8000-000000000004",
	contactOnly: "e1018000-0000-4000-8000-000000000005",
	xContact: "e1018000-0000-4000-8000-000000000006",
	xSwitch: "e1018000-0000-4000-8000-000000000007",
	vacation: "e1018100-0000-4000-8000-000000000001",
	absence: "e1018200-0000-4000-8000-000000000001",
	earlierAbsence: "e1018200-0000-4000-8000-000000000002",
	contactAbsence: "e1018200-0000-4000-8000-000000000003",
	switchAbsence: "e1018200-0000-4000-8000-000000000004",
	pendingAbsence: "e1018200-0000-4000-8000-000000000005",
} as const;
type Person = "x" | "y" | "y2" | "requester" | "contactOnly" | "xContact" | "xSwitch";
const userOf = (person: Person) => `t1018-${person}`;

const admin = integrationAdminPool();
const sent: CreateNotificationParams[] = [];
const notify = async (params: CreateNotificationParams) => {
	sent.push(params);
};
const ours = () => sent.filter((params) => params.organizationId === ORG);

async function cleanup() {
	await admin.query("delete from organization where id = any($1::text[])", [[ORG, OTHER_ORG]]);
	await admin.query('delete from "user" where id like $1', ["t1018-%"]);
}

async function seedPerson(person: Person, input: { employeeRole: string; timezone?: string }) {
	await admin.query(
		'insert into "user" (id,name,email,created_at,updated_at) values ($1,$2,$3,$4,$4)',
		[userOf(person), `Name ${person}`, `${userOf(person)}@example.test`, SEEDED_AT],
	);
	await admin.query(
		"insert into member (id,organization_id,user_id,role,status,created_at) values ($1,$2,$3,'member','approved',$4)",
		[`t1018-member-${person}`, ORG, userOf(person), SEEDED_AT],
	);
	await admin.query(
		"insert into employee (id,user_id,organization_id,role,is_active,updated_at) values ($1,$2,$3,$4,true,$5)",
		[ids[person], userOf(person), ORG, input.employeeRole, SEEDED_AT],
	);
	if (input.timezone) {
		await admin.query(
			"insert into user_settings (user_id, locale, timezone, time_format, updated_at) values ($1, 'en', $2, '24h', $3)",
			[userOf(person), input.timezone, SEEDED_AT],
		);
	}
}

async function insertAbsence(input: {
	id: string;
	employee: Person;
	deputy: Person | null;
	startDate: string;
	endDate: string;
	status?: "pending" | "approved";
}) {
	await admin.query(
		`insert into absence_entry
		 (id, employee_id, category_id, start_date, end_date, status, organization_id, deputy_employee_id, updated_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		[
			input.id,
			ids[input.employee],
			ids.vacation,
			input.startDate,
			input.endDate,
			input.status ?? "approved",
			ORG,
			input.deputy ? ids[input.deputy] : null,
			SEEDED_AT,
		],
	);
}

async function recordDeputyDecision(input: { deputy: Person; absenceId: string; at: string }) {
	await admin.query(
		`insert into approval_deputy_decision
		 (organization_id, deputy_employee_id, acting_for_employee_id, absence_id, authority, entity_type, entity_id, decision, decided_at)
		 values ($1, $2, $3, $4, 'legacy', 'absence_entry', $5, 'approved', $6)`,
		[ORG, ids[input.deputy], ids.x, input.absenceId, randomUUID(), new Date(input.at)],
	);
}

async function setDeputyDecisions(enabled: boolean) {
	await admin.query(
		`insert into approval_setting (organization_id, deputy_decisions_enabled) values ($1, $2)
		 on conflict (organization_id) do update set deputy_decisions_enabled = excluded.deputy_decisions_enabled`,
		[ORG, enabled],
	);
}

async function run(at: string) {
	const { db } = await import("@/db");
	const { runCoverSummaries } = await import("./cover-summary-store");
	return runCoverSummaries(db, { now: parseInstant(at), notify });
}

// X works in Los Angeles (UTC-7 after 8 March 2026); the organization is in Berlin.
// X is away Tuesday 10 to Friday 13 March 2026.
const BEFORE_X_TUESDAY = "2026-03-10T06:59:00Z"; // Mon 23:59 in LA, Tue 07:59 in Berlin
const X_TUESDAY = "2026-03-10T07:00:00Z"; // Tue 00:00 in LA
const X_WEDNESDAY = "2026-03-11T16:00:00Z";
const BEFORE_X_MONDAY = "2026-03-16T06:59:00Z"; // Sun 23:59 in LA, Mon 07:59 in Berlin
const X_MONDAY = "2026-03-16T07:00:00Z"; // Mon 00:00 in LA

describe("cover summaries (#1018)", { timeout: 60_000 }, () => {
	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at)
			 values ($1, $1, $1, 'Europe/Berlin', $3), ($2, $2, $2, 'UTC', $3)`,
			[ORG, OTHER_ORG, SEEDED_AT],
		);
		await admin.query(
			`insert into absence_category
			 (id, organization_id, type, name, requires_approval, requires_work_time, counts_against_vacation, is_active, updated_at)
			 values ($1, $2, 'vacation', 'Vacation', true, false, true, true, $3)`,
			[ids.vacation, ORG, SEEDED_AT],
		);
		await seedPerson("x", { employeeRole: "manager", timezone: "America/Los_Angeles" });
		await seedPerson("y", { employeeRole: "manager", timezone: "UTC" });
		await seedPerson("y2", { employeeRole: "manager" });
		await seedPerson("requester", { employeeRole: "employee" });
		await seedPerson("contactOnly", { employeeRole: "employee" });
		await seedPerson("xContact", { employeeRole: "manager" });
		await seedPerson("xSwitch", { employeeRole: "manager" });

		await insertAbsence({
			id: ids.absence,
			employee: "x",
			deputy: "y",
			startDate: "2026-03-10",
			endDate: "2026-03-13",
		});
		// An earlier absence of X; Y's decisions for it are not part of this one.
		await insertAbsence({
			id: ids.earlierAbsence,
			employee: "x",
			deputy: "y",
			startDate: "2026-02-02",
			endDate: "2026-02-03",
		});
		await insertAbsence({
			id: ids.contactAbsence,
			employee: "xContact",
			deputy: "contactOnly",
			startDate: "2026-03-10",
			endDate: "2026-03-13",
		});
		await insertAbsence({
			id: ids.switchAbsence,
			employee: "xSwitch",
			deputy: "y",
			startDate: "2026-03-10",
			endDate: "2026-03-13",
		});
		// The requester's pending absence waits for X.
		await insertAbsence({
			id: ids.pendingAbsence,
			employee: "requester",
			deputy: null,
			startDate: "2026-03-20",
			endDate: "2026-03-20",
			status: "pending",
		});
		await admin.query(
			`insert into approval_request (organization_id, entity_type, entity_id, requested_by, approver_id, status, updated_at)
			 values ($1, 'absence_entry', $2, $3, $4, 'pending', $5)`,
			[ORG, ids.pendingAbsence, ids.requester, ids.x, SEEDED_AT],
		);
		// The earlier absence's claims exist, so nothing about it is sent now.
		await admin.query(
			`insert into approval_deputy_cover_summary (organization_id, absence_id, deputy_employee_id, kind, local_date, item_count)
			 values ($1, $2, $3, 'cover_start', '2026-02-02', 0), ($1, $2, $3, 'return', '2026-02-04', 1)`,
			[ORG, ids.earlierAbsence, ids.y],
		);
		await recordDeputyDecision({
			deputy: "y",
			absenceId: ids.earlierAbsence,
			at: "2026-02-02T10:00:00Z",
		});
	});
	afterAll(cleanup);
	beforeEach(() => {
		sent.length = 0;
	});

	it("tells the deputy on the approver's first local day, with what waits, once", async () => {
		await setDeputyDecisions(false);
		await run(X_TUESDAY);
		expect(ours()).toEqual([]);
		await setDeputyDecisions(true);

		// Already Tuesday in Berlin (xSwitch has no timezone of their own), still Monday for X.
		await run(BEFORE_X_TUESDAY);
		expect(ours().map((params) => [params.type, params.userId, params.entityId])).toEqual([
			["approval_cover_started", userOf("y"), ids.switchAbsence],
		]);
		expect(ours()[0]?.message).toBe(
			"You're covering Name xSwitch's approvals: nothing waiting yet.",
		);

		sent.length = 0;
		await run(X_TUESDAY);
		expect(ours().map((params) => [params.type, params.userId, params.entityId])).toEqual([
			["approval_cover_started", userOf("y"), ids.absence],
		]);
		expect(ours()[0]).toMatchObject({
			message: "You're covering Name x's approvals: 1 waiting.",
			actionUrl: `/approvals/inbox#covering-${ids.x}`,
		});

		sent.length = 0;
		await run(X_TUESDAY);
		await run(X_WEDNESDAY);
		expect(ours()).toEqual([]);
	});

	it("never tells a contact-only deputy", async () => {
		await run(X_WEDNESDAY);
		expect(ours().filter((params) => params.userId === userOf("contactOnly"))).toEqual([]);
	});

	it("tells a deputy who takes over mid-absence, and not the former deputy again", async () => {
		await admin.query("update absence_entry set deputy_employee_id = $1 where id = $2", [
			ids.y2,
			ids.absence,
		]);
		await run(X_WEDNESDAY);
		expect(ours().map((params) => [params.type, params.userId])).toEqual([
			["approval_cover_started", userOf("y2")],
		]);
	});

	it("tells the approver on their first local working day what each deputy decided, once", async () => {
		await recordDeputyDecision({ deputy: "y", absenceId: ids.absence, at: "2026-03-10T15:00:00Z" });
		await recordDeputyDecision({ deputy: "y", absenceId: ids.absence, at: "2026-03-10T16:00:00Z" });
		await recordDeputyDecision({
			deputy: "y2",
			absenceId: ids.absence,
			at: "2026-03-12T09:00:00Z",
		});

		// Saturday and Sunday in Los Angeles are not working days.
		await run("2026-03-14T18:00:00Z");
		await run(BEFORE_X_MONDAY);
		expect(ours().filter((params) => params.type === "approval_cover_return_summary")).toEqual([]);

		await run(X_MONDAY);
		const summaries = ours().filter((params) => params.type === "approval_cover_return_summary");
		expect(summaries.map((params) => [params.userId, params.message, params.actionUrl])).toEqual(
			expect.arrayContaining([
				[
					userOf("x"),
					"While you were away, Name y decided 2 approvals.",
					`/approvals/deputy-decisions/${ids.absence}?deputy=${ids.y}`,
				],
				[
					userOf("x"),
					"While you were away, Name y2 decided 1 approval.",
					`/approvals/deputy-decisions/${ids.absence}?deputy=${ids.y2}`,
				],
			]),
		);
		expect(summaries).toHaveLength(2);

		sent.length = 0;
		await run(X_MONDAY);
		expect(ours()).toEqual([]);
	});

	it("tells nobody on return when the deputy decided nothing", async () => {
		await run("2026-03-17T12:00:00Z");
		expect(ours().filter((params) => params.userId === userOf("xSwitch"))).toEqual([]);
	});

	it("lists exactly the deputy's decisions for the approver during that absence, to the approver only", async () => {
		const { db } = await import("@/db");
		const { loadDeputyDecisionsForAbsence } = await import("./cover-summary-store");
		const list = await loadDeputyDecisionsForAbsence(db, {
			organizationId: ORG,
			absenceId: ids.absence,
			viewerEmployeeId: ids.x,
			deputyEmployeeId: ids.y,
		});
		expect(list?.absence).toMatchObject({ startDate: "2026-03-10", endDate: "2026-03-13" });
		expect(list?.decisions).toHaveLength(2);
		expect(list?.decisions.every((decision) => decision.deputy.name === "Name y")).toBe(true);

		const everyDeputy = await loadDeputyDecisionsForAbsence(db, {
			organizationId: ORG,
			absenceId: ids.absence,
			viewerEmployeeId: ids.x,
		});
		expect(everyDeputy?.decisions).toHaveLength(3);

		expect(
			await loadDeputyDecisionsForAbsence(db, {
				organizationId: ORG,
				absenceId: ids.absence,
				viewerEmployeeId: ids.requester,
			}),
		).toBeNull();
		expect(
			await loadDeputyDecisionsForAbsence(db, {
				organizationId: OTHER_ORG,
				absenceId: ids.absence,
				viewerEmployeeId: ids.x,
			}),
		).toBeNull();
	});
});
