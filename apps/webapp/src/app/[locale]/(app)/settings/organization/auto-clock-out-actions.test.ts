import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	save: vi.fn(),
}));
vi.mock("@/lib/time-tracking/automatic-clock-out/settings", () => ({
	saveAutoClockOutSettings: mocks.save,
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const { makeDatabaseService } = await import("@/lib/effect/services/database.service");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, { query: makeDatabaseService({}).query }),
	);
});

import { updateAutoClockOutSettings } from "./auto-clock-out-actions";

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "employee-1", role: "admin", former: false },
};
const input = { autoClockOutEnabled: true, maxUninterruptedMinutes: 720 };

describe("updateAutoClockOutSettings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.caller = orgAdmin;
		mocks.save.mockResolvedValue({ ...input, revision: 1 });
	});

	it.each([
		["an admin", orgAdmin],
		["an owner", { ...orgAdmin, membershipRole: "owner" }],
	])("lets %s save the active organization's settings", async (_case, caller) => {
		mocks.caller = caller;

		expect(await updateAutoClockOutSettings(input)).toEqual({
			success: true,
			data: { ...input, revision: 1 },
		});
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
		["a refused SSO session", { ...orgAdmin, organizationAccessRefused: true }],
		["a signed-out caller", null],
	])("refuses %s without writing", async (_case, caller) => {
		mocks.caller = caller;

		expect(await updateAutoClockOutSettings(input)).toMatchObject({ success: false });
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it("refuses a submitted organization ID instead of trusting it", async () => {
		const result = await updateAutoClockOutSettings({
			...input,
			organizationId: "org-other",
		} as typeof input);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.save).not.toHaveBeenCalled();
	});

	it.each([0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
		"rejects invalid duration %s before writing",
		async (maxUninterruptedMinutes) => {
			expect(await updateAutoClockOutSettings({ ...input, maxUninterruptedMinutes })).toMatchObject(
				{
					success: false,
					error: "Enter a valid automatic clock-out duration",
				},
			);
			expect(mocks.save).not.toHaveBeenCalled();
		},
	);

	it("saves a retained duration while disabled", async () => {
		await updateAutoClockOutSettings({ autoClockOutEnabled: false, maxUninterruptedMinutes: 485 });

		expect(mocks.save).toHaveBeenCalledWith(
			{ autoClockOutEnabled: false, maxUninterruptedMinutes: 485, organizationId: "org-1" },
			expect.anything(),
		);
	});

	it("does not expose persistence errors", async () => {
		mocks.save.mockRejectedValue(new Error("secret connection string"));

		expect(await updateAutoClockOutSettings(input)).toMatchObject({
			success: false,
			error: "Database query failed: autoClockOut.saveSettings",
			code: "DatabaseError",
		});
	});
});
