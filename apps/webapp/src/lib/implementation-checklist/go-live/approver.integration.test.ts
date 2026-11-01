/**
 * #1514: the approver go-live check on real rows. Every covered kind is resolved the way its
 * request path would route it now (canonical dry run or the legacy resolution), built-in skips
 * pass with a note, and nothing is written.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Pass-through, except where a case makes the stage resolver throw as a lost connection would.
const resolverFailure = vi.hoisted(() => ({ throws: false }));
vi.mock("@/lib/approvals/routing/stage-activation-resolver", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@/lib/approvals/routing/stage-activation-resolver")>();
	return {
		...actual,
		createDatabaseStageActivationResolver: (
			...args: Parameters<typeof actual.createDatabaseStageActivationResolver>
		) => {
			const resolver = actual.createDatabaseStageActivationResolver(...args);
			return {
				resolve: async (input: Parameters<typeof resolver.resolve>[0]) => {
					if (resolverFailure.throws) throw new Error("connection terminated");
					return resolver.resolve(input);
				},
			};
		},
	};
});

import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { resolveImplementationChecklistItems } from "../status";
import { type ApproverGoLiveKind, loadApproverRouting } from "./approver-routing";
import { approverGoLiveCheck } from "./checks/approver";
import { resolveGoLiveGroup } from "./group";
import { goLiveAsOf, runGoLiveChecks } from "./run";
import type {
	GoLiveCheckResult,
	GoLiveFailureGroup,
	GoLiveFixLinkResolver,
	GoLiveGroup,
	GoLiveMember,
} from "./types";

const AS_OF = goLiveAsOf(parseInstant("2026-06-15T10:00:00Z"), "Europe/Berlin");
const allowEveryLink: GoLiveFixLinkResolver = (href, label) => ({ href, label });

type Passed = Extract<GoLiveCheckResult, { outcome: "passed" | "failed" }>;

describe("approver go-live check (PostgreSQL)", () => {
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
		resolverFailure.throws = false;
		organizationId = await fixture.createOrganization();
		owner = await fixture.seedEmployee({ organizationId, role: "owner" });
	});

	const sql = (text: string, values: unknown[] = []) => fixture.pool.query(text, values);
	// Policy priorities are unique per organization.
	let policyPriority = 0;

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

	/** Every organization employee gets this manager, so only the case's subject can fail. */
	async function everyoneManagedBy(managerId: string) {
		const { rows } = await sql(`select id from employee where organization_id = $1 and id <> $2`, [
			organizationId,
			managerId,
		]);
		for (const row of rows) await managedBy(row.id, managerId);
	}

	async function category(requiresApproval = true) {
		const { rows } = await sql(
			`insert into absence_category (organization_id, type, name, requires_approval, updated_at)
			 values ($1, 'vacation', $2, $3, now()) returning id`,
			[organizationId, `Category ${randomUUID()}`, requiresApproval],
		);
		return rows[0].id as string;
	}

	async function rollout(workflowType: string, mode: string) {
		await sql(
			`insert into approval_workflow_rollout (organization_id, workflow_type, lifecycle_mode, side_effect_mode, updated_at)
			 values ($1, $2, $3, $4, now())`,
			[organizationId, workflowType, mode, mode === "legacy" ? "legacy" : "canonical"],
		);
	}

	async function policy(input: {
		name: string;
		approvalType?: string;
		teamId?: string;
		stage: { approverType: string; approverEmployeeId?: string; fallback?: string };
		amountMin?: number;
	}) {
		policyPriority += 1;
		const { rows } = await sql(
			`insert into approval_policy (organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, $2, true, $3, $4, now()) returning id`,
			[organizationId, input.name, policyPriority, owner.userId],
		);
		const policyId = rows[0].id as string;
		if (input.approvalType) {
			await sql(
				`insert into approval_policy_condition (organization_id, policy_id, condition_type, operator, value_json, updated_at)
				 values ($1, $2, 'approval_type', 'equals', $3, now())`,
				[organizationId, policyId, JSON.stringify({ value: input.approvalType })],
			);
		}
		if (input.teamId) {
			await sql(
				`insert into approval_policy_condition (organization_id, policy_id, condition_type, operator, value_json, team_id, updated_at)
				 values ($1, $2, 'team', 'equals', $3, $4, now())`,
				[organizationId, policyId, JSON.stringify({ value: input.teamId }), input.teamId],
			);
		}
		if (input.amountMin !== undefined) {
			await sql(
				`insert into approval_policy_condition (organization_id, policy_id, condition_type, operator, amount_min, updated_at)
				 values ($1, $2, 'travel_expense_amount', 'gte', $3, now())`,
				[organizationId, policyId, input.amountMin],
			);
		}
		await sql(
			`insert into approval_policy_stage
			 (organization_id, policy_id, step_order, label, approver_type, approver_employee_id, fallback_behavior, updated_at)
			 values ($1, $2, 1, 'Stage', $3, $4, $5, now())`,
			[
				organizationId,
				policyId,
				input.stage.approverType,
				input.stage.approverEmployeeId ?? null,
				input.stage.fallback ?? "fail",
			],
		);
		return policyId;
	}

	async function changePolicy(input: {
		target:
			| { type: "organization" }
			| { type: "team"; teamId: string }
			| { type: "employee"; employeeId: string };
		noApprovalRequired?: boolean;
		approvalDays?: number;
	}) {
		const { rows } = await sql(
			`insert into change_policy (organization_id, name, self_service_days, approval_days, no_approval_required, created_by, updated_at)
			 values ($1, $2, 0, $3, $4, $5, now()) returning id`,
			[
				organizationId,
				`Changes ${randomUUID()}`,
				input.approvalDays ?? 7,
				input.noApprovalRequired ?? false,
				owner.userId,
			],
		);
		await sql(
			`insert into change_policy_assignment
			 (policy_id, organization_id, assignment_type, team_id, employee_id, priority, created_by, updated_at)
			 values ($1, $2, $3, $4, $5, 0, $6, now())`,
			[
				rows[0].id,
				organizationId,
				input.target.type,
				input.target.type === "team" ? input.target.teamId : null,
				input.target.type === "employee" ? input.target.employeeId : null,
				owner.userId,
			],
		);
	}

	async function departed(employeeId: string, replacementEmployeeId: string | null) {
		await sql("update employee set is_active = false, end_date = '2026-05-29' where id = $1", [
			employeeId,
		]);
		const { rows } = await sql(
			"select id from employee_employment_period where employee_id = $1 limit 1",
			[employeeId],
		);
		await sql(
			`insert into employee_departure
			 (organization_id, employee_id, employment_period_id, mode, last_working_day, timezone,
			  cutoff_at, replacement_employee_id, revision, status, created_by, request_id,
			  request_fingerprint, effective_at)
			 values ($1, $2, $3, 'scheduled', '2026-05-29', 'Europe/Berlin', '2026-05-29T22:00:00Z',
			  $4, 1, 'effective', $5, $6, 'fingerprint', '2026-05-29T22:00:00Z')`,
			[organizationId, employeeId, rows[0]?.id, replacementEmployeeId, owner.userId, randomUUID()],
		);
	}

	/** The check over the organization's go-live group, or over a given group (invitees). */
	async function check(group?: GoLiveGroup): Promise<GoLiveCheckResult> {
		if (group) {
			const outcome = await approverGoLiveCheck.run({
				db,
				organizationId,
				asOf: AS_OF,
				group,
				fixLink: allowEveryLink,
			});
			return {
				...outcome,
				checkId: "approver",
				itemId: "approval-rules",
				severity: "mandatory",
				checkedMemberCount: group.members.length,
			};
		}
		const { results } = await runGoLiveChecks({
			db,
			organizationId,
			asOf: AS_OF,
			fixLink: allowEveryLink,
			checks: [approverGoLiveCheck],
		});
		const [result] = results;
		if (!result) throw new Error("approver check did not run");
		return result;
	}

	function passedOrFailed(result: GoLiveCheckResult): Passed {
		if (result.outcome === "unavailable") throw new Error("check was unavailable");
		return result;
	}

	function failure(result: GoLiveCheckResult, cause: string): GoLiveFailureGroup | undefined {
		return passedOrFailed(result).failures.find((group) => group.cause === cause);
	}

	const ids = (group: GoLiveFailureGroup | undefined) =>
		(group?.members ?? [])
			.map(({ member }) => (member.kind === "employee" ? member.employeeId : member.draftId))
			.sort();

	const noteKeys = (result: GoLiveCheckResult) =>
		passedOrFailed(result).notes.map((note) => note.key);

	async function kindStatus(employeeId: string, kind: ApproverGoLiveKind) {
		const group = await resolveGoLiveGroup(db, organizationId, AS_OF);
		return db.transaction(async (tx) => {
			const routing = await loadApproverRouting(tx as unknown as DatabaseClient, {
				organizationId,
				asOf: AS_OF,
				members: group.members,
			});
			const member = group.members.find(
				(candidate): candidate is Extract<GoLiveMember, { kind: "employee" }> =>
					candidate.kind === "employee" && candidate.employeeId === employeeId,
			);
			if (!member) throw new Error("not in the group");
			return (await routing.resolve(member)).get(kind);
		});
	}

	it("groups members of a team without an eligible manager under each kind, with the team fix", async () => {
		const warehouse = await createTeam("Warehouse");
		const admin = await seed({ role: "admin" });
		await managedBy(owner.employeeId, admin.employeeId);
		await managedBy(admin.employeeId, owner.employeeId);
		await category();
		await changePolicy({ target: { type: "organization" } });
		const picker = await seed({ teamId: warehouse });
		const packer = await seed({ teamId: warehouse });

		const result = await check();

		expect(result).toMatchObject({ outcome: "failed", configured: true, checkedMemberCount: 4 });
		const absence = failure(result, `approver:absence:no-manager:team:${warehouse}`);
		expect(ids(absence)).toEqual([picker.employeeId, packer.employeeId].sort());
		expect(absence?.reason).toMatchObject({
			key: "settings.implementationChecklist.goLive.approver.teamWithoutManager",
			params: { kind: "absence", team: "Warehouse", count: 2 },
		});
		expect(absence?.fix?.href).toBe(`/settings/teams/${warehouse}`);
		// The same members appear under every kind that fails for them.
		expect(ids(failure(result, `approver:time_correction:no-manager:team:${warehouse}`))).toEqual(
			ids(absence),
		);
		expect(ids(failure(result, `approver:travel_expense:no-manager:team:${warehouse}`))).toEqual(
			ids(absence),
		);
		const items = resolveImplementationChecklistItems({
			detectedCompleteIds: new Set(),
			manualCompleteIds: new Set(),
			goLiveResults: [result],
		});
		expect(items.find((item) => item.id === "approval-rules")?.status).toBe("needs-attention");
	});

	it("verifies when everyone has an eligible manager, and notes the kinds that are off", async () => {
		const manager = await seed({ role: "manager" });
		await managedBy(manager.employeeId, owner.employeeId);
		await category();
		await seed();
		await everyoneManagedBy(manager.employeeId);
		await sql(`delete from employee_managers where employee_id = $1`, [manager.employeeId]);
		await managedBy(manager.employeeId, owner.employeeId);

		const result = await check();

		expect(passedOrFailed(result).failures).toEqual([]);
		expect(result.outcome).toBe("passed");
		expect(noteKeys(result)).toEqual(
			expect.arrayContaining([
				"settings.implementationChecklist.goLive.approver.periodSubmissionsOff",
				"settings.implementationChecklist.goLive.approver.shiftsOff",
			]),
		);
		expect(
			resolveImplementationChecklistItems({
				detectedCompleteIds: new Set(),
				manualCompleteIds: new Set(["approval-rules"]),
				goLiveResults: [result],
			}).find((item) => item.id === "approval-rules"),
		).toMatchObject({ status: "verified", completionSource: "manual" });
	});

	it("passes built-in skips with a note: change policy, own approver, no approval category, owner self-approval", async () => {
		// The owner (an admin employee) has nobody else: their expense reports self-approve.
		const trusted = await createTeam("Trusted");
		const selfManaged = await createTeam("Leads");
		await changePolicy({ target: { type: "organization" }, approvalDays: 0 });
		await changePolicy({ target: { type: "team", teamId: trusted }, noApprovalRequired: true });
		await category(false);
		const lead = await seed({ role: "manager", teamId: selfManaged });
		await sql(`update team set primary_manager_id = $1 where id = $2`, [
			lead.employeeId,
			selfManaged,
		]);
		const relaxed = await seed({ teamId: trusted });
		await managedBy(relaxed.employeeId, lead.employeeId);

		const result = await check();

		expect(noteKeys(result)).toEqual(
			expect.arrayContaining([
				"settings.implementationChecklist.goLive.approver.skipNoCategoryRequiresApproval",
				"settings.implementationChecklist.goLive.approver.skipSelfService",
				"settings.implementationChecklist.goLive.approver.skipTrustMode",
				"settings.implementationChecklist.goLive.approver.skipOwnerAdmin",
				"settings.implementationChecklist.goLive.approver.skipOwnApprover",
				"settings.implementationChecklist.goLive.approver.skipOwnerSelfApproval",
			]),
		);
		expect(await kindStatus(lead.employeeId, "manual_time_submission")).toMatchObject({
			status: "skipped",
			reason: "requester_is_approver",
		});
		expect(await kindStatus(relaxed.employeeId, "time_correction")).toMatchObject({
			status: "skipped",
			reason: "change_policy_trust_mode",
		});
		expect(await kindStatus(owner.employeeId, "travel_expense")).toMatchObject({
			status: "skipped",
			reason: "owner_self_approval",
		});
		// A report never goes to its requester: the lead, their team's own manager, has no reviewer.
		expect(ids(failure(result, `approver:travel_expense:no-manager:team:${selfManaged}`))).toEqual([
			lead.employeeId,
		]);
		const note = passedOrFailed(result).notes.find(
			(entry) => entry.key === "settings.implementationChecklist.goLive.approver.skipTrustMode",
		);
		expect(note?.params).toEqual({ kind: "timeCorrection", count: 1 });
	});

	it("routes a legacy policy as legacy does: a departed named approver is not replaced", async () => {
		const manager = await seed({ role: "manager" });
		const named = await seed({ role: "manager" });
		await managedBy(manager.employeeId, owner.employeeId);
		await changePolicy({ target: { type: "organization" } });
		await category();
		const subject = await seed();
		await everyoneManagedBy(manager.employeeId);
		const policyId = await policy({
			name: "Corrections",
			approvalType: "time_entry",
			stage: { approverType: "specific_employee", approverEmployeeId: named.employeeId },
		});
		await policy({
			name: "Absences",
			approvalType: "absence_entry",
			stage: { approverType: "specific_employee", approverEmployeeId: named.employeeId },
		});
		await departed(named.employeeId, manager.employeeId);

		const result = await check();

		const group = failure(result, `approver:time_correction:policy:${policyId}`);
		expect(ids(group)).toContain(subject.employeeId);
		expect(group?.reason).toMatchObject({
			key: "settings.implementationChecklist.goLive.approver.policyWithoutApprover",
			params: { kind: "timeCorrection", policy: "Corrections" },
		});
		expect(group?.fix?.href).toBe("/settings/approval-policies");
		// Legacy absences fall back to the default approver when a policy can't route.
		const absence = await kindStatus(subject.employeeId, "absence");
		expect(absence).toMatchObject({ status: "routed" });
		expect(absence?.variants[0]?.result).toMatchObject({
			route: { path: "legacy", policy: null, defaultApproverEmployeeId: manager.employeeId },
		});
	});

	it("dry-runs a canonical kind: a departed named approver goes to their replacement, or fails without one", async () => {
		await rollout("absence", "canonical");
		await category();
		const manager = await seed({ role: "manager" });
		const named = await seed({ role: "manager" });
		await managedBy(manager.employeeId, owner.employeeId);
		const subject = await seed();
		await managedBy(subject.employeeId, manager.employeeId);
		const policyId = await policy({
			name: "Absences",
			approvalType: "absence",
			stage: { approverType: "specific_employee", approverEmployeeId: named.employeeId },
		});
		await departed(named.employeeId, manager.employeeId);

		const routed = await kindStatus(subject.employeeId, "absence");
		expect(routed).toMatchObject({ status: "routed" });
		expect(routed?.variants[0]?.result).toMatchObject({
			status: "routed",
			route: {
				path: "canonical",
				policy: { id: policyId, name: "Absences" },
				stages: [{ approverEmployeeIds: [manager.employeeId], activation: "human" }],
			},
		});

		await sql(
			`update employee_departure set replacement_employee_id = null where employee_id = $1`,
			[named.employeeId],
		);
		const result = await check();
		expect(ids(failure(result, `approver:absence:policy:${policyId}`))).toContain(
			subject.employeeId,
		);
	});

	it.each(["legacy", "canonical"] as const)(
		"routes time corrections and work-period submissions on the %s path",
		async (mode) => {
			if (mode === "canonical") {
				await rollout("time_correction", "canonical");
				await rollout("manual_time_submission", "complete");
			}
			await changePolicy({ target: { type: "organization" } });
			const manager = await seed({ role: "manager" });
			const team = await createTeam("Floor", manager.employeeId);
			const covered = await seed({ teamId: team });
			const uncovered = await seed();

			const result = await check();

			for (const kind of ["time_correction", "manual_time_submission"] as const) {
				const resolution = await kindStatus(covered.employeeId, kind);
				expect(resolution).toMatchObject({ status: "routed" });
				expect(resolution?.variants[0]?.result).toMatchObject({
					route: {
						path: mode,
						stages: [{ approverEmployeeIds: [manager.employeeId], activation: "human" }],
					},
				});
				expect(ids(failure(result, `approver:${kind}:no-manager:no-team`))).toContain(
					uncovered.employeeId,
				);
			}
		},
	);

	it("checks period submissions only while a cadence is on, and shift requests only while shifts are on", async () => {
		await sql(`update employee set role = 'employee' where id = $1`, [owner.employeeId]);
		const subject = await seed();
		await sql(
			`insert into period_submission_cadence_change (id, organization_id, cadence, week_start_day, changed_at)
			 values ($1, $2, 'weekly', 'monday', '2026-01-01T00:00:00Z')`,
			[randomUUID(), organizationId],
		);
		await sql(`update organization set shifts_enabled = true where id = $1`, [organizationId]);

		const result = await check();

		expect(ids(failure(result, "approver:period_submission:no-manager:no-team"))).toContain(
			subject.employeeId,
		);
		const shifts = failure(result, "approver:shift_request:no-decider");
		expect(ids(shifts)).toEqual([owner.employeeId, subject.employeeId].sort());
		expect(noteKeys(result)).not.toContain(
			"settings.implementationChecklist.goLive.approver.periodSubmissionsOff",
		);

		// A period submission outside complete mode can't be submitted at all.
		await rollout("period_submission", "canonical");
		expect(
			failure(await check(), "approver:period_submission:approval-mode-unsupported"),
		).toBeDefined();
	});

	it("fails expense reports in a canonical mode, and checks every amount band", async () => {
		const manager = await seed({ role: "manager" });
		const named = await seed({ role: "manager" });
		await managedBy(manager.employeeId, owner.employeeId);
		const subject = await seed();
		await everyoneManagedBy(manager.employeeId);
		const policyId = await policy({
			name: "Large reports",
			approvalType: "travel_expense_claim",
			amountMin: 500,
			stage: { approverType: "specific_employee", approverEmployeeId: named.employeeId },
		});
		await sql(`update employee set is_active = false where id = $1`, [named.employeeId]);

		const banded = await kindStatus(subject.employeeId, "travel_expense");
		expect(banded).toMatchObject({
			status: "unroutable",
			cause: { code: "policy_unresolvable", policyId },
		});
		expect(banded?.variants.map(({ variant }) => variant.travelExpenseAmount)).toEqual([
			0, 250, 500, 501,
		]);

		await rollout("travel_expense", "canonical");
		const result = await check();
		expect(ids(failure(result, "approver:travel_expense:approval-mode-unsupported"))).toContain(
			subject.employeeId,
		);
	});

	it("fails an expense policy that routes a report to its own requester", async () => {
		const leads = await createTeam("Leads");
		const lead = await seed({ role: "manager", teamId: leads });
		await sql(`update team set primary_manager_id = $1 where id = $2`, [lead.employeeId, leads]);
		const member = await seed({ teamId: leads });
		await policy({
			name: "Managers decide",
			approvalType: "travel_expense_claim",
			stage: { approverType: "direct_manager" },
		});

		expect(await kindStatus(lead.employeeId, "travel_expense")).toMatchObject({
			status: "unroutable",
			cause: { code: "self_approval_route" },
		});
		expect(await kindStatus(member.employeeId, "travel_expense")).toMatchObject({
			status: "routed",
		});
	});

	it("resolves invitees from their draft team, else at organization level", async () => {
		const manager = await seed({ role: "manager" });
		await managedBy(manager.employeeId, owner.employeeId);
		await managedBy(owner.employeeId, manager.employeeId);
		const staffed = await createTeam("Staffed", manager.employeeId);
		const unstaffed = await createTeam("Unstaffed");
		await category();
		const invitee = (draftId: string, teamId: string | null): GoLiveMember => ({
			kind: "invitee",
			draftId,
			email: `${draftId}@invite.test`,
			teamId,
			displayName: draftId,
		});
		const members = [
			invitee("staffed", staffed),
			invitee("unstaffed", unstaffed),
			invitee("teamless", null),
		];
		const group: GoLiveGroup = {
			members,
			teamNames: new Map([
				[staffed, "Staffed"],
				[unstaffed, "Unstaffed"],
			]),
		};

		const result = await check(group);

		expect(ids(failure(result, `approver:absence:no-manager:team:${unstaffed}`))).toEqual([
			"unstaffed",
		]);
		expect(ids(failure(result, "approver:absence:no-manager:no-team"))).toEqual(["teamless"]);
		expect(passedOrFailed(result).failures.flatMap((entry) => ids(entry))).not.toContain("staffed");

		// An organization-wide policy decides for an invitee in no team.
		await policy({
			name: "Admins decide",
			approvalType: "absence_entry",
			stage: { approverType: "org_admin" },
		});
		const withPolicy = await check(group);
		expect(failure(withPolicy, "approver:absence:no-manager:no-team")).toBeUndefined();
	});

	it("never resolves another organization's managers or policies", async () => {
		// Another organization has an admin and a policy every absence would match.
		const elsewhere = await fixture.createOrganization();
		await fixture.seedEmployee({ organizationId: elsewhere, role: "admin" });
		const { rows } = await sql(
			`insert into approval_policy (organization_id, name, is_active, priority, created_by, updated_at)
			 values ($1, 'Elsewhere', true, 0, $2, now()) returning id`,
			[elsewhere, owner.userId],
		);
		await sql(
			`insert into approval_policy_stage
			 (organization_id, policy_id, step_order, label, approver_type, fallback_behavior, updated_at)
			 values ($1, $2, 1, 'Stage', 'org_admin', 'fail', now())`,
			[elsewhere, rows[0].id],
		);
		await rollout("absence", "canonical");
		await category();
		const subject = await seed();

		const result = await check();

		expect(ids(failure(result, "approver:absence:no-manager:no-team"))).toContain(
			subject.employeeId,
		);
	});

	it("creates no approval requests, workflow rows, notifications or audit entries", async () => {
		await rollout("absence", "canonical");
		await category();
		await changePolicy({ target: { type: "organization" } });
		const manager = await seed({ role: "manager" });
		await seed();
		await everyoneManagedBy(manager.employeeId);
		await sql(`update organization set shifts_enabled = true where id = $1`, [organizationId]);
		const tables = [
			"approval_request",
			"approval_chain_instance",
			"approval_chain_stage_instance",
			"approval_workflow",
			"approval_stage_assignment",
			"approval_workflow_event",
			"approval_outbox",
			"approval_workflow_rollout",
			"audit_log",
			"notification",
		];
		const counts = async () => {
			const found: Record<string, number> = {};
			for (const table of tables) {
				const { rows } = await sql(
					`select count(*)::int as count from ${table} where organization_id = $1`,
					[organizationId],
				);
				found[table] = rows[0].count;
			}
			return found;
		};
		const before = await counts();

		const result = await check();

		expect(result.outcome).not.toBe("unavailable");
		expect(await counts()).toEqual(before);
	});

	it("is unavailable, never passing, when a routing lookup fails", async () => {
		await rollout("absence", "canonical");
		await category();
		const manager = await seed({ role: "manager" });
		await everyoneManagedBy(manager.employeeId);
		resolverFailure.throws = true;

		expect((await check()).outcome).toBe("unavailable");
	});
});
