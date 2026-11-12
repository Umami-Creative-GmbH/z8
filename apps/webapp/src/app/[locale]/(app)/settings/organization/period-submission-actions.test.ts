import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	save: vi.fn(),
}));
vi.mock("@/lib/time-tracking/period-submissions/settings", () => ({
	savePeriodSubmissionSettings: mocks.save,
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { makeDatabaseService } = await import("@/lib/effect/services/database.service");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, { query: makeDatabaseService({}).query }),
	);
});

import { updatePeriodSubmissionSettings } from "./period-submission-actions";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const input = {
	cadence: { kind: "weekly" as const, weekStartDay: "monday" as const },
	secondReminderDelayDays: 3,
};
const saved = {
	cadence: { kind: "weekly", weekStartDay: "monday" },
	inEffect: { kind: "off" },
	upcoming: { cadence: { kind: "weekly", weekStartDay: "monday" }, fromDate: "2026-03-09" },
	secondReminderDelayDays: 3,
	revision: 1,
};

describe("updatePeriodSubmissionSettings", () => {
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

		expect(await updatePeriodSubmissionSettings(input)).toEqual({ success: true, data: saved });
		expect(mocks.save).toHaveBeenCalledWith(
			{ ...input, organizationId: "org-1", actorUserId: "user-1" },
			expect.objectContaining({ database: expect.anything(), clock: expect.anything() }),
		);
	});

	it.each([
		// Managers are ordinary organization members whose employee role is manager.
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

		expect(await updatePeriodSubmissionSettings(input)).toMatchObject({ success: false });
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("saves a monthly cadence and switching off without a week start", async () => {
		await updatePeriodSubmissionSettings({ ...input, cadence: { kind: "monthly" } });
		await updatePeriodSubmissionSettings({ ...input, cadence: { kind: "off" } });

		expect(mocks.save.mock.calls.map(([saveInput]) => saveInput.cadence)).toEqual([
			{ kind: "monthly" },
			{ kind: "off" },
		]);
	});

	it.each([
		["a weekly cadence without a week start", { ...input, cadence: { kind: "weekly" } }],
		["an unknown week start", { ...input, cadence: { kind: "weekly", weekStartDay: "someday" } }],
		["an unknown cadence", { ...input, cadence: { kind: "daily" } }],
		["a delay of 0 days", { ...input, secondReminderDelayDays: 0 }],
		["a delay of 31 days", { ...input, secondReminderDelayDays: 31 }],
		["a fractional delay", { ...input, secondReminderDelayDays: 1.5 }],
		["a submitted organization", { ...input, organizationId: "org-other" }],
	])("rejects %s before writing", async (_label, invalid) => {
		expect(
			await updatePeriodSubmissionSettings(
				invalid as unknown as Parameters<typeof updatePeriodSubmissionSettings>[0],
			),
		).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("does not expose persistence errors", async () => {
		mocks.save.mockRejectedValue(new Error("secret connection string"));

		expect(await updatePeriodSubmissionSettings(input)).toMatchObject({
			success: false,
			error: "Database query failed: periodSubmissions.saveSettings",
		});
	});
});
