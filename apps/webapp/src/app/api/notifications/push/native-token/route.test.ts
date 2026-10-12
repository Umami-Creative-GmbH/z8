import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	headers: vi.fn(async () => new Headers()),
	getSession: vi.fn(),
	isNativePushAvailable: vi.fn(() => true),
	registerNativePushToken: vi.fn(async () => undefined),
	removeNativePushToken: vi.fn(async () => undefined),
}));

vi.mock("next/headers", () => ({ headers: mockState.headers }));
vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return { ...actual, connection: mockState.connection };
});
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mockState.getSession } } }));
vi.mock("@/lib/notifications/native-push-service", () => ({
	isNativePushAvailable: mockState.isNativePushAvailable,
	registerNativePushToken: mockState.registerNativePushToken,
	removeNativePushToken: mockState.removeNativePushToken,
}));

import { DELETE, GET, POST } from "./route";

function request(method: "POST" | "DELETE", body: unknown) {
	return new NextRequest("https://app.example/api/notifications/push/native-token", {
		method,
		body: JSON.stringify(body),
		headers: { "content-type": "application/json" },
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mockState.isNativePushAvailable.mockReturnValue(true);
	mockState.getSession.mockResolvedValue({ user: { id: "user-1" }, session: { id: "s-1" } });
});

describe("GET /api/notifications/push/native-token", () => {
	it("tells the app whether native push is configured", async () => {
		expect(await (await GET()).json()).toEqual({ available: true });

		mockState.isNativePushAvailable.mockReturnValue(false);
		expect(await (await GET()).json()).toEqual({ available: false });
	});
});

describe("POST /api/notifications/push/native-token", () => {
	it("saves the device token for the signed-in user, bound to the current session", async () => {
		const response = await POST(request("POST", { token: "fcm-token", platform: "ios" }));

		expect(response.status).toBe(200);
		expect(mockState.registerNativePushToken).toHaveBeenCalledWith(
			{ userId: "user-1", sessionId: "s-1" },
			{ token: "fcm-token", platform: "ios" },
		);
	});

	it("refuses without a session", async () => {
		mockState.getSession.mockResolvedValue(null);

		const response = await POST(request("POST", { token: "fcm-token", platform: "ios" }));

		expect(response.status).toBe(401);
		expect(mockState.registerNativePushToken).not.toHaveBeenCalled();
	});

	it.each([
		["a missing token", { platform: "ios" }],
		["an empty token", { token: "", platform: "android" }],
		["an oversized token", { token: "x".repeat(4097), platform: "android" }],
		["an unknown platform", { token: "fcm-token", platform: "web" }],
	])("refuses %s", async (_case, body) => {
		const response = await POST(request("POST", body));

		expect(response.status).toBe(400);
		expect(mockState.registerNativePushToken).not.toHaveBeenCalled();
	});

	it("refuses while native push is not configured", async () => {
		mockState.isNativePushAvailable.mockReturnValue(false);

		const response = await POST(request("POST", { token: "fcm-token", platform: "ios" }));

		expect(response.status).toBe(503);
		expect(mockState.registerNativePushToken).not.toHaveBeenCalled();
	});
});

describe("DELETE /api/notifications/push/native-token", () => {
	it("removes the device token of the signed-in user", async () => {
		const response = await DELETE(request("DELETE", { token: "fcm-token" }));

		expect(response.status).toBe(200);
		expect(mockState.removeNativePushToken).toHaveBeenCalledWith("user-1", "fcm-token");
	});

	it("removes the token even when native push has since been turned off", async () => {
		mockState.isNativePushAvailable.mockReturnValue(false);

		const response = await DELETE(request("DELETE", { token: "fcm-token" }));

		expect(response.status).toBe(200);
		expect(mockState.removeNativePushToken).toHaveBeenCalledWith("user-1", "fcm-token");
	});

	it("refuses without a session", async () => {
		mockState.getSession.mockResolvedValue(null);

		const response = await DELETE(request("DELETE", { token: "fcm-token" }));

		expect(response.status).toBe(401);
		expect(mockState.removeNativePushToken).not.toHaveBeenCalled();
	});
});
