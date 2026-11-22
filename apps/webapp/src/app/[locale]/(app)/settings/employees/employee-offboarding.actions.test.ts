import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	gate: { released: false },
	getDepartureCommands: vi.fn(),
	getOffboardingQueries: vi.fn(),
	getOffboardingFollowUp: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { Effect } = await import("effect");
	const { makeDatabaseService } = await import("@/lib/effect/services/database.service");
	const { query } = makeDatabaseService({});
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			query: (name, fn) =>
				name === "organizationAction.managedScope"
					? (Effect.succeed([[], []]) as never)
					: name === "employeeLifecycle.findNotOnCurrentRoster"
						? (Effect.succeed([]) as never)
						: query(name, fn),
		}),
	);
});

vi.mock("@/lib/employee-lifecycle", async () => {
	const reviews = await import("@/lib/employee-lifecycle/reviews");
	const handover = await import("@/lib/employee-lifecycle/approval-handover");
	const commands = await import("@/lib/employee-lifecycle/commands");
	return {
		getDepartureCommands: mocks.getDepartureCommands,
		getOffboardingQueries: mocks.getOffboardingQueries,
		getOffboardingFollowUp: mocks.getOffboardingFollowUp,
		DepartureCommandError: commands.DepartureCommandError,
		ResolveDepartureReviewError: reviews.ResolveDepartureReviewError,
		RetryDepartureTaskError: reviews.RetryDepartureTaskError,
		AssignDepartureReplacementError: handover.AssignDepartureReplacementError,
	};
});

vi.mock("@/lib/employee-lifecycle/release", () => ({
	get EMPLOYEE_OFFBOARDING_RELEASE_READY() {
		return mocks.gate.released;
	},
}));

import { ResolveDepartureReviewError } from "@/lib/employee-lifecycle/reviews";
import {
	assignDepartureReplacementAction,
	cancelEmployeeDepartureAction,
	correctPastDepartureDateAction,
	getEmployeeOffboardingViewAction,
	getReplacementEmployeeAction,
	offboardEmployeeNowAction,
	previewEmployeeDepartureAction,
	previewPastDepartureAction,
	recordHistoricalDepartureDateAction,
	recordPastDepartureAction,
	rehireEmployeeAction,
	resolveDepartureReviewAction,
	retryDepartureTaskAction,
	scheduleEmployeeDepartureAction,
	searchReplacementEmployeesAction,
} from "./employee-offboarding.actions";

const uuid = "11111111-1111-4111-8111-111111111111";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const scopedManager: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "manager-1", role: "manager", former: false },
};
const orgMember: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};

const scheduleInput = {
	employeeId: uuid,
	requestId: uuid,
	expectedRevision: null,
	lastWorkingDay: "2026-09-30",
	replacementEmployeeId: null,
	acknowledgeUnassignedDuties: true,
};
const offboardInput = {
	employeeId: uuid,
	requestId: uuid,
	replacementEmployeeId: null,
	acknowledgeUnassignedDuties: true,
};
const rehireInput = {
	employeeId: uuid,
	requestId: uuid,
	previousEmploymentPeriodId: uuid,
	role: "employee" as const,
	teamId: null,
	primaryManagerId: null,
	workPolicyId: uuid,
	weeklyContractMinutes: 2400,
	contractType: "fixed" as const,
	workModel: "fixed_hours" as never,
	hourlyRate: null,
	currency: "EUR",
	probationStartsOn: null,
	probationEndsOn: null,
	changeReason: null,
};

const recordPastInput = {
	employeeId: uuid,
	requestId: uuid,
	lastWorkingDay: "2026-08-31",
	replacementEmployeeId: null,
	acknowledgeUnassignedDuties: true,
};
const correctPastInput = {
	employeeId: uuid,
	departureId: uuid,
	expectedRevision: 1,
	requestId: uuid,
	lastWorkingDay: "2026-08-30",
};
const historicalInput = {
	employeeId: uuid,
	requestId: uuid,
	lastWorkingDay: "2025-12-31",
};

const departureCommands = [
	["schedule", () => scheduleEmployeeDepartureAction(scheduleInput)],
	[
		"cancel",
		() =>
			cancelEmployeeDepartureAction({
				employeeId: uuid,
				departureId: uuid,
				expectedRevision: 1,
				requestId: uuid,
			}),
	],
	["offboard now", () => offboardEmployeeNowAction(offboardInput)],
	["record past", () => recordPastDepartureAction(recordPastInput)],
	[
		"preview",
		() => previewEmployeeDepartureAction({ employeeId: uuid, lastWorkingDay: "2026-09-30" }),
	],
	[
		"preview past",
		() => previewPastDepartureAction({ employeeId: uuid, lastWorkingDay: "2026-08-31" }),
	],
] as const;

const followUpCommands = [
	["retry", () => retryDepartureTaskAction({ taskId: uuid })],
	[
		"replacement",
		() =>
			assignDepartureReplacementAction({
				departureId: uuid,
				handoverTaskId: uuid,
				replacementEmployeeId: uuid,
				requestId: uuid,
			}),
	],
	["resolution", () => resolveDepartureReviewAction({ reviewId: uuid, resolution: "Ok" })],
	["correct past date", () => correctPastDepartureDateAction(correctPastInput)],
	["record historical date", () => recordHistoricalDepartureDateAction(historicalInput)],
	[
		"search replacements",
		() => searchReplacementEmployeesAction({ excludeEmployeeId: uuid, limit: 20 }),
	],
	["get replacement", () => getReplacementEmployeeAction({ employeeId: uuid })],
] as const;

describe("employee offboarding actions before release", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.gate.released = false;
		mocks.caller = orgAdmin;
	});

	it.each(departureCommands)("rejects %s without touching the commands", async (_label, run) => {
		const result = await run();

		expect(result).toMatchObject({
			success: false,
			error: "Employee offboarding is not available yet.",
		});
		expect(mocks.getDepartureCommands).not.toHaveBeenCalled();
		expect(mocks.getOffboardingQueries).not.toHaveBeenCalled();
	});
});

describe("employee offboarding follow-up actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.gate.released = false;
		mocks.caller = orgAdmin;
	});

	it("never offers departure commands in the view before release", async () => {
		mocks.getOffboardingQueries.mockReturnValue({
			view: vi.fn().mockResolvedValue({
				kind: "ok",
				view: {
					state: "offboarded",
					capabilities: {
						schedule: true,
						cancel: true,
						offboardNow: true,
						rehire: true,
						resolve: true,
					},
				},
			}),
		});

		const result = await getEmployeeOffboardingViewAction({ employeeId: uuid });

		expect(result).toMatchObject({
			success: true,
			data: {
				capabilities: {
					schedule: false,
					cancel: false,
					offboardNow: false,
					rehire: false,
					resolve: true,
				},
			},
		});
	});

	it("scopes the view to the actor's organization and maps a foreign employee to not found", async () => {
		mocks.caller = scopedManager;
		const view = vi.fn().mockResolvedValue({ kind: "not_found" });
		mocks.getOffboardingQueries.mockReturnValue({ view });

		const result = await getEmployeeOffboardingViewAction({ employeeId: uuid });

		expect(view).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: uuid,
			actorUserId: "user-1",
		});
		expect(result).toMatchObject({ success: false, error: "Employee not found." });
	});

	it("refuses the view to an org member, one level below a scoped manager", async () => {
		mocks.caller = orgMember;

		const result = await getEmployeeOffboardingViewAction({ employeeId: uuid });

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.getOffboardingQueries).not.toHaveBeenCalled();
	});

	it("keeps review resolution available before release and surfaces server guidance", async () => {
		const resolveReview = vi
			.fn()
			.mockRejectedValue(new ResolveDepartureReviewError("repair_incomplete"));
		mocks.getOffboardingFollowUp.mockReturnValue({ resolveReview });

		const result = await resolveDepartureReviewAction({ reviewId: uuid, resolution: "Checked" });

		expect(resolveReview).toHaveBeenCalledWith(
			{ userId: "user-1", organizationId: "org-1" },
			{ reviewId: uuid, resolution: "Checked" },
		);
		expect(result).toMatchObject({
			success: false,
			error:
				"The timer is still running. Correct it through time corrections before resolving this review.",
		});
	});

	it.each(followUpCommands)(
		"refuses %s to a scoped manager, one level below org admin",
		async (_label, run) => {
			mocks.caller = scopedManager;

			const result = await run();

			expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
			expect(mocks.getOffboardingFollowUp).not.toHaveBeenCalled();
		},
	);

	it("rejects malformed follow-up input before reaching the command", async () => {
		const result = await retryDepartureTaskAction({ taskId: "not-a-task" });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.getOffboardingFollowUp).not.toHaveBeenCalled();
	});
});

describe("employee offboarding actions after release", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.gate.released = true;
		mocks.caller = orgAdmin;
	});

	it("schedules through the commands as the organization-scoped actor", async () => {
		const scheduleDeparture = vi.fn().mockResolvedValue({ departureId: uuid, revision: 1 });
		mocks.getDepartureCommands.mockReturnValue({ scheduleDeparture });

		const result = await scheduleEmployeeDepartureAction({
			...scheduleInput,
			cutoff: "ignored",
		} as typeof scheduleInput);

		expect(result).toEqual({ success: true, data: { departureId: uuid, revision: 1 } });
		expect(scheduleDeparture).toHaveBeenCalledWith(
			{ userId: "user-1", organizationId: "org-1" },
			scheduleInput,
		);
	});

	it("maps command refusals to the server's guidance", async () => {
		const { DepartureCommandError } = await import("@/lib/employee-lifecycle/commands");
		mocks.getDepartureCommands.mockReturnValue({
			offboardNow: vi.fn().mockRejectedValue(new DepartureCommandError("final_accessible_owner")),
		});

		const result = await offboardEmployeeNowAction(offboardInput);

		expect(result).toMatchObject({
			success: false,
			error: "Assign and activate another approved owner before this employee leaves.",
		});
	});

	it.each([...departureCommands, ["rehire", () => rehireEmployeeAction(rehireInput)]] as const)(
		"refuses %s to a scoped manager, one level below org admin",
		async (_label, run) => {
			mocks.caller = scopedManager;

			const result = await run();

			expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
			expect(mocks.getDepartureCommands).not.toHaveBeenCalled();
			expect(mocks.getOffboardingQueries).not.toHaveBeenCalled();
		},
	);

	it("offers the server's departure capabilities in the view", async () => {
		mocks.getOffboardingQueries.mockReturnValue({
			view: vi.fn().mockResolvedValue({
				kind: "ok",
				view: {
					state: "active",
					capabilities: {
						schedule: true,
						cancel: false,
						offboardNow: true,
						rehire: false,
						resolve: false,
					},
				},
			}),
		});

		const result = await getEmployeeOffboardingViewAction({ employeeId: uuid });

		expect(result).toMatchObject({
			success: true,
			data: { capabilities: { schedule: true, offboardNow: true } },
		});
	});

	it("records a retrospective departure and maps past-date refusals", async () => {
		const { DepartureCommandError } = await import("@/lib/employee-lifecycle/commands");
		const recordPastDeparture = vi.fn().mockResolvedValue({
			departureId: uuid,
			revision: 1,
			employmentPeriodId: uuid,
			lastWorkingDay: "2026-08-31",
			cutoff: "2026-09-01T00:00:00Z",
			workAfterCutoffReviewId: null,
			payrollReconciliationReviewId: null,
		});
		mocks.getDepartureCommands.mockReturnValue({ recordPastDeparture });

		const ok = await recordPastDepartureAction(recordPastInput);
		expect(ok).toMatchObject({ success: true, data: { departureId: uuid, revision: 1 } });
		expect(recordPastDeparture).toHaveBeenCalledWith(
			{ userId: "user-1", organizationId: "org-1" },
			recordPastInput,
		);

		mocks.getDepartureCommands.mockReturnValue({
			correctPastDepartureDate: vi
				.fn()
				.mockRejectedValue(new DepartureCommandError("departure_reopen_forbidden")),
		});
		const refused = await correctPastDepartureDateAction(correctPastInput);
		expect(refused).toMatchObject({
			success: false,
			error:
				"An effective departure cannot be reopened by moving its date to today or the future. Rehire the employee instead.",
		});
	});

	it("searches eligible replacements bounded to the actor organization", async () => {
		const searchReplacements = vi.fn().mockResolvedValue({
			items: [],
			nextCursor: null,
			hasMore: false,
		});
		mocks.getOffboardingQueries.mockReturnValue({ searchReplacements });

		const result = await searchReplacementEmployeesAction({
			excludeEmployeeId: uuid,
			search: "Robin",
			limit: 25,
		});

		expect(result).toEqual({
			success: true,
			data: { items: [], nextCursor: null, hasMore: false },
		});
		expect(searchReplacements).toHaveBeenCalledWith({
			organizationId: "org-1",
			excludeEmployeeId: uuid,
			search: "Robin",
			cursor: null,
			limit: 25,
		});
	});
});
