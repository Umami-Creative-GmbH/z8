import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const updateWhere = vi.fn(async () => undefined);
	const updateSet = vi.fn(() => ({ where: updateWhere }));
	const update = vi.fn(() => ({ set: updateSet }));
	const onConflictDoUpdate = vi.fn(async () => undefined);
	const values = vi.fn(() => ({ onConflictDoUpdate }));
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
		onConflictDoUpdate,
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
	const actual =
		await vi.importActual<typeof import("next/server")>("next/server");
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
		updatedAt: "notificationPreference.updatedAt",
		userId: "notificationPreference.userId",
	},
}));

vi.mock("@/lib/telegram", () => ({
	isTelegramEnabledForOrganization: mockState.isTelegramEnabledForOrganization,
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions, type: "and" }),
	eq: (column: unknown, value: unknown) => ({ column, type: "eq", value }),
	sql: (strings: TemplateStringsArray) => ({ sql: strings.join("") }),
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
		expect(mockState.isTelegramEnabledForOrganization).toHaveBeenCalledWith(
			"org-active",
		);
	});

	it("reads preferences by user while keeping channel availability organization-scoped", async () => {
		await GET();

		expect(mockState.where).toHaveBeenCalledWith({
			column: "notificationPreference.userId",
			type: "eq",
			value: "user-1",
		});
		expect(mockState.isTelegramEnabledForOrganization).toHaveBeenCalledWith(
			"org-active",
		);
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

	it("rejects a null bulk update before starting a write", async () => {
		const { POST } = await import("./route");
		const response = await POST(
			new Request("https://z8.test/api/notifications/preferences", {
				body: JSON.stringify({ preferences: [null] }),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Invalid preference update",
		});
		expect(mockState.insert).not.toHaveBeenCalled();
	});

	it("rejects a null request body before starting a write", async () => {
		const { POST } = await import("./route");
		const response = await POST(
			new Request("https://z8.test/api/notifications/preferences", {
				body: JSON.stringify(null),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Invalid preferences array",
		});
		expect(mockState.insert).not.toHaveBeenCalled();
	});

	it("persists deduplicated bulk updates in one user-level upsert with last-write-wins", async () => {
		const { POST } = await import("./route");

		const response = await POST(
			new Request("https://z8.test/api/notifications/preferences", {
				body: JSON.stringify({
					preferences: [
						{
							channel: "email",
							enabled: false,
							notificationType: "approval_request_submitted",
						},
						{
							channel: "push",
							enabled: false,
							notificationType: "approval_request_approved",
						},
						{
							channel: "email",
							enabled: true,
							notificationType: "approval_request_submitted",
						},
					],
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ success: true, updated: 3 });
		expect(mockState.values).toHaveBeenCalledTimes(1);
		expect(mockState.values).toHaveBeenCalledWith([
			{
				channel: "email",
				enabled: true,
				notificationType: "approval_request_submitted",
				userId: "user-1",
			},
			{
				channel: "push",
				enabled: false,
				notificationType: "approval_request_approved",
				userId: "user-1",
			},
		]);
		expect(mockState.onConflictDoUpdate).toHaveBeenCalledWith({
			set: {
				enabled: expect.anything(),
				updatedAt: expect.anything(),
			},
			target: [
				"notificationPreference.userId",
				"notificationPreference.notificationType",
				"notificationPreference.channel",
			],
		});
		expect(mockState.findFirst).not.toHaveBeenCalled();
		expect(mockState.update).not.toHaveBeenCalled();
		expect(mockState.insert).toHaveBeenCalledTimes(1);
	});

	it("validates every bulk update before starting the upsert", async () => {
		const { POST } = await import("./route");
		const response = await POST(
			new Request("https://z8.test/api/notifications/preferences", {
				body: JSON.stringify({
					preferences: [
						{
							channel: "email",
							enabled: false,
							notificationType: "approval_request_submitted",
						},
						{
							channel: "invalid",
							enabled: true,
							notificationType: "approval_request_approved",
						},
					],
				}),
				method: "POST",
			}) as never,
		);

		expect(response.status).toBe(400);
		expect(mockState.insert).not.toHaveBeenCalled();
	});
});
