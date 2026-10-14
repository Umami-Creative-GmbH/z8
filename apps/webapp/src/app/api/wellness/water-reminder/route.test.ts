import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	headers: vi.fn(async () => new Headers()),
	getSession: vi.fn(),
	sendPushToUser: vi.fn(),
	recipientNotificationTranslator: vi.fn(),
}));

vi.mock("next/headers", () => ({ headers: mockState.headers }));
vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return { ...actual, connection: mockState.connection };
});
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mockState.getSession } } }));
vi.mock("@/lib/notifications/push-service", () => ({
	sendPushToUser: mockState.sendPushToUser,
}));
vi.mock("@/lib/notifications/outbound-localization", () => ({
	recipientNotificationTranslator: mockState.recipientNotificationTranslator,
}));

import { POST } from "./route";

/** A German catalog stand-in: each key renders as `de:<key>`. */
const germanTranslate = (key: string) => `de:${key}`;

beforeEach(() => {
	vi.clearAllMocks();
	mockState.getSession.mockResolvedValue({
		user: { id: "user-1" },
		session: { id: "s-1", activeOrganizationId: "org-1" },
	});
	mockState.sendPushToUser.mockResolvedValue({ sent: 1, failed: 0 });
	mockState.recipientNotificationTranslator.mockResolvedValue(germanTranslate);
});

describe("POST /api/wellness/water-reminder", () => {
	it("sends the reminder in the user's notification language", async () => {
		const response = await POST();

		expect(response.status).toBe(200);
		expect(mockState.recipientNotificationTranslator).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-1",
		});
		expect(mockState.sendPushToUser).toHaveBeenCalledWith(
			"user-1",
			expect.objectContaining({
				title: "de:common:notifications.content.waterReminder.title",
				body: "de:common:notifications.content.waterReminder.message",
				data: expect.objectContaining({
					type: "water_reminder",
					actions: [
						{ action: "log_water", title: "de:common:notifications.content.waterReminder.done" },
						{
							action: "snooze_water",
							title: "de:common:notifications.content.waterReminder.snooze",
						},
					],
				}),
			}),
		);
	});

	it("falls back to the English defaults", async () => {
		mockState.recipientNotificationTranslator.mockResolvedValue(
			(_key: string, defaultValue: string) => defaultValue,
		);

		await POST();

		expect(mockState.sendPushToUser).toHaveBeenCalledWith(
			"user-1",
			expect.objectContaining({
				title: "Time to hydrate!",
				body: "Stay healthy - drink some water",
			}),
		);
	});

	it("rejects a request without a session", async () => {
		mockState.getSession.mockResolvedValue(null);

		const response = await POST();

		expect(response.status).toBe(401);
		expect(mockState.sendPushToUser).not.toHaveBeenCalled();
	});
});
