/**
 * #1440 (spec #1437, user decision 2026-10-24): a deactivation also ends the
 * person's team memberships, project assignments and project manager links,
 * each audited under the acting admin and listed in the preview.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuditTrail } from "@/lib/audit-trail";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
	type SeededEmployee,
} from "../testing/database.test.fixture";
import { applyTeamLinks, planTeamLinks } from "./team-links";
import type { DeactivationApplyContext, DeactivationPlanContext } from "./types";

describe("deactivation ends team and project links (#1440)", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	async function team(organizationId: string, name: string) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into team (id, organization_id, name, updated_at) values ($1, $2, $3, now())`,
			[id, organizationId, name],
		);
		return id;
	}

	async function join(teamId: string, person: SeededEmployee, organizationId: string) {
		await fixture.pool.query(
			`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)`,
			[organizationId, teamId, person.employeeId],
		);
	}

	async function project(organizationId: string, name: string) {
		const id = randomUUID();
		await fixture.pool.query(
			`insert into project (id, organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, $4, now())`,
			[id, organizationId, name, fixture.ownerUserId],
		);
		return id;
	}

	async function assign(
		organizationId: string,
		projectId: string,
		target: { employeeId: string } | { teamId: string },
	) {
		await fixture.pool.query(
			`insert into project_assignment
			 (project_id, organization_id, assignment_type, employee_id, team_id, created_by)
			 values ($1, $2, $3, $4, $5, $6)`,
			[
				projectId,
				organizationId,
				"employeeId" in target ? "employee" : "team",
				"employeeId" in target ? target.employeeId : null,
				"teamId" in target ? target.teamId : null,
				fixture.ownerUserId,
			],
		);
	}

	async function manage(projectId: string, person: SeededEmployee) {
		await fixture.pool.query(
			`insert into project_manager (project_id, employee_id, assigned_by) values ($1, $2, $3)`,
			[projectId, person.employeeId, fixture.ownerUserId],
		);
	}

	async function setting() {
		const organizationId = await fixture.createOrganization();
		const leaver = await fixture.seedEmployee({ organizationId });
		const colleague = await fixture.seedEmployee({ organizationId });
		const kitchen = await team(organizationId, "Kitchen");
		const bar = await team(organizationId, "Bar");
		await join(kitchen, leaver, organizationId);
		await join(bar, leaver, organizationId);
		await join(kitchen, colleague, organizationId);
		await fixture.pool.query(`update employee set team_id = $2 where id = $1`, [
			leaver.employeeId,
			bar,
		]);
		const website = await project(organizationId, "Website");
		const audit = await project(organizationId, "Audit");
		await assign(organizationId, website, { employeeId: leaver.employeeId });
		await assign(organizationId, website, { employeeId: colleague.employeeId });
		await assign(organizationId, audit, { teamId: kitchen });
		await manage(audit, leaver);
		await manage(audit, colleague);
		return { organizationId, leaver, colleague, kitchen, bar, website, audit };
	}

	function contexts(organizationId: string, leaver: SeededEmployee) {
		const plan: DeactivationPlanContext = {
			organizationId,
			employeeId: leaver.employeeId,
			at: parseInstant("2026-10-24T09:00:00Z"),
			organizationTimeZone: "Europe/Berlin",
			employmentPeriodId: leaver.employmentPeriodId,
			replacementManagers: {},
			replaceManagers: true,
		};
		const apply: DeactivationApplyContext = {
			...plan,
			actorUserId: fixture.ownerUserId,
			deactivationId: randomUUID(),
			reason: "employee_deactivated",
			audit: new AuditTrail(),
		};
		return { plan, apply };
	}

	it("plans the person's teams, own project assignments and project manager links", async () => {
		const s = await setting();

		const plan = await planTeamLinks(fixture.db, contexts(s.organizationId, s.leaver).plan);

		expect(plan).toEqual({
			teams: [
				{ teamId: s.bar, name: "Bar" },
				{ teamId: s.kitchen, name: "Kitchen" },
			],
			// The Kitchen team's assignment to Audit is the team's, not the person's.
			projectAssignments: [{ projectId: s.website, name: "Website" }],
			projectManagerLinks: [{ projectId: s.audit, name: "Audit" }],
		});
	});

	it("ends exactly those links, clears the primary team and audits each change", async () => {
		const s = await setting();
		const { plan: planContext, apply } = contexts(s.organizationId, s.leaver);
		const plan = await planTeamLinks(fixture.db, planContext);

		const result = await fixture.db.transaction((tx) => applyTeamLinks(tx, apply, plan));

		expect(result).toEqual({
			applied: {
				teamIds: [s.bar, s.kitchen],
				projectAssignmentProjectIds: [s.website],
				projectManagerProjectIds: [s.audit],
			},
			afterCommit: [],
		});
		const memberships = await fixture.pool.query(
			`select team_id, employee_id from team_membership where organization_id = $1`,
			[s.organizationId],
		);
		expect(memberships.rows).toEqual([{ team_id: s.kitchen, employee_id: s.colleague.employeeId }]);
		const primaryTeam = await fixture.pool.query(`select team_id from employee where id = $1`, [
			s.leaver.employeeId,
		]);
		expect(primaryTeam.rows[0]?.team_id).toBeNull();
		const assignments = await fixture.pool.query(
			`select project_id, employee_id, team_id from project_assignment
			 where organization_id = $1 order by project_id`,
			[s.organizationId],
		);
		expect(assignments.rows).toEqual(
			expect.arrayContaining([
				{ project_id: s.website, employee_id: s.colleague.employeeId, team_id: null },
				{ project_id: s.audit, employee_id: null, team_id: s.kitchen },
			]),
		);
		expect(assignments.rows).toHaveLength(2);
		const managers = await fixture.pool.query(
			`select project_id, employee_id from project_manager where project_id = any($1::uuid[])`,
			[[s.website, s.audit]],
		);
		expect(managers.rows).toEqual([{ project_id: s.audit, employee_id: s.colleague.employeeId }]);
		// The assignment's history interval closes, as for any removal (#605).
		const history = await fixture.pool.query(
			`select effective_to from project_assignment_history
			 where organization_id = $1 and employee_id = $2`,
			[s.organizationId, s.leaver.employeeId],
		);
		expect(history.rows).toHaveLength(1);
		expect(history.rows[0]?.effective_to).not.toBeNull();

		const audits = await fixture.pool.query<{
			action: string;
			entity_type: string;
			entity_id: string;
			employee_id: string;
			performed_by: string;
			metadata: string;
		}>(
			`select action, entity_type, entity_id, employee_id, performed_by, metadata from audit_log
			 where organization_id = $1 order by action, entity_id`,
			[s.organizationId],
		);
		expect(
			audits.rows.map((row) => ({
				action: row.action,
				entityType: row.entity_type,
				entityId: row.entity_id,
				employeeId: row.employee_id,
				performedBy: row.performed_by,
				metadata: JSON.parse(row.metadata),
			})),
		).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: "team.member_removed",
					entityType: "team",
					entityId: s.bar,
					employeeId: s.leaver.employeeId,
					performedBy: fixture.ownerUserId,
					metadata: expect.objectContaining({
						reason: "employee_deactivated",
						deactivationId: apply.deactivationId,
						teamName: "Bar",
					}),
				}),
				expect.objectContaining({ action: "team.member_removed", entityId: s.kitchen }),
				expect.objectContaining({
					action: "project.assignment_removed",
					entityType: "project_assignment",
					entityId: s.website,
					employeeId: s.leaver.employeeId,
					metadata: expect.objectContaining({
						reason: "employee_deactivated",
						deactivationId: apply.deactivationId,
						assignmentType: "employee",
					}),
				}),
				expect.objectContaining({
					action: "project.manager_removed",
					entityType: "project",
					entityId: s.audit,
					metadata: expect.objectContaining({
						reason: "employee_deactivated",
						deactivationId: apply.deactivationId,
					}),
				}),
			]),
		);
		expect(audits.rows).toHaveLength(4);

		// Nothing is left to end.
		expect(await planTeamLinks(fixture.db, planContext)).toEqual({
			teams: [],
			projectAssignments: [],
			projectManagerLinks: [],
		});
	});

	it("changes nothing when the person has no links", async () => {
		const organizationId = await fixture.createOrganization();
		const loner = await fixture.seedEmployee({ organizationId });
		const { plan: planContext, apply } = contexts(organizationId, loner);
		const plan = await planTeamLinks(fixture.db, planContext);

		const result = await fixture.db.transaction((tx) => applyTeamLinks(tx, apply, plan));

		expect(result.applied).toEqual({
			teamIds: [],
			projectAssignmentProjectIds: [],
			projectManagerProjectIds: [],
		});
	});
});
