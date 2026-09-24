import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toServerActionResult } from "@/lib/effect/result";

const mocks = vi.hoisted(() => ({
	gate: { released: false },
	getEmployeeSettingsActorContext: vi.fn(),
	getDepartureCommands: vi.fn(),
	getOffboardingQueries: vi.fn(),
	getOffboardingFollowUp: vi.fn(),
	runTracedEmployeeAction: vi.fn(),
}));

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

vi.mock("./employee-action-utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("./employee-action-utils")>()),
	getEmployeeSettingsActorContext: mocks.getEmployeeSettingsActorContext,
	runTracedEmployeeAction: mocks.runTracedEmployeeAction,
	revalidateEmployeesCache: vi.fn(),
}));

import { ResolveDepartureReviewError } from "@/lib/employee-lifecycle/reviews";
import {
	assignDepartureReplacementAction,
	cancelEmployeeDepartureAction,
	getEmployeeOffboardingViewAction,
	offboardEmployeeNowAction,
	previewEmployeeDepartureAction,
	rehireEmployeeAction,
	resolveDepartureReviewAction,
	retryDepartureTaskAction,
	scheduleEmployeeDepartureAction,
} from "./employee-offboarding.actions";

const uuid = "11111111-1111-4111-8111-111111111111";

function actorContext(accessTier: "orgAdmin" | "manager" = "orgAdmin") {
	return Effect.succeed({
		accessTier,
		organizationId: "org-1",
		session: { user: { id: "user-1" } },
	});
}

describe("employee offboarding actions before release", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.gate.released = false;
		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() })).then(toServerActionResult),
		);
	});

	it.each([
		["schedule", () => scheduleEmployeeDepartureAction({})],
		["cancel", () => cancelEmployeeDepartureAction({})],
		["offboard now", () => offboardEmployeeNowAction({})],
		["rehire", () => rehireEmployeeAction({})],
		["preview", () => previewEmployeeDepartureAction({})],
	])("rejects %s without touching actor context or commands", async (_label, run) => {
		const result = await run();

		expect(result).toMatchObject({
			success: false,
			error: "Employee offboarding is not available yet.",
		});
		expect(mocks.getEmployeeSettingsActorContext).not.toHaveBeenCalled();
		expect(mocks.getDepartureCommands).not.toHaveBeenCalled();
	});
});

describe("employee offboarding follow-up actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.gate.released = false;
		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() })).then(toServerActionResult),
		);
	});

	it("never offers departure commands in the view before release", async () => {
		mocks.getEmployeeSettingsActorContext.mockReturnValue(actorContext());
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
		mocks.getEmployeeSettingsActorContext.mockReturnValue(actorContext("manager"));
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

	it("keeps review resolution available before release and surfaces server guidance", async () => {
		mocks.getEmployeeSettingsActorContext.mockReturnValue(actorContext());
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

	it.each([
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
	])("requires organization admin settings access for %s", async (_label, run) => {
		mocks.getEmployeeSettingsActorContext.mockReturnValue(actorContext("manager"));

		const result = await run();

		expect(result).toMatchObject({ success: false });
		expect(mocks.getOffboardingFollowUp).not.toHaveBeenCalled();
	});

	it("rejects malformed follow-up input before reaching the command", async () => {
		mocks.getEmployeeSettingsActorContext.mockReturnValue(actorContext());

		const result = await retryDepartureTaskAction({ taskId: "not-a-task" });

		expect(result).toMatchObject({ success: false });
		expect(mocks.getOffboardingFollowUp).not.toHaveBeenCalled();
	});
});

describe("employee offboarding actions after release", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.gate.released = true;
		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() })).then(toServerActionResult),
		);
		mocks.getEmployeeSettingsActorContext.mockReturnValue(actorContext());
	});

	it("schedules through the commands as the organization-scoped actor", async () => {
		const scheduleDeparture = vi.fn().mockResolvedValue({ departureId: uuid, revision: 1 });
		mocks.getDepartureCommands.mockReturnValue({ scheduleDeparture });
		const input = {
			employeeId: uuid,
			requestId: uuid,
			expectedRevision: null,
			lastWorkingDay: "2026-09-30",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		};

		const result = await scheduleEmployeeDepartureAction({ ...input, cutoff: "ignored" });

		expect(result).toEqual({ success: true, data: { departureId: uuid, revision: 1 } });
		expect(scheduleDeparture).toHaveBeenCalledWith(
			{ userId: "user-1", organizationId: "org-1" },
			input,
		);
	});

	it("maps command refusals to the server's guidance", async () => {
		const { DepartureCommandError } = await import("@/lib/employee-lifecycle/commands");
		mocks.getDepartureCommands.mockReturnValue({
			offboardNow: vi.fn().mockRejectedValue(new DepartureCommandError("final_accessible_owner")),
		});

		const result = await offboardEmployeeNowAction({
			employeeId: uuid,
			requestId: uuid,
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});

		expect(result).toMatchObject({
			success: false,
			error: "Assign and activate another approved owner before this employee leaves.",
		});
	});

	it("still requires organization admin settings access", async () => {
		mocks.getEmployeeSettingsActorContext.mockReturnValue(actorContext("manager"));

		const result = await rehireEmployeeAction({});

		expect(result).toMatchObject({ success: false });
		expect(mocks.getDepartureCommands).not.toHaveBeenCalled();
	});

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
});

