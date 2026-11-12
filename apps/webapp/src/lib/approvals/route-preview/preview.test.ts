import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { ApprovalPolicyDraft, ApprovalPolicyStageDraft } from "../policies/types";
import type { ApprovalStageReviewerDirectory } from "../routing/approver-resolver";
import { type ApprovalRouteDependencies, routeApprovalRequesters } from "./preview";
import type {
	ApprovalRouteChangePolicy,
	ApprovalRoutePermission,
	ApprovalRouteSnapshot,
} from "./snapshot";
import {
	APPROVAL_ROUTE_KINDS,
	type ApprovalRouteKind,
	type ApprovalRouteRequester,
	approvalRouteRequesterKey,
} from "./types";

const AT = parseInstant("2026-06-15T10:00:00Z");
const ORG = "org_route_preview";

type Role = "employee" | "manager" | "admin";
type Person = { id: string; userId: string };

/**
 * An organization built in memory: the snapshot an approval route preview reads, without a
 * database. Every kind is on and legacy unless a case says otherwise.
 */
function organization() {
	const snapshot: ApprovalRouteSnapshot = {
		organizationId: ORG,
		at: AT,
		kinds: APPROVAL_ROUTE_KINDS,
		offKinds: [],
		authority: {
			absence: "legacy",
			time_correction: "legacy",
			manual_time_submission: "legacy",
			travel_expense: "legacy",
		},
		periodSubmissionWriteGateOpen: true,
		canonicalPolicies: { period_submission: [] },
		stageDirectory: { employees: [], managerLinks: [], teamMemberships: [], teams: [] },
		employees: [],
		managerLinks: [],
		teamMemberships: [],
		teams: [],
		legacyPolicies: [],
		employeeGroupIds: new Map(),
		changePolicies: [],
		approvalCategoryIds: [],
		expenseApproverEmployeeId: null,
		memberRoles: new Map(),
		customRolePermissions: new Map(),
		roster: [],
	};
	let priority = 0;

	const org = {
		snapshot,
		person(input: { role?: Role; teamId?: string; memberRole?: string } = {}): Person {
			const person = { id: randomUUID(), userId: randomUUID() };
			const role = input.role ?? "employee";
			const teamId = input.teamId ?? null;
			snapshot.employees.push({
				id: person.id,
				organizationId: ORG,
				isActive: true,
				role,
				teamId,
				userId: person.userId,
			});
			snapshot.stageDirectory.employees.push({
				id: person.id,
				organizationId: ORG,
				isActive: true,
				role,
				teamId,
			});
			if (teamId) org.joinTeam(person.id, teamId);
			snapshot.roster.push({ id: person.id, role });
			(snapshot.memberRoles as Map<string, string>).set(
				person.userId,
				input.memberRole ?? "member",
			);
			return person;
		},
		/** Permissions an active custom role of the organization grants the employee. */
		grantCustomPermissions(employeeId: string, permissions: ApprovalRoutePermission[]) {
			(snapshot.customRolePermissions as Map<string, ApprovalRoutePermission[]>).set(
				employeeId,
				permissions,
			);
		},
		team(primaryManagerId: string | null = null) {
			const team = { id: randomUUID(), organizationId: ORG, primaryManagerId };
			snapshot.teams.push(team);
			snapshot.stageDirectory.teams.push(team);
			return team.id;
		},
		joinTeam(employeeId: string, teamId: string) {
			snapshot.teamMemberships.push({ employeeId, teamId });
			snapshot.stageDirectory.teamMemberships.push({ employeeId, teamId });
		},
		managedBy(employeeId: string, managerId: string) {
			const link = { employeeId, managerId, isPrimary: true };
			snapshot.managerLinks.push(link);
			snapshot.stageDirectory.managerLinks.push(link);
		},
		/** Gone at the instant: the canonical directory and the roster no longer count them. */
		departed(employeeId: string) {
			for (const row of snapshot.stageDirectory.employees) {
				if (row.id === employeeId) row.isActive = false;
			}
			snapshot.roster = snapshot.roster.filter((row) => row.id !== employeeId);
		},
		policy(input: {
			name: string;
			approvalType: string;
			stages: Array<
				Pick<ApprovalPolicyStageDraft, "approverType" | "approverEmployeeId"> & {
					fallbackBehavior?: ApprovalPolicyStageDraft["fallbackBehavior"];
				}
			>;
			amountMin?: number;
			absenceCategoryId?: string;
		}): ApprovalPolicyDraft {
			priority += 1;
			const id = randomUUID();
			return {
				id,
				organizationId: ORG,
				name: input.name,
				isActive: true,
				priority,
				conditions: [
					{ conditionType: "approval_type", operator: "equals", value: input.approvalType },
					...(input.amountMin !== undefined
						? [
								{
									conditionType: "travel_expense_amount" as const,
									operator: "gte" as const,
									amountMin: input.amountMin,
								},
							]
						: []),
					...(input.absenceCategoryId
						? [
								{
									conditionType: "absence_category" as const,
									operator: "equals" as const,
									value: input.absenceCategoryId,
								},
							]
						: []),
				],
				stages: input.stages.map((stage, index) => ({
					id: randomUUID(),
					stepOrder: index + 1,
					label: `Step ${index + 1}`,
					fallbackBehavior: stage.fallbackBehavior ?? "fail",
					approverType: stage.approverType,
					...(stage.approverEmployeeId ? { approverEmployeeId: stage.approverEmployeeId } : {}),
				})),
			};
		},
		changePolicy(
			target:
				| { type: "organization" }
				| { type: "team"; teamId: string }
				| { type: "employee"; employeeId: string },
			policy: Partial<
				Pick<
					ApprovalRouteChangePolicy,
					"noApprovalRequired" | "approvalDays" | "selfServiceDays" | "effectiveUntil"
				>
			> = {},
		) {
			snapshot.changePolicies.push({
				assignmentId: randomUUID(),
				level: target.type,
				organizationId: ORG,
				employeeId: target.type === "employee" ? target.employeeId : null,
				teamId: target.type === "team" ? target.teamId : null,
				assignmentActive: true,
				effectiveFrom: null,
				effectiveUntil: policy.effectiveUntil ?? null,
				policyOrganizationId: ORG,
				policyActive: true,
				selfServiceDays: policy.selfServiceDays ?? 0,
				approvalDays: policy.approvalDays ?? 7,
				noApprovalRequired: policy.noApprovalRequired ?? false,
			});
		},
	};
	return org;
}

const noNamedApproverReads: ApprovalRouteDependencies = {
	loadNamedApproverDirectory: () => {
		throw new Error("unexpected read for a named approver");
	},
};

async function routes(
	snapshot: ApprovalRouteSnapshot,
	requester: ApprovalRouteRequester,
	options: { deps?: ApprovalRouteDependencies; traceStages?: boolean } = {},
) {
	const preview = await routeApprovalRequesters(
		snapshot,
		{ requesters: [requester], traceStages: options.traceStages },
		options.deps ?? noNamedApproverReads,
	);
	const byKind = preview.routes.get(approvalRouteRequesterKey(requester));
	if (!byKind) throw new Error("requester not previewed");
	return byKind;
}

async function route(
	snapshot: ApprovalRouteSnapshot,
	requester: ApprovalRouteRequester,
	kind: ApprovalRouteKind,
	options: { deps?: ApprovalRouteDependencies; traceStages?: boolean } = {},
) {
	const found = (await routes(snapshot, requester, options)).get(kind);
	if (!found) throw new Error(`${kind} not previewed`);
	return found;
}

const employee = (person: Person): ApprovalRouteRequester => ({
	kind: "employee",
	employeeId: person.id,
});

const approversOf = (found: Awaited<ReturnType<typeof route>>) =>
	found.variants.flatMap(({ outcome }) =>
		outcome.kind === "routed" ? outcome.stages.flatMap((stage) => stage.approverEmployeeIds) : [],
	);

describe("approval route preview: absence", () => {
	it("is skipped when no active category requires approval", async () => {
		const org = organization();
		const subject = org.person();

		expect(await route(org.snapshot, employee(subject), "absence")).toMatchObject({
			kind: "skipped",
			reason: "no_category_requires_approval",
			variants: [],
		});
	});

	it("routes legacy absences to the default approver, or is unroutable without one", async () => {
		const org = organization();
		org.snapshot.approvalCategoryIds.push(randomUUID());
		const manager = org.person({ role: "manager" });
		const managed = org.person();
		org.managedBy(managed.id, manager.id);
		const unmanaged = org.person();

		const routed = await route(org.snapshot, employee(managed), "absence");
		expect(routed).toMatchObject({ kind: "routed", autoCompleted: false });
		expect(routed.variants[0]?.outcome).toMatchObject({
			kind: "routed",
			path: "legacy",
			policy: null,
			defaultApproverEmployeeId: manager.id,
			stages: [{ approverEmployeeIds: [manager.id], activation: "human" }],
		});
		expect(await route(org.snapshot, employee(unmanaged), "absence")).toMatchObject({
			kind: "unroutable",
			reason: { code: "no_default_approver" },
		});
	});

	it("falls back to the default approver when a legacy policy finds nobody", async () => {
		const org = organization();
		org.snapshot.approvalCategoryIds.push(randomUUID());
		const manager = org.person({ role: "manager" });
		const named = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);
		org.snapshot.employees.find((row) => row.id === named.id)!.isActive = false;
		org.snapshot.legacyPolicies.push(
			org.policy({
				name: "Absences",
				approvalType: "absence_entry",
				stages: [{ approverType: "specific_employee", approverEmployeeId: named.id }],
			}),
		);

		const found = await route(org.snapshot, employee(subject), "absence");

		expect(found.kind).toBe("routed");
		expect(found.variants[0]?.outcome).toMatchObject({
			path: "legacy",
			policy: null,
			defaultApproverEmployeeId: manager.id,
		});
	});

	it("previews each category a canonical policy names, and one other, on the canonical path", async () => {
		const org = organization();
		org.snapshot.authority.absence = "canonical";
		const named = randomUUID();
		const other = randomUUID();
		org.snapshot.approvalCategoryIds.push(named, other);
		const manager = org.person({ role: "manager" });
		const admin = org.person({ role: "admin" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);
		const special = org.policy({
			name: "Special leave",
			approvalType: "absence",
			absenceCategoryId: named,
			stages: [{ approverType: "org_admin" }],
		});
		org.snapshot.canonicalPolicies.absence = [special];
		org.snapshot.legacyPolicies.push(special);

		const found = await route(org.snapshot, employee(subject), "absence");

		expect(found.kind).toBe("routed");
		expect(found.variants).toEqual([
			{
				variant: { absenceCategoryId: named },
				outcome: expect.objectContaining({
					path: "canonical",
					policy: { id: special.id, name: "Special leave" },
					stages: [expect.objectContaining({ approverEmployeeIds: [admin.id] })],
				}),
			},
			{
				variant: { absenceCategoryId: other },
				outcome: expect.objectContaining({
					path: "canonical",
					policy: null,
					stages: [expect.objectContaining({ approverEmployeeIds: [manager.id] })],
				}),
			},
		]);
	});

	it("reads a departed named approver's stand-in for the requester, once", async () => {
		const org = organization();
		org.snapshot.authority.absence = "canonical";
		org.snapshot.approvalCategoryIds.push(randomUUID());
		const manager = org.person({ role: "manager" });
		const named = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);
		org.departed(named.id);
		const policy = org.policy({
			name: "Named",
			approvalType: "absence",
			stages: [{ approverType: "specific_employee", approverEmployeeId: named.id }],
		});
		org.snapshot.canonicalPolicies.absence = [policy];
		const loadNamedApproverDirectory = vi.fn(
			async (): Promise<ApprovalStageReviewerDirectory> => ({
				...org.snapshot.stageDirectory,
				departureReplacements: [{ employeeId: named.id, replacementEmployeeId: manager.id }],
			}),
		);

		const found = await route(org.snapshot, employee(subject), "absence", {
			deps: { loadNamedApproverDirectory },
		});

		expect(approversOf(found)).toEqual([manager.id]);
		expect(loadNamedApproverDirectory).toHaveBeenCalledWith(
			expect.objectContaining({ namedApproverId: named.id, requesterEmployeeId: subject.id }),
		);

		const unstaffed = await route(org.snapshot, employee(subject), "absence", {
			deps: { loadNamedApproverDirectory: async () => org.snapshot.stageDirectory },
		});
		expect(unstaffed).toMatchObject({
			kind: "unroutable",
			reason: { code: "policy_unresolvable", policyId: policy.id, policyName: "Named" },
		});
	});
});

describe("approval route preview: time corrections", () => {
	it("routes a correction a trust-mode policy lets the requester make directly, with a note", async () => {
		const org = organization();
		const manager = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);
		org.changePolicy({ type: "organization" }, { noApprovalRequired: true });

		const found = await route(org.snapshot, employee(subject), "time_correction");

		expect(found).toMatchObject({
			kind: "routed",
			notes: [{ code: "direct_change", cause: "change_policy_trust_mode" }],
		});
		expect(approversOf(found)).toEqual([manager.id]);
	});

	it("applies an assignment that ends after the instant, and not one that ended before it", async () => {
		const org = organization();
		const manager = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);
		org.changePolicy({ type: "organization" }, { approvalDays: 7 });
		org.changePolicy(
			{ type: "employee", employeeId: subject.id },
			{ noApprovalRequired: true, effectiveUntil: parseInstant("2026-12-31T23:00:00Z") },
		);

		expect((await route(org.snapshot, employee(subject), "time_correction")).notes).toEqual([
			{ code: "direct_change", cause: "change_policy_trust_mode" },
		]);

		org.snapshot.changePolicies[1]!.effectiveUntil = parseInstant("2026-06-01T00:00:00Z");
		expect((await route(org.snapshot, employee(subject), "time_correction")).notes).toEqual([]);
	});

	it("routes on the canonical path when the kind is canonical", async () => {
		const org = organization();
		org.snapshot.authority.time_correction = "canonical";
		org.snapshot.canonicalPolicies.time_correction = [];
		const manager = org.person({ role: "manager" });
		const team = org.team(manager.id);
		const covered = org.person({ teamId: team });
		const uncovered = org.person();

		const found = await route(org.snapshot, employee(covered), "time_correction");
		expect(found.variants[0]?.outcome).toMatchObject({
			path: "canonical",
			stages: [{ approverEmployeeIds: [manager.id], activation: "human" }],
		});
		expect(await route(org.snapshot, employee(uncovered), "time_correction")).toMatchObject({
			kind: "unroutable",
			reason: { code: "no_default_approver" },
		});
	});

	it("routes by the stored team only when it is also one of the requester's team memberships", async () => {
		const org = organization();
		const manager = org.person({ role: "manager" });
		const fieldLead = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);
		const field = org.team();
		// Stored on the employee, but not a membership.
		for (const row of [...org.snapshot.employees, ...org.snapshot.stageDirectory.employees]) {
			if (row.id === subject.id) row.teamId = field;
		}
		const policy = org.policy({
			name: "Field corrections",
			approvalType: "time_entry",
			stages: [{ approverType: "specific_employee", approverEmployeeId: fieldLead.id }],
		});
		policy.conditions.push({ conditionType: "team", operator: "equals", value: field });
		org.snapshot.legacyPolicies.push(policy);

		expect(approversOf(await route(org.snapshot, employee(subject), "time_correction"))).toEqual([
			manager.id,
		]);

		org.joinTeam(subject.id, field);
		expect(approversOf(await route(org.snapshot, employee(subject), "time_correction"))).toEqual([
			fieldLead.id,
		]);
	});

	it("is unroutable on a legacy policy whose named approver left: legacy has no stand-in", async () => {
		const org = organization();
		const manager = org.person({ role: "manager" });
		const named = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);
		org.snapshot.employees.find((row) => row.id === named.id)!.isActive = false;
		const policy = org.policy({
			name: "Corrections",
			approvalType: "time_entry",
			stages: [{ approverType: "specific_employee", approverEmployeeId: named.id }],
		});
		org.snapshot.legacyPolicies.push(policy);

		expect(await route(org.snapshot, employee(subject), "time_correction")).toMatchObject({
			kind: "unroutable",
			reason: { code: "policy_unresolvable", policyId: policy.id, policyName: "Corrections" },
		});
	});
});

describe("approval route preview: manual work", () => {
	it("is skipped for an owner or admin recording their own work", async () => {
		const org = organization();
		org.changePolicy({ type: "organization" });
		const owner = org.person({ memberRole: "owner" });
		const admin = org.person({ memberRole: "admin" });

		for (const person of [owner, admin]) {
			expect(await route(org.snapshot, employee(person), "manual_time_submission")).toMatchObject({
				kind: "skipped",
				reason: "owner_admin_self",
			});
		}
	});

	it("asks the permission system, not the member role, who records their own work directly", async () => {
		const org = organization();
		org.changePolicy({ type: "organization" });
		const manager = org.person({ role: "manager" });
		const settingsManager = org.person();
		org.grantCustomPermissions(settingsManager.id, [{ action: "manage", subject: "OrgSettings" }]);
		const employeeAdmin = org.person({ role: "admin" });
		for (const person of [settingsManager, employeeAdmin]) org.managedBy(person.id, manager.id);

		expect(
			await route(org.snapshot, employee(settingsManager), "manual_time_submission"),
		).toMatchObject({ kind: "skipped", reason: "owner_admin_self" });
		expect(
			await route(org.snapshot, employee(employeeAdmin), "manual_time_submission"),
		).toMatchObject({ kind: "routed" });
	});

	it("does not exempt an owner who has left by the instant", async () => {
		const org = organization();
		org.changePolicy({ type: "organization" });
		const manager = org.person({ role: "manager" });
		const owner = org.person({ memberRole: "owner" });
		org.managedBy(owner.id, manager.id);
		org.departed(owner.id);

		expect(await route(org.snapshot, employee(owner), "manual_time_submission")).not.toMatchObject({
			kind: "skipped",
		});
	});

	it("is skipped without a change policy, or in trust mode", async () => {
		const org = organization();
		const subject = org.person();
		expect(await route(org.snapshot, employee(subject), "manual_time_submission")).toMatchObject({
			kind: "skipped",
			reason: "change_policy_no_policy",
		});

		org.changePolicy({ type: "organization" }, { noApprovalRequired: true });
		expect(await route(org.snapshot, employee(subject), "manual_time_submission")).toMatchObject({
			kind: "skipped",
			reason: "change_policy_trust_mode",
		});
	});

	it("shows the route for work that needs approval, noting that self-service days skip it", async () => {
		const org = organization();
		org.changePolicy({ type: "organization" }, { selfServiceDays: 3 });
		const manager = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);

		const found = await route(org.snapshot, employee(subject), "manual_time_submission");

		expect(found).toMatchObject({
			kind: "routed",
			notes: [{ code: "within_self_service_skips", selfServiceDays: 3 }],
		});
		expect(approversOf(found)).toEqual([manager.id]);
	});

	it("is routed and auto-completed when the requester is their own approver", async () => {
		const org = organization();
		org.changePolicy({ type: "organization" });
		const lead = org.person({ role: "manager" });
		const team = org.team(lead.id);
		org.joinTeam(lead.id, team);

		const found = await route(org.snapshot, employee(lead), "manual_time_submission");

		expect(found).toMatchObject({ kind: "routed", autoCompleted: true });
		expect(found.variants[0]?.outcome).toMatchObject({
			autoCompleted: true,
			stages: [{ approverEmployeeIds: [lead.id], activation: "requester_auto_approve" }],
		});
	});
});

describe("approval route preview: period submissions", () => {
	it("routes to the primary eligible manager through a planned canonical start", async () => {
		const org = organization();
		const manager = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);

		const found = await route(org.snapshot, employee(subject), "period_submission");

		expect(found.kind).toBe("routed");
		expect(found.variants[0]?.outcome).toMatchObject({ path: "canonical" });
		expect(approversOf(found)).toEqual([manager.id]);
	});

	it("is unroutable outside complete mode, and when the policies can't be read", async () => {
		const org = organization();
		const subject = org.person();
		org.snapshot.periodSubmissionWriteGateOpen = false;
		expect(await route(org.snapshot, employee(subject), "period_submission")).toMatchObject({
			kind: "unroutable",
			reason: { code: "approval_mode_unsupported" },
		});

		org.snapshot.periodSubmissionWriteGateOpen = true;
		org.snapshot.canonicalPolicies.period_submission = "invalid";
		expect(await route(org.snapshot, employee(subject), "period_submission")).toMatchObject({
			kind: "unroutable",
			reason: { code: "invalid_policies" },
		});
	});
});

describe("approval route preview: expense reports", () => {
	it("previews every amount band of an active policy", async () => {
		const org = organization();
		const manager = org.person({ role: "manager" });
		const named = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);
		org.snapshot.employees.find((row) => row.id === named.id)!.isActive = false;
		const policy = org.policy({
			name: "Large reports",
			approvalType: "travel_expense_claim",
			amountMin: 500,
			stages: [{ approverType: "specific_employee", approverEmployeeId: named.id }],
		});
		org.snapshot.legacyPolicies.push(policy);

		const found = await route(org.snapshot, employee(subject), "travel_expense");

		expect(found).toMatchObject({
			kind: "unroutable",
			reason: { code: "policy_unresolvable", policyId: policy.id },
		});
		expect(found.variants.map(({ variant }) => variant.travelExpenseAmount)).toEqual([
			0, 250, 500, 501,
		]);
		expect(found.notes).toEqual([{ code: "report_contents_checked_at_submit" }]);
	});

	it("lets the owner approve their own report only when nobody else can", async () => {
		const org = organization();
		const owner = org.person({ role: "admin", memberRole: "owner" });

		const alone = await route(org.snapshot, employee(owner), "travel_expense");
		expect(alone).toMatchObject({ kind: "routed", autoCompleted: true });
		expect(alone.variants[0]?.outcome).toMatchObject({
			autoCompleted: true,
			notes: [{ code: "owner_self_approval" }],
		});

		const manager = org.person({ role: "manager" });
		org.managedBy(owner.id, manager.id);
		expect(approversOf(await route(org.snapshot, employee(owner), "travel_expense"))).toEqual([
			manager.id,
		]);
	});

	it("is unroutable when a policy routes a report to its own requester", async () => {
		const org = organization();
		const lead = org.person({ role: "manager" });
		const team = org.team(lead.id);
		org.joinTeam(lead.id, team);
		const member = org.person({ teamId: team });
		org.snapshot.legacyPolicies.push(
			org.policy({
				name: "Managers decide",
				approvalType: "travel_expense_claim",
				stages: [{ approverType: "direct_manager" }],
			}),
		);

		expect(await route(org.snapshot, employee(lead), "travel_expense")).toMatchObject({
			kind: "unroutable",
			reason: { code: "self_approval_route" },
		});
		expect((await route(org.snapshot, employee(member), "travel_expense")).kind).toBe("routed");
	});

	it("is unroutable outside legacy authority", async () => {
		const org = organization();
		org.snapshot.authority.travel_expense = "canonical";
		const subject = org.person();

		expect(await route(org.snapshot, employee(subject), "travel_expense")).toMatchObject({
			kind: "unroutable",
			reason: { code: "approval_mode_unsupported" },
		});
	});
});

describe("approval route preview: shift requests", () => {
	it("routes to the managers and admins on the roster at the instant", async () => {
		const org = organization();
		const manager = org.person({ role: "manager" });
		const admin = org.person({ role: "admin" });
		const gone = org.person({ role: "manager" });
		org.departed(gone.id);
		const subject = org.person();

		const found = await route(org.snapshot, employee(subject), "shift_request");

		expect(found).toMatchObject({ kind: "routed", autoCompleted: false, notes: [] });
		expect(found.variants[0]?.outcome).toMatchObject({
			path: "shift_deciders",
			stages: [{ approverType: "manager_or_admin", activation: "human" }],
		});
		expect(new Set(approversOf(found))).toEqual(new Set([manager.id, admin.id]));
	});

	it("notes a lone decider's own requests wait for them, and is unroutable with no decider", async () => {
		const org = organization();
		const lead = org.person({ role: "manager" });
		const subject = org.person();

		const own = await route(org.snapshot, employee(lead), "shift_request");
		expect(own).toMatchObject({ kind: "routed" });
		expect(own.variants[0]?.outcome).toMatchObject({ notes: [{ code: "requester_only_decider" }] });

		org.departed(lead.id);
		expect(await route(org.snapshot, employee(subject), "shift_request")).toMatchObject({
			kind: "unroutable",
			reason: { code: "no_decider" },
		});
	});
});

describe("approval route preview: prospective requesters", () => {
	it("previews them as a member of their team, with no managers of their own", async () => {
		const org = organization();
		org.snapshot.approvalCategoryIds.push(randomUUID());
		org.changePolicy({ type: "organization" });
		const manager = org.person({ role: "manager" });
		const staffed = org.team(manager.id);
		const unstaffed = org.team();

		const inStaffed = await routes(org.snapshot, {
			kind: "prospective",
			key: "staffed",
			teamId: staffed,
		});
		for (const kind of ["absence", "time_correction", "manual_time_submission"] as const) {
			expect(inStaffed.get(kind)?.kind, kind).toBe("routed");
			expect(approversOf(inStaffed.get(kind)!), kind).toEqual([manager.id]);
		}
		expect(
			await route(
				org.snapshot,
				{ kind: "prospective", key: "unstaffed", teamId: unstaffed },
				"absence",
			),
		).toMatchObject({ kind: "unroutable", reason: { code: "no_default_approver" } });
		expect(
			await route(org.snapshot, { kind: "prospective", key: "teamless", teamId: null }, "absence"),
		).toMatchObject({ kind: "unroutable", reason: { code: "no_default_approver" } });
	});

	it("applies their team's change policy, and never an elevated role", async () => {
		const org = organization();
		const manager = org.person({ role: "manager" });
		const trusted = org.team(manager.id);
		org.changePolicy({ type: "organization" });
		org.changePolicy({ type: "team", teamId: trusted }, { noApprovalRequired: true });

		expect(
			await route(
				org.snapshot,
				{ kind: "prospective", key: "trusted", teamId: trusted },
				"manual_time_submission",
			),
		).toMatchObject({ kind: "skipped", reason: "change_policy_trust_mode" });
		expect(
			(
				await route(
					org.snapshot,
					{ kind: "prospective", key: "teamless", teamId: null },
					"manual_time_submission",
				)
			).kind,
		).toBe("unroutable");
	});

	it("routes them on the canonical path through an organization-wide policy", async () => {
		const org = organization();
		org.snapshot.authority.absence = "canonical";
		org.snapshot.approvalCategoryIds.push(randomUUID());
		const admin = org.person({ role: "admin" });
		org.snapshot.canonicalPolicies.absence = [
			org.policy({
				name: "Admins",
				approvalType: "absence",
				stages: [{ approverType: "org_admin" }],
			}),
		];

		const found = await route(
			org.snapshot,
			{ kind: "prospective", key: "teamless", teamId: null },
			"absence",
		);

		expect(found.kind).toBe("routed");
		expect(approversOf(found)).toEqual([admin.id]);
	});
});

describe("approval route preview", () => {
	it("previews only the kinds switched on, and refuses an employee of another organization", async () => {
		const org = organization();
		org.snapshot.kinds = ["absence", "time_correction"];
		org.snapshot.offKinds = ["period_submission", "shift_request"];
		const subject = org.person();

		const preview = await routeApprovalRequesters(
			org.snapshot,
			{ requesters: [employee(subject)] },
			noNamedApproverReads,
		);
		expect(preview.kinds).toEqual(["absence", "time_correction"]);
		expect(preview.offKinds).toEqual(["period_submission", "shift_request"]);
		expect([...(preview.routes.get(`employee:${subject.id}`)?.keys() ?? [])]).toEqual([
			"absence",
			"time_correction",
		]);

		await expect(
			routeApprovalRequesters(
				org.snapshot,
				{ requesters: [{ kind: "employee", employeeId: randomUUID() }] },
				noNamedApproverReads,
			),
		).rejects.toThrow(/not an employee/);
	});

	it("traces every canonical stage: a later stage and a fallback", async () => {
		const org = organization();
		org.snapshot.authority.absence = "canonical";
		org.snapshot.approvalCategoryIds.push(randomUUID());
		const admin = org.person({ role: "admin" });
		const manager = org.person({ role: "manager" });
		const subject = org.person();
		org.managedBy(subject.id, manager.id);
		org.snapshot.canonicalPolicies.absence = [
			org.policy({
				name: "Two steps",
				approvalType: "absence",
				stages: [
					{ approverType: "direct_manager" },
					{ approverType: "manager_manager", fallbackBehavior: "organization_admin" },
				],
			}),
		];

		const found = await route(org.snapshot, employee(subject), "absence", { traceStages: true });

		const outcome = found.variants[0]?.outcome;
		if (outcome?.kind !== "routed") throw new Error("not routed");
		expect(outcome.stages).toEqual([
			expect.objectContaining({
				activation: "human",
				trace: {
					resolution: "human",
					approverEmployeeIds: [manager.id],
					viaFallback: false,
					namedApprover: null,
				},
			}),
			expect.objectContaining({
				activation: "not_activated",
				trace: expect.objectContaining({
					resolution: "human",
					approverEmployeeIds: [admin.id],
					viaFallback: true,
				}),
			}),
		]);
	});
});
