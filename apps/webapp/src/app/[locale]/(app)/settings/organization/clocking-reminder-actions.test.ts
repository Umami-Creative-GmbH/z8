import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	save: vi.fn(),
}));
vi.mock("@/lib/time-tracking/clocking-reminders/settings", () => ({
	saveClockingReminderSettings: mocks.save,
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { makeDatabaseService } = await import("@/lib/effect/services/database.service");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, { query: makeDatabaseService({}).query }),
	);
});

import { updateClockingReminderSettings } from "./clocking-reminder-actions";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const input = {
	missedClockIn: { enabled: true, graceMinutes: 20 },
	forgottenClockOut: { enabled: false, graceMinutes: 30 },
	breakDue: { enabled: true, leadMinutes: 10 },
	roles: ["employee" as const, "manager" as const],
};
const saved = { ...input, revision: 1 };

describe("updateClockingReminderSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
		mocks.save.mockResolvedValue(saved);
	});

	it.each([
		["an admin", orgAdmin],
		["an owner", { ...orgAdmin, membershipRole: "owner" }],
	])("lets %s save the active organization's settings", async (_case, caller) => {
		mocks.caller = caller;

		expect(await updateClockingReminderSettings(input)).toEqual({ success: true, data: saved });
		expect(mocks.save).toHaveBeenCalledWith(
			{ ...input, organizationId: "org-1" },
			expect.objectContaining({ database: expect.anything(), clock: expect.anything() }),
		);
	});

	it.each([
		[
			"a scoped manager",
			{
				...orgAdmin,
				membershipRole: "member",
				employee: { id: "e", role: "manager" as const, former: false },
			},
		],
		["a pending membership", { ...orgAdmin, membershipRole: null }],
		[
			"a former admin",
			{ ...orgAdmin, employee: { id: "e", role: "admin" as const, former: true } },
		],
		["a signed-out caller", null],
	])("refuses %s without writing", async (_case, caller) => {
		mocks.caller = caller;

		expect(await updateClockingReminderSettings(input)).toMatchObject({ success: false });
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it.each([
		{ missedClockIn: { enabled: true, graceMinutes: -1 } },
		{ missedClockIn: { enabled: true, graceMinutes: 1441 } },
		{ forgottenClockOut: { enabled: true, graceMinutes: 2.5 } },
		{ breakDue: { enabled: true, leadMinutes: 0 } },
		{ breakDue: { enabled: true, leadMinutes: 1441 } },
		{ breakDue: undefined },
		{ roles: [] },
		{ roles: ["owner"] },
		{ roles: ["employee", "employee"] },
		{ organizationId: "org-other" },
	])("rejects invalid settings %j before writing", async (overrides) => {
		expect(
			await updateClockingReminderSettings({ ...input, ...(overrides as Partial<typeof input>) }),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("does not expose persistence errors", async () => {
		mocks.save.mockRejectedValue(new Error("secret connection string"));

		expect(await updateClockingReminderSettings(input)).toMatchObject({
			success: false,
			error: "Database query failed: clockingReminders.saveSettings",
			code: "DatabaseError",
		});
	});
});
