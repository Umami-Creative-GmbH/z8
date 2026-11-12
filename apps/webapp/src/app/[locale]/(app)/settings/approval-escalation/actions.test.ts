import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrincipalContext } from "@/lib/authorization/types";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	principal: null as PrincipalContext | null,
	rosterIds: [] as string[],
	getEscalationManagementOverview: vi.fn(),
	updateEscalationPolicy: vi.fn(),
	markEscalationPolicyConflictsReviewed: vi.fn(),
	disposeEscalationAttention: vi.fn(),
	recoverApprovalDeliveryForAttention: vi.fn(),
	listHumanEscalationCandidates: vi.fn(),
	listLegacyHumanEscalationCandidates: vi.fn(),
	escalateAssignmentByManager: vi.fn(),
	escalateLegacyApprovalByManager: vi.fn(),
	recheckEscalationAttention: vi.fn(),
	dispatchEscalationAttentionAlerts: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { ORGANIZATION_ABILITY_QUERY } = await import("@/lib/authorization/organization-ability");
	const { defineAbilityFor } = await import("@/lib/authorization/ability");
	const { DatabaseError } = await import("@/lib/effect/errors");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			query: (name, fn) => {
				if (name === ORGANIZATION_ABILITY_QUERY) {
					return Effect.sync(() => defineAbilityFor(mocks.principal as PrincipalContext)) as never;
				}
				if (name === "employeeLifecycle.findNotOnCurrentRoster") {
					return Effect.succeed([]) as never;
				}
				return Effect.tryPromise({
					try: fn,
					catch: (cause) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause,
						}),
				});
			},
		}),
	);
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));
vi.mock("@/lib/approvals/escalation/management-overview", () => ({
	getEscalationManagementOverview: mocks.getEscalationManagementOverview,
}));
vi.mock("@/lib/approvals/escalation/policy-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/approvals/escalation/policy-store")>()),
	updateEscalationPolicy: mocks.updateEscalationPolicy,
	markEscalationPolicyConflictsReviewed: mocks.markEscalationPolicyConflictsReviewed,
}));
vi.mock("@/lib/approvals/escalation/attention-store", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/approvals/escalation/attention-store")>()),
	disposeEscalationAttention: mocks.disposeEscalationAttention,
	recheckEscalationAttention: mocks.recheckEscalationAttention,
	dispatchEscalationAttentionAlerts: mocks.dispatchEscalationAttentionAlerts,
}));
vi.mock("@/lib/approvals/delivery/recovery", () => ({
	recoverApprovalDeliveryForAttention: mocks.recoverApprovalDeliveryForAttention,
}));
vi.mock("@/lib/approvals/escalation/transfer", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/approvals/escalation/transfer")>()),
	listHumanEscalationCandidates: mocks.listHumanEscalationCandidates,
	listLegacyHumanEscalationCandidates: mocks.listLegacyHumanEscalationCandidates,
	escalateAssignmentByManager: mocks.escalateAssignmentByManager,
	escalateLegacyApprovalByManager: mocks.escalateLegacyApprovalByManager,
}));

const actions = await import("./actions");

const ATTENTION_ID = "8f1d1c43-6a49-4d1e-9a51-3a1c1f2d4e01";
const ASSIGNMENT_ID = "8f1d1c43-6a49-4d1e-9a51-3a1c1f2d4e02";
const RECIPIENT_ID = "8f1d1c43-6a49-4d1e-9a51-3a1c1f2d4e03";
const IDEMPOTENCY_KEY = "8f1d1c43-6a49-4d1e-9a51-3a1c1f2d4e04";

const workforceAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "admin", former: false },
};

function principal(employeeRole: "admin" | "manager" | "employee" | null): PrincipalContext {
	return {
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: { organizationId: "org-1", role: "owner" },
		employee: employeeRole
			? { id: "employee-1", organizationId: "org-1", role: employeeRole, teamId: null }
			: null,
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
	} as PrincipalContext;
}

const calls = [
	["getApprovalEscalationOverview", () => actions.getApprovalEscalationOverview()],
	[
		"updateApprovalEscalationPolicy",
		() =>
			actions.updateApprovalEscalationPolicy({
				expectedRevision: 1,
				enabled: true,
				responseWindowHours: 24,
			}),
	],
	[
		"reviewApprovalEscalationPolicyConflicts",
		() => actions.reviewApprovalEscalationPolicyConflicts(),
	],
	[
		"disposeApprovalEscalationAttention",
		() => actions.disposeApprovalEscalationAttention({ attentionId: ATTENTION_ID, note: "Done" }),
	],
	[
		"retryApprovalEscalationDelivery",
		() => actions.retryApprovalEscalationDelivery({ attentionId: ATTENTION_ID }),
	],
	[
		"listApprovalEscalationCandidates",
		() => actions.listApprovalEscalationCandidates({ assignmentId: ASSIGNMENT_ID }),
	],
	[
		"transferApprovalEscalationAssignment",
		() =>
			actions.transferApprovalEscalationAssignment({
				assignmentId: ASSIGNMENT_ID,
				recipientEmployeeId: RECIPIENT_ID,
				idempotencyKey: IDEMPOTENCY_KEY,
			}),
	],
	["recheckApprovalEscalationAttention", () => actions.recheckApprovalEscalationAttention()],
] as const;

const storeMocks = [
	mocks.getEscalationManagementOverview,
	mocks.updateEscalationPolicy,
	mocks.markEscalationPolicyConflictsReviewed,
	mocks.disposeEscalationAttention,
	mocks.recoverApprovalDeliveryForAttention,
	mocks.listHumanEscalationCandidates,
	mocks.escalateAssignmentByManager,
	mocks.recheckEscalationAttention,
];

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = workforceAdmin;
	mocks.principal = principal("admin");
});

describe("approval escalation settings actions", () => {
	it.each(calls)(
		"%s refuses an org owner whose role cannot manage approvals",
		async (_name, call) => {
			mocks.caller = { ...workforceAdmin, membershipRole: "owner", employee: null };
			mocks.principal = principal(null);

			expect(await call()).toMatchObject({
				success: false,
				code: "AuthorizationError",
				error: "You do not have permission to manage approval escalation.",
			});
			for (const store of storeMocks) expect(store).not.toHaveBeenCalled();
		},
	);

	it.each(calls)("%s refuses a pending membership", async (_name, call) => {
		mocks.caller = { ...workforceAdmin, membershipRole: null };

		expect(await call()).toMatchObject({ success: false, code: "AuthorizationError" });
		for (const store of storeMocks) expect(store).not.toHaveBeenCalled();
	});

	it("loads the overview of the active organization for a workforce admin", async () => {
		mocks.getEscalationManagementOverview.mockResolvedValue({ policy: null });

		expect(await actions.getApprovalEscalationOverview()).toEqual({
			success: true,
			data: { policy: null },
		});
		expect(mocks.getEscalationManagementOverview).toHaveBeenCalledWith("org-1");
	});

	it("reports a stale policy save as a conflict with its message", async () => {
		mocks.updateEscalationPolicy.mockResolvedValue({ kind: "stale" });

		expect(
			await actions.updateApprovalEscalationPolicy({
				expectedRevision: 1,
				enabled: true,
				responseWindowHours: 24,
			}),
		).toMatchObject({
			success: false,
			code: "ConflictError",
			error: "The policy was changed by someone else. Reload to see the current policy.",
		});
		expect(mocks.updateEscalationPolicy).toHaveBeenCalledWith({
			organizationId: "org-1",
			actorUserId: "user-1",
			expectedRevision: 1,
			enabled: true,
			responseWindowHours: 24,
		});
	});

	it("transfers as the caller's current employee record", async () => {
		mocks.escalateAssignmentByManager.mockResolvedValue({
			kind: "transferred",
			disposition: "created",
		});

		expect(
			await actions.transferApprovalEscalationAssignment({
				assignmentId: ASSIGNMENT_ID,
				recipientEmployeeId: RECIPIENT_ID,
				idempotencyKey: IDEMPOTENCY_KEY,
			}),
		).toEqual({ success: true, data: { replayed: false } });
		expect(mocks.escalateAssignmentByManager).toHaveBeenCalledWith(
			expect.objectContaining({
				assignmentId: ASSIGNMENT_ID,
				recipientEmployeeId: RECIPIENT_ID,
				actor: {
					organizationId: "org-1",
					userId: "user-1",
					employeeId: "employee-1",
					canManageApprovals: true,
				},
			}),
		);
	});

	it("does not transfer without an employee record to attribute it to", async () => {
		mocks.caller = { ...workforceAdmin, membershipRole: "owner", employee: null };

		expect(
			await actions.listApprovalEscalationCandidates({ assignmentId: ASSIGNMENT_ID }),
		).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.listHumanEscalationCandidates).not.toHaveBeenCalled();
	});

	it("keeps the safe message when the recheck fails", async () => {
		mocks.recheckEscalationAttention.mockRejectedValue(new Error("connection reset"));

		expect(await actions.recheckApprovalEscalationAttention()).toMatchObject({
			success: false,
			error: "Attention items could not be rechecked.",
		});
	});

	it("refuses a malformed attention id before recovering anything", async () => {
		expect(await actions.retryApprovalEscalationDelivery({ attentionId: "nope" })).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Attention item not found.",
		});
		expect(mocks.recoverApprovalDeliveryForAttention).not.toHaveBeenCalled();
	});
});
