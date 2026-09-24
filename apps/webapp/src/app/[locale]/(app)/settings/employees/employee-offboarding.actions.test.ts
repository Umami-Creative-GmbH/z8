import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toServerActionResult } from "@/lib/effect/result";

const mocks = vi.hoisted(() => ({
	getEmployeeSettingsActorContext: vi.fn(),
	getDepartureCommands: vi.fn(),
	runTracedEmployeeAction: vi.fn(),
}));

vi.mock("@/lib/employee-lifecycle", () => ({
	getDepartureCommands: mocks.getDepartureCommands,
}));

vi.mock("./employee-action-utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("./employee-action-utils")>()),
	getEmployeeSettingsActorContext: mocks.getEmployeeSettingsActorContext,
	runTracedEmployeeAction: mocks.runTracedEmployeeAction,
}));

import {
	cancelEmployeeDepartureAction,
	offboardEmployeeNowAction,
	rehireEmployeeAction,
	scheduleEmployeeDepartureAction,
} from "./employee-offboarding.actions";

describe("employee offboarding actions before release", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.runTracedEmployeeAction.mockImplementation((options) =>
			Effect.runPromiseExit(options.execute({ setAttribute: vi.fn() })).then(toServerActionResult),
		);
	});

	it.each([
		["schedule", () => scheduleEmployeeDepartureAction({})],
		["cancel", () => cancelEmployeeDepartureAction({})],
		["offboard now", () => offboardEmployeeNowAction({})],
		["rehire", () => rehireEmployeeAction({})],
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
