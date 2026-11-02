/**
 * #811 code review: Employment category additions against a disposable
 * PostgreSQL database: holiday and holiday-category assignments, the
 * departure history, and the names of other teams in team permissions. The
 * collector is called the way the export worker calls it.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";
import type { CollectedCategory, PersonalDataExportScope, PersonalDataRow } from "../collector";

const { db } = await import("@/db");
const { employmentCollector } = await import("./employment");

const ORG = "t811e-org";

const ids = {
	ada: "81100000-0000-4000-8000-000000000e01",
	olga: "81100000-0000-4000-8000-000000000e02",
	teamAda: "81100000-0000-4000-8000-000000000e11",
	teamOther: "81100000-0000-4000-8000-000000000e12",
	categoryCompany: "81100000-0000-4000-8000-000000000e21",
	categorySecret: "81100000-0000-4000-8000-000000000e22",
	holidayFounders: "81100000-0000-4000-8000-000000000e31",
	holidayTeam: "81100000-0000-4000-8000-000000000e32",
	holidaySecret: "81100000-0000-4000-8000-000000000e33",
	period: "81100000-0000-4000-8000-000000000e41",
	departure: "81100000-0000-4000-8000-000000000e42",
	vanOwn: "81100000-0000-4000-8000-000000000e51",
	vanTeam: "81100000-0000-4000-8000-000000000e52",
	vanSecret: "81100000-0000-4000-8000-000000000e53",
} as const;

const admin = integrationAdminPool();

async function cleanup() {
	await admin.query("delete from organization where id = $1", [ORG]);
	await admin.query('delete from "user" where id like $1', ["t811e-%"]);
}

async function seedPerson(name: string, employeeId: string, displayName: string) {
	await admin.query(
		`insert into "user" (id, name, email, created_at, updated_at) values ($1, $2, $3, now(), now())`,
		[`t811e-${name}`, displayName, `t811e-${name}@example.test`],
	);
	await admin.query(
		`insert into employee (id, user_id, organization_id, role, is_active, updated_at)
		 values ($1, $2, $3, 'employee', true, now())`,
		[employeeId, `t811e-${name}`, ORG],
	);
}

function scopeOf(kind: PersonalDataExportScope["kind"]): PersonalDataExportScope {
	return { organizationId: ORG, employeeId: ids.ada, userId: "t811e-ada", kind };
}

function table(category: CollectedCategory, key: string): PersonalDataRow[] {
	const part = category.parts.find((candidate) => candidate.key === key);
	if (part?.kind !== "table") throw new Error(`no table part ${key}`);
	return part.rows;
}

describe("personal data export: Employment additions (#811 review)", () => {
	beforeAll(async () => {
		await cleanup();
		await admin.query(
			`insert into organization (id, name, slug, timezone, created_at) values ($1, 'Acme GmbH', $1, 'Europe/Berlin', now())`,
			[ORG],
		);
		await seedPerson("ada", ids.ada, "Ada Lovelace");
		await seedPerson("olga", ids.olga, "Olga Owner");
		await admin.query(
			`insert into team (id, organization_id, name, updated_at) values
			   ($1, $3, 'Platform', now()), ($2, $3, 'Secret Team', now())`,
			[ids.teamAda, ids.teamOther, ORG],
		);
		await admin.query("update employee set team_id = $1 where id = $2", [ids.teamAda, ids.ada]);

		// Holidays: one assigned to Ada, one to her team, one to another team; and categories.
		await admin.query(
			`insert into holiday_category (id, organization_id, type, name, updated_at) values
			   ($1, $3, 'company_holiday', 'Company days', now()), ($2, $3, 'company_holiday', 'Secret days', now())`,
			[ids.categoryCompany, ids.categorySecret, ORG],
		);
		await admin.query(
			`insert into holiday (id, organization_id, category_id, name, start_date, end_date, created_by, updated_at) values
			   ($1, $4, $5, 'Founders day', '2026-06-01 00:00:00', '2026-06-01 23:59:59', 't811e-olga', now()),
			   ($2, $4, $5, 'Platform day', '2026-07-01 00:00:00', '2026-07-01 23:59:59', 't811e-olga', now()),
			   ($3, $4, $6, 'Secret team day', '2026-08-01 00:00:00', '2026-08-01 23:59:59', 't811e-olga', now())`,
			[
				ids.holidayFounders,
				ids.holidayTeam,
				ids.holidaySecret,
				ORG,
				ids.categoryCompany,
				ids.categorySecret,
			],
		);
		await admin.query(
			`insert into holiday_assignment (holiday_id, organization_id, assignment_type, team_id, employee_id,
			   created_by, updated_at) values
			   ($1, $4, 'employee', null, $5, 't811e-olga', now()),
			   ($2, $4, 'team', $6, null, 't811e-olga', now()),
			   ($3, $4, 'team', $7, null, 't811e-olga', now())`,
			[
				ids.holidayFounders,
				ids.holidayTeam,
				ids.holidaySecret,
				ORG,
				ids.ada,
				ids.teamAda,
				ids.teamOther,
			],
		);
		await admin.query(
			`insert into holiday_category_assignment (category_id, organization_id, assignment_type, team_id,
			   employee_id, created_by, updated_at) values
			   ($1, $3, 'employee', null, $4, 't811e-olga', now()),
			   ($2, $3, 'team', $5, null, 't811e-olga', now())`,
			[ids.categoryCompany, ids.categorySecret, ORG, ids.ada, ids.teamOther],
		);

		// Ada may manage the members of a team she is not in.
		await admin.query(
			`insert into team_permissions (organization_id, employee_id, team_id, can_manage_team_members, granted_by,
			   updated_at)
			 values ($1, $2, $3, true, $4, now())`,
			[ORG, ids.ada, ids.teamOther, ids.olga],
		);

		// Departure history: a scheduled departure, then a review resolved on it.
		await admin.query(
			`insert into employee_employment_period (id, organization_id, employee_id, status, started_at, start_provenance)
			 values ($1, $2, $3, 'open', '2025-01-01T00:00:00Z', 'recorded')`,
			[ids.period, ORG, ids.ada],
		);
		await admin.query(
			`insert into employee_departure (id, organization_id, employee_id, employment_period_id, mode,
			   last_working_day, timezone, cutoff_at, revision, status, created_by, request_id, request_fingerprint)
			 values ($1, $2, $3, $4, 'scheduled', '2026-12-31', 'Europe/Berlin', '2026-12-31T23:00:00Z', 1,
			   'pending', 't811e-olga', gen_random_uuid(), 'fp-t811e')`,
			[ids.departure, ORG, ids.ada, ids.period],
		);
		await admin.query(
			`insert into employee_departure_event (organization_id, employee_id, departure_id, employment_period_id,
			   request_id, event_index, revision, kind, actor_user_id, occurred_at, metadata, request_fingerprint, result)
			 values
			   ($1, $2, $3, $4, gen_random_uuid(), 0, 1, 'departure_scheduled', 't811e-olga', '2026-10-01T08:00:00Z',
			    '{"note":"event-meta-t811e"}', 'event-fp-t811e', '{"secret":"event-result-t811e"}'),
			   ($1, $2, $3, $4, gen_random_uuid(), 0, 1, 'review_resolved', 't811e-olga', '2026-10-02T08:00:00Z',
			    '{"resolution":"review-content-t811e"}', null, null)`,
			[ORG, ids.ada, ids.departure, ids.period],
		);

		// Assigned drivers (#807): a van for Ada, an archived one for her team, one for another team.
		await admin.query(
			`insert into organization_vehicle (id, organization_id, name, licence_plate, archived_at) values
			   ($1, $4, 'Caddy 1', 'M AB 1', null),
			   ($2, $4, 'Sprinter 2', 'M AB 2', '2026-09-01T00:00:00Z'),
			   ($3, $4, 'Secret van', 'M SE 3', null)`,
			[ids.vanOwn, ids.vanTeam, ids.vanSecret, ORG],
		);
		await admin.query(
			`insert into organization_vehicle_driver (organization_id, vehicle_id, employee_id, team_id, created_at, created_by) values
			   ($1, $2, $5, null, '2026-08-01T08:00:00Z', 't811e-olga'),
			   ($1, $3, null, $6, '2026-08-02T08:00:00Z', 't811e-olga'),
			   ($1, $4, null, $7, '2026-08-03T08:00:00Z', 't811e-olga')`,
			[ORG, ids.vanOwn, ids.vanTeam, ids.vanSecret, ids.ada, ids.teamAda, ids.teamOther],
		);
	});

	it("exports the organization vehicles assigned to the employee or her teams, archived ones too", async () => {
		for (const kind of ["employee", "admin"] as const) {
			const collected = await employmentCollector.collect(db, scopeOf(kind));
			expect(table(collected, "assigned_vehicles"), kind).toEqual([
				{
					vehicle: "Caddy 1",
					licence_plate: "M AB 1",
					archived: false,
					assignment_type: "employee",
					team: null,
					assigned_at: "2026-08-01T08:00:00Z",
					assigned_by: "Olga Owner",
				},
				{
					vehicle: "Sprinter 2",
					licence_plate: "M AB 2",
					archived: true,
					assignment_type: "team",
					team: "Platform",
					assigned_at: "2026-08-02T08:00:00Z",
					assigned_by: "Olga Owner",
				},
			]);
			const text = JSON.stringify(table(collected, "assigned_vehicles"));
			expect(text, kind).not.toContain("Secret van");
			expect(text, kind).not.toContain(ids.vanSecret);
		}
	});

	afterAll(cleanup);

	it("exports the holidays and holiday categories assigned to the employee, her team or the organization", async () => {
		const collected = await employmentCollector.collect(db, scopeOf("employee"));
		const holidayRows = table(collected, "policy_assignments")
			.filter((row) => String(row.policy_kind).startsWith("holiday"))
			.map((row) => [row.policy_kind, row.policy, row.assignment_type, row.team]);
		expect(holidayRows).toEqual([
			["holiday_assignment", "Founders day", "employee", null],
			["holiday_assignment", "Platform day", "team", "Platform"],
			["holiday_category", "Company days", "employee", null],
		]);
		const text = JSON.stringify(table(collected, "policy_assignments"));
		for (const leaked of ["Secret team day", "Secret days"]) {
			expect(text, leaked).not.toContain(leaked);
		}
	});

	it("names other teams in the employee's team permissions instead of their ids", async () => {
		const collected = await employmentCollector.collect(db, scopeOf("employee"));
		expect(table(collected, "team_permissions")).toEqual([
			expect.objectContaining({
				team: "Secret Team",
				can_manage_team_members: true,
				granted_by: "Olga Owner",
			}),
		]);
		expect(JSON.stringify(collected)).not.toContain(ids.teamOther);
	});

	it("exports the departure history with actor names, review events in the admin export only", async () => {
		const own = await employmentCollector.collect(db, scopeOf("employee"));
		expect(table(own, "departure_events")).toEqual([
			{
				departure_id: ids.departure,
				kind: "departure_scheduled",
				revision: 1,
				occurred_at: "2026-10-01T08:00:00Z",
				actor: "Olga Owner",
			},
		]);

		const byAdmin = await employmentCollector.collect(db, scopeOf("admin"));
		expect(table(byAdmin, "departure_events").map((row) => row.kind)).toEqual([
			"departure_scheduled",
			"review_resolved",
		]);
		for (const collected of [own, byAdmin]) {
			const text = JSON.stringify(collected);
			for (const leaked of [
				"event-meta-t811e",
				"event-result-t811e",
				"event-fp-t811e",
				"review-content-t811e",
			]) {
				expect(text, leaked).not.toContain(leaked);
			}
		}
	});

	it("exports the employee's go-live exclusions with their reason, without anyone's name (#1513)", async () => {
		await admin.query(
			`insert into go_live_exclusion
			   (organization_id, employee_id, reason, created_at, created_by, lifted_at, lifted_by)
			 values
			   ($1, $2, 'Pilot without the platform team', '2026-05-01T08:00:00Z', 't811e-olga',
			    '2026-05-20T08:00:00Z', 't811e-olga'),
			   ($1, $2, 'Director, does not track time', '2026-06-01T08:00:00Z', 't811e-olga', null, null),
			   ($1, $3, 'Olga-only exclusion t811e', '2026-06-01T08:00:00Z', 't811e-ada', null, null)`,
			[ORG, ids.ada, ids.olga],
		);

		for (const kind of ["employee", "admin"] as const) {
			const collected = await employmentCollector.collect(db, scopeOf(kind));
			expect(table(collected, "go_live_exclusions")).toEqual([
				{
					reason: "Pilot without the platform team",
					created_at: "2026-05-01T08:00:00Z",
					lifted_at: "2026-05-20T08:00:00Z",
					ended_at: null,
				},
				{
					reason: "Director, does not track time",
					created_at: "2026-06-01T08:00:00Z",
					lifted_at: null,
					ended_at: null,
				},
			]);
			expect(JSON.stringify(table(collected, "go_live_exclusions"))).not.toContain("Olga");
		}
	});
});
