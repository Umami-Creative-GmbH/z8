import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	/** `${action}:${subject}` pairs the caller's ability grants. */
	granted: [] as string[],
	employeeFindFirst: vi.fn(),
	userSettingsFindFirst: vi.fn(),
	service: {
		checkRestPeriod: vi.fn(),
		getProactiveAlerts: vi.fn(),
		getComplianceStatus: vi.fn(),
		getOvertimeStats: vi.fn(),
		requestException: vi.fn(),
		hasValidException: vi.fn(),
		getMyExceptions: vi.fn(),
	},
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect } = await import("effect");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { ORGANIZATION_ABILITY_QUERY } = await import("@/lib/authorization/organization-ability");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				query: {
					employee: { findFirst: mocks.employeeFindFirst },
					userSettings: { findFirst: mocks.userSettingsFindFirst },
				},
			},
			query: (name, fn) =>
				name === ORGANIZATION_ABILITY_QUERY
					? (Effect.succeed({
							can: (action: string, subject: unknown) =>
								mocks.granted.includes(
									`${action}:${typeof subject === "string" ? subject : "Approval"}`,
								),
						}) as never)
					: Effect.promise(fn),
		}),
	);
});

vi.mock("@/lib/effect/services/compliance-guardrail.service", async () => {
	const { Context, Effect, Layer } = await import("effect");
	const ComplianceGuardrailService = Context.Service<unknown>("ComplianceGuardrailService");
	const call =
		(fn: (...args: unknown[]) => unknown) =>
		(...args: unknown[]) =>
			Effect.promise(async () => fn(...args));
	return {
		ComplianceGuardrailService,
		ComplianceGuardrailServiceLive: Layer.succeed(
			ComplianceGuardrailService,
			Object.fromEntries(
				Object.entries(mocks.service).map(([name, fn]) => [name, call(fn)]),
			) as never,
		),
	};
});

vi.mock("@/lib/approvals/policies/manager-eligibility-db", () => ({
	getPrimaryEligibleManagerIdForRequester: vi.fn(async () => "manager-1"),
}));

vi.mock("@/lib/notifications/compliance-triggers", () => ({
	onComplianceExceptionApproved: vi.fn(async () => undefined),
	onComplianceExceptionRejected: vi.fn(async () => undefined),
	onComplianceExceptionRequested: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
}));

const actions = await import("./actions");

const member: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};
const orgAdmin: StubCaller = {
	...member,
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};

const employeeRecord = {
	id: "employee-1",
	organizationId: "org-1",
	userId: "user-1",
	role: "employee",
	user: { name: "Ada Lovelace" },
};

/** Every member-level action, called with valid input. */
const memberActions = {
	checkRestPeriod: () => actions.checkRestPeriod(),
	getProactiveAlerts: () => actions.getProactiveAlerts({ currentSessionMinutes: 60 }),
	getComplianceStatus: () => actions.getComplianceStatus({ currentSessionMinutes: 60 }),
	getOvertimeStats: () => actions.getOvertimeStats(),
	requestComplianceException: () =>
		actions.requestComplianceException({ exceptionType: "rest_period", reason: "Deadline" }),
	hasValidException: () => actions.hasValidException({ exceptionType: "rest_period" }),
	getMyExceptions: () => actions.getMyExceptions({ includeExpired: false }),
};

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = member;
	mocks.granted = [];
	mocks.employeeFindFirst.mockResolvedValue(employeeRecord);
	mocks.userSettingsFindFirst.mockResolvedValue({ timezone: "Europe/Berlin" });
	for (const fn of Object.values(mocks.service)) fn.mockResolvedValue(undefined);
	mocks.service.requestException.mockResolvedValue("exception-1");
});

const serviceCalls = () =>
	Object.values(mocks.service).reduce((count, fn) => count + fn.mock.calls.length, 0);

describe("compliance actions", () => {
	it.each(
		Object.entries(memberActions).flatMap(([name, call]) => [
			[name, "a pending membership", { ...member, membershipRole: null }, call],
			[
				name,
				"a former employee",
				{ ...member, employee: { id: "employee-1", role: "employee" as const, former: true } },
				call,
			],
		]),
	)("%s refuses %s", async (_name, _case, caller, call) => {
		mocks.caller = caller as StubCaller;

		expect(await (call as () => Promise<unknown>)()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(serviceCalls()).toBe(0);
	});

	it("checks the rest period of the caller's own employee record in their timezone", async () => {
		await actions.checkRestPeriod();

		expect(mocks.service.checkRestPeriod).toHaveBeenCalledWith({
			employeeId: "employee-1",
			timezone: "Europe/Berlin",
		});
	});

	it("tells an org admin without an employee record that there is no employee profile", async () => {
		mocks.caller = { ...orgAdmin, employee: null };

		expect(await actions.getOvertimeStats()).toMatchObject({
			success: false,
			code: "NotFoundError",
		});
	});

	it("requests an exception in the active organization for the caller", async () => {
		expect(
			await actions.requestComplianceException({
				exceptionType: "rest_period",
				reason: "Deadline",
			}),
		).toEqual({ success: true, data: { exceptionId: "exception-1" } });
		expect(mocks.service.requestException).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-1",
				organizationId: "org-1",
				createdBy: "user-1",
			}),
		);
	});

	it("rejects an unknown exception type before requesting it", async () => {
		expect(
			await actions.requestComplianceException({ exceptionType: "holiday" as never, reason: "x" }),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.service.requestException).not.toHaveBeenCalled();
	});
});
