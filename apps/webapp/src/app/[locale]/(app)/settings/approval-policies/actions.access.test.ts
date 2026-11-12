import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	notOnRoster: [] as string[],
	policyFindMany: vi.fn(),
	groupFindMany: vi.fn(),
	transaction: vi.fn(),
	saveTriage: vi.fn(),
	getTriage: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { DatabaseError } = await import("@/lib/effect/errors");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				query: {
					approvalPolicy: { findMany: mocks.policyFindMany },
					employeeGroup: { findMany: mocks.groupFindMany },
				},
				transaction: mocks.transaction,
			},
			query: (name, fn) =>
				name === "employeeLifecycle.findNotOnCurrentRoster"
					? (Effect.succeed(mocks.notOnRoster) as never)
					: // Like the live service: a rejection is a DatabaseError.
						Effect.tryPromise({
							try: fn,
							catch: (cause) => new DatabaseError({ message: "failed", operation: name, cause }),
						}),
		}),
	);
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));
vi.mock("@/lib/approvals/triage-settings", () => ({
	saveApprovalTriageSettings: mocks.saveTriage,
}));
vi.mock("@/lib/approvals/triage-policy", () => ({
	getEffectiveApprovalTriagePolicy: mocks.getTriage,
}));

const policies = await import("./actions");
const triage = await import("./triage-actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const workforceAdmin: StubCaller = {
	userId: "user-2",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-2", role: "admin", former: false },
};

const group = { name: "Night shift", isActive: true, employeeIds: ["employee-3"] };
const policy = {
	name: "Absences",
	isActive: false,
	priority: 1,
	conditions: [],
	stages: [],
};

const calls = [
	["getApprovalPolicies", () => policies.getApprovalPolicies()],
	["upsertApprovalPolicy", () => policies.upsertApprovalPolicy(policy)],
	["getEmployeeGroups", () => policies.getEmployeeGroups()],
	["upsertEmployeeGroup", () => policies.upsertEmployeeGroup(group)],
	["getApprovalTriageSettingsAction", () => triage.getApprovalTriageSettingsAction()],
	[
		"saveApprovalTriageSettingsAction",
		() =>
			triage.saveApprovalTriageSettingsAction({ staleAfterHours: 24, smallCorrectionMinutes: 5 }),
	],
] as const;

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.notOnRoster = [];
	mocks.policyFindMany.mockResolvedValue([]);
	mocks.groupFindMany.mockResolvedValue([]);
	mocks.transaction.mockResolvedValue(undefined);
	mocks.getTriage.mockResolvedValue({ staleAfterHours: 72, smallCorrectionMinutes: 15 });
	mocks.saveTriage.mockImplementation(async (_db, input) => ({
		staleAfterHours: input.staleAfterHours,
		smallCorrectionMinutes: input.smallCorrectionMinutes,
	}));
});

describe("approval policy settings access", () => {
	it.each(calls)("%s refuses a scoped manager", async (_name, call) => {
		mocks.caller = workforceAdmin;

		expect(await call()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.policyFindMany).not.toHaveBeenCalled();
		expect(mocks.groupFindMany).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
		expect(mocks.getTriage).not.toHaveBeenCalled();
		expect(mocks.saveTriage).not.toHaveBeenCalled();
	});

	it("lets an org admin without an employee record list the policies", async () => {
		mocks.policyFindMany.mockResolvedValue([{ id: "policy-1" }]);

		expect(await policies.getApprovalPolicies()).toEqual({
			success: true,
			data: [{ id: "policy-1" }],
		});
	});

	it("saves an employee group whose members are on the current roster", async () => {
		expect(await policies.upsertEmployeeGroup(group)).toEqual({
			success: true,
			data: undefined,
		});
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
	});

	it("refuses an employee group with a former employee", async () => {
		mocks.notOnRoster = ["employee-3"];

		expect(await policies.upsertEmployeeGroup(group)).toMatchObject({
			success: false,
			code: "ValidationError",
			refusal: "former_employee",
		});
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("refuses duplicate employee group members", async () => {
		expect(
			await policies.upsertEmployeeGroup({ ...group, employeeIds: ["employee-3", "employee-3"] }),
		).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Employee group members must be unique.",
		});
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("refuses an active policy without stages", async () => {
		expect(await policies.upsertApprovalPolicy({ ...policy, isActive: true })).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Active policies require at least one approval stage.",
		});
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it("keeps the safe message when the policy save fails", async () => {
		mocks.transaction.mockRejectedValue(new Error("deadlock"));

		expect(await policies.upsertApprovalPolicy(policy)).toMatchObject({
			success: false,
			error: "Approval policy could not be saved.",
		});
	});
});

describe("approval triage settings", () => {
	it("saves the thresholds for the active organization as the caller", async () => {
		expect(
			await triage.saveApprovalTriageSettingsAction({
				staleAfterHours: 24,
				smallCorrectionMinutes: 5,
			}),
		).toEqual({ success: true, data: { staleAfterHours: 24, smallCorrectionMinutes: 5 } });
		expect(mocks.saveTriage).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			actorUserId: "user-1",
			staleAfterHours: 24,
			smallCorrectionMinutes: 5,
		});
	});

	it.each([
		[
			{ staleAfterHours: 0, smallCorrectionMinutes: 5 },
			"Stale age must be a whole number from 1 to 720 hours.",
		],
		[
			{ staleAfterHours: 24, smallCorrectionMinutes: 0.5 },
			"Small correction must be a whole number from 0 to 60 minutes.",
		],
		[{ staleAfterHours: 24 }, "Provide both approval triage thresholds."],
		[null, "Provide both approval triage thresholds."],
	])("refuses %j", async (input, error) => {
		expect(await triage.saveApprovalTriageSettingsAction(input)).toMatchObject({
			success: false,
			code: "ValidationError",
			error,
		});
		expect(mocks.saveTriage).not.toHaveBeenCalled();
	});
});
