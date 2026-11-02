/**
 * #1517: the go-live rehearsal on real rows. For one checked member it traces their work policy,
 * how each covered approval kind would route and their payroll prerequisites, through the same
 * resolution the go-live checks use, and writes nothing.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { rehearseGoLiveMember } from "./rehearsal";
import type { GoLiveRehearsal, GoLiveRehearsalKind } from "./rehearsal-types";
import { goLiveAsOf, runGoLiveChecks } from "./run";
import { type GoLiveFixLinkResolver, goLiveMemberKey } from "./types";

const AS_OF = goLiveAsOf(parseInstant("2026-06-15T10:00:00Z"), "Europe/Berlin");
const allowEveryLink: GoLiveFixLinkResolver = (href, label) => ({ href, label });

describe("go-live rehearsal (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	let fixture: LifecycleDatabaseFixture;
	let db: DatabaseClient;
	let organizationId: string;
	let owner: { employeeId: string; userId: string };

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		db = fixture.db as unknown as DatabaseClient;
	});

	afterAll(async () => {
		await fixture?.close();
	});

	beforeEach(async () => {
		organizationId = await fixture.createOrganization();
		owner = await fixture.seedEmployee({ organizationId, role: "owner" });
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);

	async function seed(
		input: { role?: "employee" | "manager" | "admin"; teamId?: string; name?: string } = {},
	) {
		const seeded = await fixture.seedEmployee({ organizationId });
		await sql(`update employee set role = $1, team_id = $2 where id = $3`, [
			input.role ?? "employee",
			input.teamId ?? null,
			seeded.employeeId,
		]);
		if (input.name)
			await sql(`update "user" set name = $1 where id = $2`, [input.name, seeded.userId]);
		if (input.teamId) {
			await sql(
				`insert into team_membership (organization_id, team_id, employee_id) values ($1, $2, $3)`,
				[organizationId, input.teamId, seeded.employeeId],
			);
		}
		return seeded;
	}

	async function createTeam(name: string, primaryManagerId: string | null = null) {
		const { rows } = await sql(
			`insert into team (organization_id, name, primary_manager_id, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[organizationId, name, primaryManagerId],
		);
		return rows[0].id as string;
	}

	async function managedBy(employeeId: string, managerId: string) {
		await sql(
			`insert into employee_managers (employee_id, manager_id, is_primary, assigned_by)
			 values ($1, $2, true, $3)`,
			[employeeId, managerId, owner.userId],
		);
	}

	async function category(requiresApproval = true, name = `Category ${randomUUID()}`) {
		const { rows } = await sql(
			`insert into absence_category (organization_id, type, name, requires_approval, updated_at)
			 values ($1, 'vacation', $2, $3, now()) returning id`,
			[organizationId, name, requiresApproval],
		);
		return rows[0].id as string;
	}

	async function changePolicy() {
		const { rows } = await sql(
			`insert into change_policy (organization_id, name, self_service_days, approval_days, no_approval_required, created_by, updated_at)
			 values ($1, $2, 0, 7, false, $3, now()) returning id`,
			[organizationId, `Changes ${randomUUID()}`, owner.userId],
		);
		await sql(
			`insert into change_policy_assignment
			 (policy_id, organization_id, assignment_type, priority, created_by, updated_at)
			 values ($1, $2, 'organization', 0, $3, now())`,
			[rows[0].id, organizationId, owner.userId],
		);
	}

	/** A simple weekly schedule on weekdays, assigned to a team or the organization. */
	async function workPolicy(
		name: string,
		target: { type: "organization" } | { type: "team"; teamId: string },
		hoursPerWeek = "40.00",
	) {
		const { rows } = await sql(
			`insert into work_policy (organization_id, name, created_by, updated_at)
			 values ($1, $2, $3, now()) returning id`,
			[organizationId, name, owner.userId],
		);
		const policyId = rows[0].id as string;
		await sql(
			`insert into work_policy_schedule (policy_id, schedule_cycle, schedule_type, working_days_preset, hours_per_cycle, updated_at)
			 values ($1, 'weekly', 'simple', 'weekdays', $2, now())`,
			[policyId, hoursPerWeek],
		);
		await sql(
			`insert into work_policy_assignment
			 (policy_id, organization_id, assignment_type, team_id, priority, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, $6, now())`,
			[
				policyId,
				organizationId,
				target.type,
				target.type === "team" ? target.teamId : null,
				target.type === "team" ? 1 : 0,
				owner.userId,
			],
		);
		return policyId;
	}

	async function rehearse(memberKey: string): Promise<GoLiveRehearsal> {
		const result = await rehearseGoLiveMember(db, {
			organizationId,
			asOf: AS_OF,
			memberKey,
			fixLink: allowEveryLink,
		});
		if (!result.ok) throw new Error(`refused: ${result.refusal}`);
		return result.rehearsal;
	}

	function kind(rehearsal: GoLiveRehearsal, name: GoLiveRehearsalKind["kind"]) {
		const found = rehearsal.approvals.kinds.find((entry) => entry.kind === name);
		if (!found) throw new Error(`${name} not traced`);
		return found;
	}

	const approverIdsOf = (entry: GoLiveRehearsalKind) =>
		entry.variants.flatMap(({ route }) =>
			(route?.stages ?? []).flatMap((stage) => stage.approvers.map((person) => person.employeeId)),
		);

	it("shows a team member's team policy and their team manager deciding every covered kind", async () => {
		const manager = await seed({ role: "manager", name: "Mia Manager" });
		await managedBy(manager.employeeId, owner.employeeId);
		const floor = await createTeam("Floor", manager.employeeId);
		await workPolicy("Floor hours", { type: "team", teamId: floor });
		await category(true, "Vacation");
		await changePolicy();
		const subject = await seed({ teamId: floor, name: "Sam Subject" });

		const rehearsal = await rehearse(`employee:${subject.employeeId}`);

		expect(rehearsal.member).toMatchObject({ kind: "employee", employeeId: subject.employeeId });
		expect(rehearsal.workPolicy).toMatchObject({
			status: "resolved",
			policyName: "Floor hours",
			assignmentType: "team",
			schedule: {
				cycle: "weekly",
				hours: 40,
				workingDays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
			},
		});
		expect(rehearsal.approvals.kinds.map((entry) => entry.kind)).toEqual([
			"absence",
			"time_correction",
			"manual_time_submission",
			"travel_expense",
		]);
		for (const entry of rehearsal.approvals.kinds) {
			expect(entry.status, entry.kind).toBe("routed");
			expect(new Set(approverIdsOf(entry)), entry.kind).toEqual(new Set([manager.employeeId]));
		}
		const stage = kind(rehearsal, "absence").variants[0]?.route?.stages[0];
		expect(stage?.approvers).toEqual([
			{ employeeId: manager.employeeId, displayName: "Mia Manager" },
		]);
		expect(rehearsal.approvals.offKinds).toEqual(["period_submission", "shift_request"]);
	});

	it("shows a built-in skip as needing no approval with its reason, and an unroutable kind with its reason and fix", async () => {
		const loners = await createTeam("Loners");
		await category(false);
		await changePolicy();
		const subject = await seed({ teamId: loners });

		const rehearsal = await rehearse(`employee:${subject.employeeId}`);

		expect(kind(rehearsal, "absence")).toMatchObject({
			status: "skipped",
			reason: {
				key: "settings.implementationChecklist.rehearsal.approvals.skip.noCategoryRequiresApproval",
			},
			fix: null,
		});
		expect(kind(rehearsal, "time_correction")).toMatchObject({
			status: "unroutable",
			reason: {
				key: "settings.implementationChecklist.rehearsal.approvals.unroutable.teamWithoutManager",
				params: { team: "Loners" },
			},
			fix: { href: `/settings/teams/${loners}` },
		});
		expect(rehearsal.workPolicy).toMatchObject({
			status: "none",
			fix: { href: "/settings/work-policies?tab=work&view=assignments" },
		});
	});

	it("traces every canonical stage: a later stage, a departed approver's stand-in and a fallback", async () => {
		await sql(
			`insert into approval_workflow_rollout (organization_id, workflow_type, lifecycle_mode, side_effect_mode, updated_at)
			 values ($1, 'absence', 'canonical', 'canonical', now())`,
			[organizationId],
		);
		await category();
		const admin = await seed({ role: "admin", name: "Ada Admin" });
		const manager = await seed({ role: "manager", name: "Mia Manager" });
		const named = await seed({ role: "manager", name: "Nora Named" });
		const subject = await seed({ name: "Sam Subject" });
		await managedBy(subject.employeeId, manager.employeeId);
		const { rows } = await sql(
			`insert into approval_policy (organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 'Three steps', true, 1, $2, now()) returning id`,
			[organizationId, owner.userId],
		);
		const policyId = rows[0].id as string;
		await sql(
			`insert into approval_policy_condition (organization_id, policy_id, condition_type, operator, value_json, updated_at)
			 values ($1, $2, 'approval_type', 'equals', $3, now())`,
			[organizationId, policyId, JSON.stringify({ value: "absence" })],
		);
		const stages: [number, string, string | null, string][] = [
			[1, "direct_manager", null, "fail"],
			[2, "specific_employee", named.employeeId, "fail"],
			// The manager's manager: nobody, so the organization's admins decide.
			[3, "manager_manager", null, "organization_admin"],
		];
		for (const [order, approverType, approverEmployeeId, fallback] of stages) {
			await sql(
				`insert into approval_policy_stage
				 (organization_id, policy_id, step_order, label, approver_type, approver_employee_id, fallback_behavior, updated_at)
				 values ($1, $2, $3, $4, $5, $6, $7, now())`,
				[
					organizationId,
					policyId,
					order,
					`Step ${order}`,
					approverType,
					approverEmployeeId,
					fallback,
				],
			);
		}
		await sql("update employee set is_active = false, end_date = '2026-05-29' where id = $1", [
			named.employeeId,
		]);
		const { rows: periods } = await sql(
			"select id from employee_employment_period where employee_id = $1 limit 1",
			[named.employeeId],
		);
		await sql(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, replacement_employee_id, revision, status, created_by, request_id,
			  request_fingerprint, effective_at)
			 values ($1, $2, $3, 'scheduled', '2026-05-29', 'Europe/Berlin', '2026-05-29T22:00:00Z',
			  $4, 1, 'effective', $5, $6, 'fingerprint', '2026-05-29T22:00:00Z')`,
			[
				organizationId,
				named.employeeId,
				periods[0]?.id,
				// A stand-in must be able to decide the requester's approvals: their manager.
				manager.employeeId,
				owner.userId,
				randomUUID(),
			],
		);

		const absence = kind(await rehearse(`employee:${subject.employeeId}`), "absence");

		expect(absence.status).toBe("routed");
		const route = absence.variants[0]?.route;
		expect(route).toMatchObject({ path: "canonical", policyName: "Three steps" });
		expect(route?.stages).toEqual([
			expect.objectContaining({
				sequence: 1,
				activates: "at_submission",
				resolution: "human",
				approvers: [{ employeeId: manager.employeeId, displayName: "Mia Manager" }],
				viaFallback: false,
				standsInFor: null,
			}),
			expect.objectContaining({
				sequence: 2,
				activates: "after_earlier_stages",
				resolution: "human",
				approvers: [{ employeeId: manager.employeeId, displayName: "Mia Manager" }],
				viaFallback: false,
				standsInFor: { employeeId: named.employeeId, displayName: "Nora Named" },
			}),
			expect.objectContaining({
				sequence: 3,
				activates: "after_earlier_stages",
				resolution: "human",
				approvers: expect.arrayContaining([
					{ employeeId: admin.employeeId, displayName: "Ada Admin" },
				]),
				viaFallback: true,
			}),
		]);

		// Without a stand-in the later stage finds nobody. The request still starts, as the check says.
		await sql(
			`update employee_departure set replacement_employee_id = null where employee_id = $1`,
			[named.employeeId],
		);
		const unstaffed = kind(await rehearse(`employee:${subject.employeeId}`), "absence");
		expect(unstaffed.status).toBe("routed");
		expect(unstaffed.variants[0]?.route?.stages[1]).toMatchObject({
			resolution: "unresolvable",
			approvers: [],
			standsInFor: { employeeId: named.employeeId },
		});
	});

	it("shows payroll prerequisites only while the organization has an active payroll export target", async () => {
		const subject = await seed();
		expect((await rehearse(`employee:${subject.employeeId}`)).payroll).toBeNull();

		await sql(
			`insert into payroll_export_format (id, name, version, updated_at)
			 values ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()) on conflict (id) do nothing`,
		);
		await sql(
			`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
			 values ($1, 'datev_lohn', $2::jsonb, $3, now())`,
			[
				organizationId,
				JSON.stringify({
					mandantennummer: "12345",
					beraternummer: "1234567",
					includeZeroHours: false,
				}),
				owner.userId,
			],
		);

		const { payroll } = await rehearse(`employee:${subject.employeeId}`);
		expect(payroll).toMatchObject({
			prerequisites: {
				mandatory: true,
				exportTargetCount: 1,
				wageTypeMappings: "missing",
				employmentTerms: "missing",
				personnelIdentifier: { status: "unique" },
			},
			payrollExportFix: { href: "/settings/payroll-export" },
			employeesFix: { href: "/settings/employees" },
		});
	});

	it("agrees with the go-live checks for every member", async () => {
		const manager = await seed({ role: "manager" });
		await managedBy(manager.employeeId, owner.employeeId);
		const staffed = await createTeam("Staffed", manager.employeeId);
		const unstaffed = await createTeam("Unstaffed");
		await workPolicy("Staffed hours", { type: "team", teamId: staffed });
		await category();
		await changePolicy();
		await seed({ teamId: staffed });
		await seed({ teamId: unstaffed });
		await seed();
		await sql(
			`insert into payroll_export_format (id, name, version, updated_at)
			 values ('datev_lohn', 'DATEV Lohn & Gehalt', '2024.1', now()) on conflict (id) do nothing`,
		);
		await sql(
			`insert into payroll_export_config (organization_id, format_id, config, created_by, updated_at)
			 values ($1, 'datev_lohn', $2::jsonb, $3, now())`,
			[
				organizationId,
				JSON.stringify({
					mandantennummer: "12345",
					beraternummer: "1234567",
					includeZeroHours: false,
				}),
				owner.userId,
			],
		);

		const run = await runGoLiveChecks({
			db,
			organizationId,
			asOf: AS_OF,
			fixLink: allowEveryLink,
		});
		const result = (checkId: string) => {
			const found = run.results.find((entry) => entry.checkId === checkId);
			if (!found || found.outcome === "unavailable") throw new Error(`${checkId} unavailable`);
			return found;
		};
		const failingKeys = (checkId: string, causePrefix = "") =>
			new Set(
				result(checkId)
					.failures.filter((group) => (group.cause ?? "").startsWith(causePrefix))
					.flatMap((group) => group.members.map(({ member }) => goLiveMemberKey(member))),
			);
		const members = run.group?.members ?? [];
		expect(members.length).toBe(5);

		for (const member of members) {
			const key = goLiveMemberKey(member);
			const rehearsal = await rehearse(key);
			expect(rehearsal.workPolicy.status === "none", `work policy ${key}`).toBe(
				failingKeys("work-policy").has(key),
			);
			for (const entry of rehearsal.approvals.kinds) {
				const failing = failingKeys("approver", `approver:${entry.kind}:`).has(key);
				expect(entry.status === "unroutable", `${entry.kind} ${key}`).toBe(failing);
			}
			expect(rehearsal.payroll?.prerequisites.wageTypeMappings === "missing").toBe(
				failingKeys("payroll-setup", "payroll-setup:wage-type-mappings").has(key),
			);
		}
		// Both sides found failures, so the agreement is not vacuous.
		expect(failingKeys("work-policy").size).toBeGreaterThan(0);
		expect(failingKeys("approver").size).toBeGreaterThan(0);
	});

	it("refuses former employees, other organizations' employees and unknown ids", async () => {
		const former = await seed();
		await sql("update employee set is_active = false, end_date = '2026-05-29' where id = $1", [
			former.employeeId,
		]);
		const elsewhere = await fixture.createOrganization();
		const outsider = await fixture.seedEmployee({ organizationId: elsewhere });

		for (const memberKey of [
			`employee:${former.employeeId}`,
			`employee:${outsider.employeeId}`,
			`employee:${randomUUID()}`,
			`invitee:${randomUUID()}`,
			"",
		]) {
			await expect(
				rehearseGoLiveMember(db, {
					organizationId,
					asOf: AS_OF,
					memberKey,
					fixLink: allowEveryLink,
				}),
				memberKey,
			).resolves.toEqual({ ok: false, refusal: "member_not_checked" });
		}
	});

	it("leaves no new rows in any table: no work records, approvals, notifications, deliveries or audit entries", async () => {
		await sql(
			`insert into approval_workflow_rollout (organization_id, workflow_type, lifecycle_mode, side_effect_mode, updated_at)
			 values ($1, 'absence', 'canonical', 'canonical', now())`,
			[organizationId],
		);
		await sql(`update organization set shifts_enabled = true where id = $1`, [organizationId]);
		await category();
		await changePolicy();
		const manager = await seed({ role: "manager" });
		await managedBy(manager.employeeId, owner.employeeId);
		const floor = await createTeam("Floor", manager.employeeId);
		await workPolicy("Floor hours", { type: "team", teamId: floor });
		const subject = await seed({ teamId: floor });

		const tables = await everyTable();
		// The count covers where notifications and deliveries would be written.
		expect(tables).toEqual(
			expect.arrayContaining(["notification", "audit_log", "approval_workflow"]),
		);
		expect(tables.some((table) => table.includes("deliver"))).toBe(true);
		const before = await rowCounts(tables);

		const rehearsal = await rehearse(`employee:${subject.employeeId}`);

		expect(kind(rehearsal, "absence").status).toBe("routed");
		expect(await rowCounts(tables)).toEqual(before);
	});

	/** Every table in the public schema. */
	async function everyTable(): Promise<string[]> {
		const { rows } = await sql(
			`select table_name from information_schema.tables
			 where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
		);
		return rows.map((row) => row.table_name as string);
	}

	async function rowCounts(tables: readonly string[]) {
		const counts: Record<string, number> = {};
		for (const table of tables) {
			const { rows } = await sql(`select count(*)::int as count from "${table}"`);
			counts[table] = rows[0].count;
		}
		return counts;
	}
});
