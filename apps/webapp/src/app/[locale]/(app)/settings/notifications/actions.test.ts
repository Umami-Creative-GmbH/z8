import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	findFirst: vi.fn(),
	insertValues: vi.fn(),
	updateWhere: vi.fn(),
	selectWhere: vi.fn(),
	isTelegramEnabledForOrganization: vi.fn(),
	isTeamsEnabledForOrganization: vi.fn(),
	isDiscordEnabledForOrganization: vi.fn(),
	isSlackEnabledForOrganization: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: {
				query: { notificationPreference: { findFirst: mocks.findFirst } },
				insert: () => ({ values: mocks.insertValues }),
				update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
				select: () => ({ from: () => ({ where: mocks.selectWhere }) }),
			},
		}),
	);
});

vi.mock("@/lib/telegram", () => ({
	isTelegramEnabledForOrganization: mocks.isTelegramEnabledForOrganization,
}));
vi.mock("@/lib/teams", () => ({
	isTeamsEnabledForOrganization: mocks.isTeamsEnabledForOrganization,
}));
vi.mock("@/lib/discord", () => ({
	isDiscordEnabledForOrganization: mocks.isDiscordEnabledForOrganization,
}));
vi.mock("@/lib/slack", () => ({
	isSlackEnabledForOrganization: mocks.isSlackEnabledForOrganization,
}));

const {
	bulkUpdateNotificationPreferences,
	getNotificationPreferences,
	updateNotificationPreference,
} = await import("./actions");

const orgMember: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-1", role: "employee", former: false },
};
/** One level below org member: no settings access at all. */
const pendingMember: StubCaller = { ...orgMember, membershipRole: null };
const formerEmployee: StubCaller = {
	...orgMember,
	employee: { id: "employee-1", role: "employee", former: true },
};

const preference = {
	notificationType: "approval_request_submitted",
	channel: "email",
	enabled: false,
} as const;

function setAllChannels(enabled: boolean) {
	mocks.isTelegramEnabledForOrganization.mockResolvedValue(enabled);
	mocks.isTeamsEnabledForOrganization.mockResolvedValue(enabled);
	mocks.isDiscordEnabledForOrganization.mockResolvedValue(enabled);
	mocks.isSlackEnabledForOrganization.mockResolvedValue(enabled);
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgMember;
	mocks.findFirst.mockResolvedValue(null);
	mocks.selectWhere.mockResolvedValue([]);
	setAllChannels(false);
});

describe("getNotificationPreferences", () => {
	it("keeps baseline channels available when no organization channels are configured", async () => {
		const result = await getNotificationPreferences();

		expect(result).toMatchObject({
			success: true,
			data: {
				availableChannels: {
					in_app: true,
					push: true,
					email: true,
					teams: false,
					telegram: false,
					discord: false,
					slack: false,
				},
			},
		});
	});

	it("marks the active organization's configured channels as available", async () => {
		setAllChannels(true);

		const result = await getNotificationPreferences();

		expect(result).toMatchObject({
			success: true,
			data: { availableChannels: { teams: true, telegram: true, discord: true, slack: true } },
		});
		expect(mocks.isTelegramEnabledForOrganization).toHaveBeenCalledWith("org-1");
	});

	it.each([
		["a pending membership", pendingMember],
		["a former employee", formerEmployee],
	])("refuses %s", async (_name, caller) => {
		mocks.caller = caller;

		const result = await getNotificationPreferences();

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.selectWhere).not.toHaveBeenCalled();
	});
});

describe("updateNotificationPreference", () => {
	it("stores the signed-in user's preference", async () => {
		const result = await updateNotificationPreference(preference);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.insertValues).toHaveBeenCalledWith({ userId: "user-1", ...preference });
	});

	it("rejects an enabled value that is not a boolean", async () => {
		const result = await updateNotificationPreference({ ...preference, enabled: "false" } as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("refuses a pending membership", async () => {
		mocks.caller = pendingMember;

		const result = await updateNotificationPreference(preference);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});
});

describe("bulkUpdateNotificationPreferences", () => {
	it("stores every preference and counts them", async () => {
		mocks.findFirst.mockResolvedValueOnce({ id: "pref-1" });

		const result = await bulkUpdateNotificationPreferences([
			preference,
			{ ...preference, channel: "push" },
		]);

		expect(result).toEqual({ success: true, data: { updated: 2 } });
		expect(mocks.updateWhere).toHaveBeenCalledTimes(1);
		expect(mocks.insertValues).toHaveBeenCalledTimes(1);
	});

	it("rejects an unknown channel before writing anything", async () => {
		const result = await bulkUpdateNotificationPreferences([
			preference,
			{ ...preference, channel: "carrier-pigeon" } as never,
		]);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("refuses a pending membership", async () => {
		mocks.caller = pendingMember;

		const result = await bulkUpdateNotificationPreferences([preference]);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});
});
