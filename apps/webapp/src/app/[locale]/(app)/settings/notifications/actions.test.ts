import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	findFirst: vi.fn(),
	insertValues: vi.fn(),
	updateWhere: vi.fn(),
	selectWhere: vi.fn(),
	getOrganizationChatChannelAvailability: vi.fn(),
}));

const database = vi.hoisted(() => ({
	query: { notificationPreference: { findFirst: mocks.findFirst } },
	insert: () => ({ values: mocks.insertValues }),
	update: () => ({ set: () => ({ where: mocks.updateWhere }) }),
	select: () => ({ from: () => ({ where: mocks.selectWhere }) }),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: database,
		}),
	);
});

vi.mock("@/lib/chat-installations/member-links", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/chat-installations/member-links")>();
	return {
		...actual,
		getOrganizationChatChannelAvailability: mocks.getOrganizationChatChannelAvailability,
	};
});

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
const noOrgUser: StubCaller = {
	userId: "user-1",
	activeOrganizationId: null,
	membershipRole: null,
	employee: null,
};
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

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgMember;
	mocks.findFirst.mockResolvedValue(null);
	mocks.selectWhere.mockResolvedValue([]);
	mocks.getOrganizationChatChannelAvailability.mockResolvedValue({
		teams: false,
		telegram: false,
		discord: false,
		slack: false,
	});
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
		expect(mocks.getOrganizationChatChannelAvailability).toHaveBeenCalledWith("org-1", {
			db: database,
		});
	});

	it("marks the active organization's configured channels as available via shared availability reader", async () => {
		mocks.getOrganizationChatChannelAvailability.mockResolvedValue({
			teams: true,
			telegram: true,
			discord: true,
			slack: true,
		});

		const result = await getNotificationPreferences();

		expect(result).toMatchObject({
			success: true,
			data: { availableChannels: { teams: true, telegram: true, discord: true, slack: true } },
		});
		expect(mocks.getOrganizationChatChannelAvailability).toHaveBeenCalledWith("org-1", {
			db: database,
		});
	});

	it("preserves account-wide preferences when active organization context is absent", async () => {
		mocks.caller = noOrgUser;
		mocks.selectWhere.mockResolvedValue([
			{
				id: "pref-1",
				userId: "user-1",
				notificationType: "approval_request_submitted",
				channel: "email",
				enabled: false,
			},
		]);

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
		if (result.success) {
			expect(result.data.matrix.approval_request_submitted.email).toBe(false);
		}
		expect(mocks.getOrganizationChatChannelAvailability).toHaveBeenCalledWith(null, { db: database });
	});

	it.each([
		["a pending membership", pendingMember],
		["a former employee", formerEmployee],
	])(
		"preserves account-wide preferences for %s while keeping org channels unavailable",
		async (_name, caller) => {
			mocks.caller = caller;

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
			expect(mocks.getOrganizationChatChannelAvailability).toHaveBeenCalledWith(null, { db: database });
		},
	);

	it("refuses signed-out callers", async () => {
		mocks.caller = null;

		const result = await getNotificationPreferences();

		expect(result).toMatchObject({ success: false, code: "AuthenticationError" });
		expect(mocks.selectWhere).not.toHaveBeenCalled();
	});
});

describe("updateNotificationPreference", () => {
	it("stores the signed-in user's preference", async () => {
		const result = await updateNotificationPreference(preference);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.insertValues).toHaveBeenCalledWith({ userId: "user-1", ...preference });
	});

	it("preserves account preference edits when organization context is absent", async () => {
		mocks.caller = noOrgUser;

		const result = await updateNotificationPreference(preference);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mocks.insertValues).toHaveBeenCalledWith({ userId: "user-1", ...preference });
	});

	it("rejects an enabled value that is not a boolean", async () => {
		const result = await updateNotificationPreference({ ...preference, enabled: "false" } as never);

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.insertValues).not.toHaveBeenCalled();
	});

	it("refuses signed-out callers", async () => {
		mocks.caller = null;

		const result = await updateNotificationPreference(preference);

		expect(result).toMatchObject({ success: false, code: "AuthenticationError" });
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

	it("preserves bulk preference edits when organization context is absent", async () => {
		mocks.caller = noOrgUser;

		const result = await bulkUpdateNotificationPreferences([preference]);

		expect(result).toEqual({ success: true, data: { updated: 1 } });
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
});
