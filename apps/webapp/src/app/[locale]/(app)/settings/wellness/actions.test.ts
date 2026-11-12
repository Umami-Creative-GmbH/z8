import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	findFirst: vi.fn(),
	writeUserSettings: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { query: { userSettings: { findFirst: mocks.findFirst } } },
		}),
	);
});

vi.mock("@/lib/user-preferences/user-settings-mutation", () => ({
	writeUserSettings: mocks.writeUserSettings,
}));

const { getWellnessSettings, updateWellnessSettings } = await import("./actions");

const orgMember: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};
/** One level below org member: no settings access at all. */
const pendingMember: StubCaller = { ...orgMember, membershipRole: null };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgMember;
	mocks.findFirst.mockResolvedValue(undefined);
	mocks.writeUserSettings.mockResolvedValue(undefined);
});

describe("getWellnessSettings", () => {
	it("returns the defaults before the user saved any", async () => {
		await expect(getWellnessSettings()).resolves.toEqual({
			success: true,
			data: { enabled: false, preset: "moderate", intervalMinutes: 45, dailyGoal: 8 },
		});
	});

	it("refuses a pending membership", async () => {
		mocks.caller = pendingMember;

		await expect(getWellnessSettings()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.findFirst).not.toHaveBeenCalled();
	});
});

describe("updateWellnessSettings", () => {
	it("saves a preset's interval instead of the submitted one", async () => {
		const result = await updateWellnessSettings({
			enabled: true,
			preset: "active",
			intervalMinutes: 90,
			dailyGoal: 10,
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.writeUserSettings).toHaveBeenCalledWith(expect.anything(), "user-1", {
			waterReminderEnabled: true,
			waterReminderPreset: "active",
			waterReminderIntervalMinutes: 30,
			waterReminderDailyGoal: 10,
		});
	});

	it("rejects a custom interval out of range", async () => {
		const result = await updateWellnessSettings({
			enabled: true,
			preset: "custom",
			intervalMinutes: 1,
			dailyGoal: 8,
		});

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.writeUserSettings).not.toHaveBeenCalled();
	});

	it("refuses a pending membership", async () => {
		mocks.caller = pendingMember;

		const result = await updateWellnessSettings({
			enabled: true,
			preset: "moderate",
			intervalMinutes: 45,
			dailyGoal: 8,
		});

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.writeUserSettings).not.toHaveBeenCalled();
	});
});
