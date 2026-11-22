import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const EMPLOYEE_ID = "7d3c8f8e-2b7a-4f7e-9a51-0d6f1c2b3a4e";
const OTHER_EMPLOYEE_ID = "8e4d9f9f-3c8b-4f8f-8b62-1e7f2d3c4b5f";
const POLICY_ID = "11111111-1111-4111-8111-111111111111";
const TEAM_ID = "22222222-2222-4222-8222-222222222222";
const TEMPLATE_ID = "33333333-3333-4333-8333-333333333333";
const VERSION_ID = "44444444-4444-4444-8444-444444444444";
const CONFLICT_ID = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	managedEmployeeIds: new Set<string>(),
	formerEmployeeIds: new Set<string>(),
	employeeExists: true,
	assignEmployeeWorkPolicy: vi.fn(),
	scheduleContractDefault: vi.fn(),
	previewContractDefaultChange: vi.fn(),
	getContractDefaults: vi.fn(),
	createContractTemplate: vi.fn(),
	publishContractTemplateVersion: vi.fn(),
	archiveContractTemplate: vi.fn(),
	listContractTemplates: vi.fn(),
	getContractTemplate: vi.fn(),
	previewTemplateApplication: vi.fn(),
	commitContractChange: vi.fn(),
	previewEmployeeContractChange: vi.fn(),
	resetEmployeeContractDivergences: vi.fn(),
	adoptContractDefault: vi.fn(),
	createInitialEmploymentAgreement: vi.fn(),
	recordFixedTermExtension: vi.fn(),
	listEmploymentTermAgreements: vi.fn(),
	previewPrimaryTeamMove: vi.fn(),
	listContractMigrationConflicts: vi.fn(),
	resolveContractMigrationConflict: vi.fn(),
	resolveEffectiveContractOnDay: vi.fn(),
	markEmployeeWorkBalanceDirty: vi.fn(),
	markOrganizationWorkBalancesDirty: vi.fn(),
}));

vi.mock("@/lib/contracts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/contracts")>();
	return {
		...actual,
		assignEmployeeWorkPolicy: mocks.assignEmployeeWorkPolicy,
		scheduleContractDefault: mocks.scheduleContractDefault,
		previewContractDefaultChange: mocks.previewContractDefaultChange,
		getContractDefaults: mocks.getContractDefaults,
		createContractTemplate: mocks.createContractTemplate,
		publishContractTemplateVersion: mocks.publishContractTemplateVersion,
		archiveContractTemplate: mocks.archiveContractTemplate,
		listContractTemplates: mocks.listContractTemplates,
		getContractTemplate: mocks.getContractTemplate,
		previewTemplateApplication: mocks.previewTemplateApplication,
		commitContractChange: mocks.commitContractChange,
		previewEmployeeContractChange: mocks.previewEmployeeContractChange,
		resetEmployeeContractDivergences: mocks.resetEmployeeContractDivergences,
		adoptContractDefault: mocks.adoptContractDefault,
		createInitialEmploymentAgreement: mocks.createInitialEmploymentAgreement,
		recordFixedTermExtension: mocks.recordFixedTermExtension,
		listEmploymentTermAgreements: mocks.listEmploymentTermAgreements,
		previewPrimaryTeamMove: mocks.previewPrimaryTeamMove,
		listContractMigrationConflicts: mocks.listContractMigrationConflicts,
		resolveContractMigrationConflict: mocks.resolveContractMigrationConflict,
		resolveEffectiveContractOnDay: mocks.resolveEffectiveContractOnDay,
	};
});

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: mocks.markEmployeeWorkBalanceDirty,
	markOrganizationWorkBalancesDirty: mocks.markOrganizationWorkBalancesDirty,
}));

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: vi.fn(async () => "Europe/Berlin"),
}));

vi.mock("@/lib/employee-lifecycle/current-roster-guard", async () =>
	(
		await import("@/lib/employee-lifecycle/testing/current-roster-guard.test.mock")
	).currentRosterGuardModule(() => mocks.formerEmployeeIds),
);

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const db = {
		select: () => ({
			from: () => ({
				where: () => ({
					limit: async () => (mocks.employeeExists ? [{ id: EMPLOYEE_ID }] : []),
				}),
			}),
		}),
	};
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db,
			query: (name, fn) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([[...mocks.managedEmployeeIds].map((id) => ({ id })), []]) as never)
					: Effect.promise(fn),
		}),
	);
});

const actions = await import("./actions");

const orgMember: StubCaller = {
	userId: "u-member",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-member", role: "employee", former: false },
};

const scopedManager: StubCaller = {
	userId: "u-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "emp-manager", role: "manager", former: false },
};

const orgAdmin: StubCaller = {
	userId: "u-admin",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "emp-admin", role: "admin", former: false },
};

describe("settings/contracts server actions RBAC (#1927)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = new Set([EMPLOYEE_ID]);
		mocks.formerEmployeeIds = new Set();
		mocks.employeeExists = true;
		mocks.markEmployeeWorkBalanceDirty.mockResolvedValue(undefined);
		mocks.markOrganizationWorkBalancesDirty.mockResolvedValue(undefined);
	});

	const orgAdminOnlyCalls: [string, () => Promise<unknown>][] = [
		["getContractDefaultsAction", () => actions.getContractDefaultsAction({})],
		[
			"previewContractDefaultChangeAction",
			() =>
				actions.previewContractDefaultChangeAction({
					scope: "organization",
					effectiveFromDate: "2026-06-01",
					weeklyContractMinutes: 2400,
				}),
		],
		[
			"scheduleContractDefaultAction",
			() =>
				actions.scheduleContractDefaultAction({
					scope: "organization",
					effectiveFromDate: "2026-06-01",
					weeklyContractMinutes: 2400,
				}),
		],
		["listContractTemplatesAction", () => actions.listContractTemplatesAction({})],
		["getContractTemplateAction", () => actions.getContractTemplateAction(TEMPLATE_ID)],
		[
			"createContractTemplateAction",
			() => actions.createContractTemplateAction({ name: "Standard" }),
		],
		[
			"publishContractTemplateVersionAction",
			() => actions.publishContractTemplateVersionAction({ templateId: TEMPLATE_ID }),
		],
		["archiveContractTemplateAction", () => actions.archiveContractTemplateAction(TEMPLATE_ID)],
		[
			"previewTemplateApplicationAction",
			() =>
				actions.previewTemplateApplicationAction({
					employeeId: EMPLOYEE_ID,
					templateVersionId: VERSION_ID,
					effectiveFromDate: "2026-06-01",
				}),
		],
		[
			"getEmployeeEffectiveContractAction",
			() =>
				actions.getEmployeeEffectiveContractAction({
					employeeId: EMPLOYEE_ID,
					asOfDate: "2026-06-01",
				}),
		],
		[
			"previewEmployeeContractChangeAction",
			() =>
				actions.previewEmployeeContractChangeAction({
					employeeId: EMPLOYEE_ID,
					validFromDate: "2026-06-01",
				}),
		],
		[
			"commitEmployeeContractChangeAction",
			() =>
				actions.commitEmployeeContractChangeAction({
					employeeId: EMPLOYEE_ID,
					validFromDate: "2026-06-01",
				}),
		],
		[
			"resetEmployeeContractDivergencesAction",
			() =>
				actions.resetEmployeeContractDivergencesAction({
					employeeId: EMPLOYEE_ID,
					effectiveFromDate: "2026-06-01",
				}),
		],
		[
			"adoptEmployeeContractDefaultAction",
			() =>
				actions.adoptEmployeeContractDefaultAction({
					employeeId: EMPLOYEE_ID,
					effectiveFromDate: "2026-06-01",
				}),
		],
		[
			"listEmployeeTermAgreementsAction",
			() => actions.listEmployeeTermAgreementsAction({ employeeId: EMPLOYEE_ID }),
		],
		[
			"createInitialEmploymentAgreementAction",
			() =>
				actions.createInitialEmploymentAgreementAction({
					employeeId: EMPLOYEE_ID,
					kind: "fixed_term",
					startsOn: "2026-01-01",
					endsOn: "2026-12-31",
				}),
		],
		[
			"recordFixedTermExtensionAction",
			() =>
				actions.recordFixedTermExtensionAction({
					employeeId: EMPLOYEE_ID,
					kind: "fixed_term",
					startsOn: "2026-07-01",
					endsOn: "2027-06-30",
					departureSyncAction: "update_leaving_date",
				}),
		],
		[
			"previewPrimaryTeamMoveAction",
			() =>
				actions.previewPrimaryTeamMoveAction({
					employeeId: EMPLOYEE_ID,
					targetTeamId: TEAM_ID,
				}),
		],
		[
			"listContractMigrationConflictsAction",
			() => actions.listContractMigrationConflictsAction({}),
		],
		[
			"resolveContractMigrationConflictAction",
			() =>
				actions.resolveContractMigrationConflictAction({
					conflictId: CONFLICT_ID,
					status: "resolved",
				}),
		],
	];

	it.each(orgAdminOnlyCalls)(
		"blocks scoped manager from %s (A1 strict separation)",
		async (_name, invoke) => {
			mocks.caller = scopedManager;
			await expect(invoke()).resolves.toMatchObject({
				success: false,
				code: "AuthorizationError",
			});
		},
	);

	it.each(orgAdminOnlyCalls)("blocks org member from %s", async (_name, invoke) => {
		mocks.caller = orgMember;
		await expect(invoke()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
	});

	it("allows scoped manager wage-free policy assignment for a managed employee (A1)", async () => {
		mocks.caller = scopedManager;
		mocks.assignEmployeeWorkPolicy.mockResolvedValueOnce({
			assignmentId: "asgn-1",
			employeeId: EMPLOYEE_ID,
			policyId: POLICY_ID,
			effectiveFromDate: "2026-06-01",
			sourceKind: "manager_assignment",
		});

		const result = await actions.assignEmployeeWorkPolicyAction({
			employeeId: EMPLOYEE_ID,
			policyId: POLICY_ID,
			effectiveFromDate: "2026-06-01",
		});

		expect(result).toEqual({
			success: true,
			data: {
				assignmentId: "asgn-1",
				employeeId: EMPLOYEE_ID,
				policyId: POLICY_ID,
				effectiveFromDate: "2026-06-01",
				sourceKind: "manager_assignment",
			},
		});
		expect(mocks.assignEmployeeWorkPolicy).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				organizationId: "org-1",
				employeeId: EMPLOYEE_ID,
				policyId: POLICY_ID,
				actorUserId: "u-manager",
				actorIsOrgAdmin: false,
			}),
		);
		expect(mocks.markEmployeeWorkBalanceDirty).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: EMPLOYEE_ID,
			dirtyFromDate: "2026-06-01",
		});
	});

	it("refuses scoped manager assigning a policy to an unmanaged employee", async () => {
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = new Set([OTHER_EMPLOYEE_ID]);

		const result = await actions.assignEmployeeWorkPolicyAction({
			employeeId: EMPLOYEE_ID,
			policyId: POLICY_ID,
		});

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.assignEmployeeWorkPolicy).not.toHaveBeenCalled();
	});

	it("refuses assigning a policy to a former employee", async () => {
		mocks.caller = orgAdmin;
		mocks.formerEmployeeIds = new Set([EMPLOYEE_ID]);

		const result = await actions.assignEmployeeWorkPolicyAction({
			employeeId: EMPLOYEE_ID,
			policyId: POLICY_ID,
		});

		expect(result).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "former_employee",
		});
		expect(mocks.assignEmployeeWorkPolicy).not.toHaveBeenCalled();
	});

	it("passes actorIsOrgAdmin=true when an org admin invokes assignEmployeeWorkPolicyAction", async () => {
		mocks.caller = orgAdmin;
		mocks.assignEmployeeWorkPolicy.mockResolvedValueOnce({
			assignmentId: "asgn-2",
			employeeId: EMPLOYEE_ID,
			policyId: POLICY_ID,
			effectiveFromDate: "2026-06-01",
			sourceKind: "manager_assignment",
		});

		const result = await actions.assignEmployeeWorkPolicyAction({
			employeeId: EMPLOYEE_ID,
			policyId: POLICY_ID,
			effectiveFromDate: "2026-06-01",
		});

		expect(result).toMatchObject({ success: true });
		expect(mocks.assignEmployeeWorkPolicy).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ actorIsOrgAdmin: true }),
		);
	});
});
