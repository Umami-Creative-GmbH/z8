import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const updateWhere = vi.fn(async () => undefined);
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));
	const values = vi.fn(async () => undefined);
	const insert = vi.fn(() => ({ values }));
	const findFirst = vi.fn(async () => null);
	const where = vi.fn(async () => []);
	const from = vi.fn(() => ({ where }));
	const select = vi.fn(() => ({ from }));

	return {
		connection: vi.fn(),
		findFirst,
		getSession: vi.fn(),
		headers: vi.fn(),
		insert,
		isTelegramEnabledForOrganization: vi.fn(),
		select,
		update,
		updateSet,
		updateWhere,
		values,
		where,
	};
});

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: mockState.connection,
	};
});

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/db", () => ({
	db: {
		insert: mockState.insert,
		query: {
			notificationPreference: {
				findFirst: mockState.findFirst,
			},
		},
		select: mockState.select,
		update: mockState.update,
	},
}));

vi.mock("@/db/schema", () => ({
	notificationPreference: {
		channel: "notificationPreference.channel",
		enabled: "notificationPreference.enabled",
		id: "notificationPreference.id",
		notificationType: "notificationPreference.notificationType",
		organizationId: "notificationPreference.organizationId",
		userId: "notificationPreference.userId",
	},
}));

vi.mock("@/lib/telegram", () => ({
	isTelegramEnabledForOrganization: mockState.isTelegramEnabledForOrganization,
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
}));

const { GET } = await import("./route");

describe("GET /api/notifications/preferences", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue(new Headers());
		mockState.getSession.mockResolvedValue({
			session: { activeOrganizationId: "org-active" },
			user: { id: "user-1" },
		});
		mockState.findFirst.mockResolvedValue(null);
		mockState.where.mockResolvedValue([]);
		mockState.isTelegramEnabledForOrganization.mockResolvedValue(false);
	});

	it("returns organization-scoped channel availability using the Telegram availability helper", async () => {
		mockState.isTelegramEnabledForOrganization.mockResolvedValue(true);

		const response = await GET();
		const body = await response.json();

		expect(body.availableChannels).toEqual({
			in_app: true,
			push: true,
			email: true,
			teams: false,
			telegram: true,
			discord: false,
			slack: false,
		});
		expect(JSON.stringify(body)).not.toContain("botToken");
		expect(JSON.stringify(body)).not.toContain("webhookSecret");
		expect(mockState.isTelegramEnabledForOrganization).toHaveBeenCalledWith("org-active");
	});

	it("reads preferences by user while keeping channel availability organization-scoped", async () => {
		await GET();

		expect(mockState.where).toHaveBeenCalledWith({
			column: "notificationPreference.userId",
			type: "eq",
			value: "user-1",
		});
		expect(mockState.isTelegramEnabledForOrganization).toHaveBeenCalledWith("org-active");
	});

	it("rejects bulk updates when enabled is not boolean", async () => {
		const { POST } = await import("./route");
		const response = await POST(
			new Request("https://z8.test/api/notifications/preferences", {
				body: JSON.stringify({
					preferences: [
						{
							channel: "email",
							enabled: "false",
							notificationType: "approval_request_submitted",
						},
					],
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid enabled value" });
		expect(mockState.findFirst).not.toHaveBeenCalled();
	});

	it("persists bulk updates using the user-level unique key without stamping organizationId", async () => {
		const { POST } = await import("./route");
		mockState.findFirst.mockResolvedValue({ id: "pref-1" });

		const response = await POST(
			new Request("https://z8.test/api/notifications/preferences", {
				body: JSON.stringify({
					preferences: [
						{
							channel: "email",
							enabled: false,
							notificationType: "approval_request_submitted",
						},
					],
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(200);
		expect(mockState.findFirst).toHaveBeenCalledWith({
			where: {
				conditions: [
					{ column: "notificationPreference.userId", type: "eq", value: "user-1" },
					{
						column: "notificationPreference.notificationType",
						type: "eq",
						value: "approval_request_submitted",
					},
					{ column: "notificationPreference.channel", type: "eq", value: "email" },
				],
				type: "and",
			},
		});
		expect(mockState.updateSet).toHaveBeenCalledWith({
			enabled: false,
		});
	});
});
