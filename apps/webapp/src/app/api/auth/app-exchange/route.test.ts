import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	consumeAppAuthCode: vi.fn(),
}));

vi.mock("@/lib/auth/app-auth-code", () => ({
	consumeAppAuthCode: mockState.consumeAppAuthCode,
}));

const { POST } = await import("./route");

describe("POST /api/auth/app-exchange", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("returns a 400 when the request body is malformed JSON", async () => {
		const response = await POST(
			new Request("https://app.example.com/api/auth/app-exchange", {
				body: "{",
				headers: {
					"Content-Type": "application/json",
					"X-Z8-App-Type": "mobile",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(400);
		expect(mockState.consumeAppAuthCode).not.toHaveBeenCalled();
		expect(await response.json()).toEqual({ error: "Code is required" });
	});

	it("returns the session token when a valid mobile code is exchanged", async () => {
		mockState.consumeAppAuthCode.mockResolvedValue({
			status: "success",
			sessionToken: "session-token",
		});

		const response = await POST(
			new Request("https://app.example.com/api/auth/app-exchange", {
				body: JSON.stringify({ code: "ONE-TIME-CODE" }),
				headers: {
					"Content-Type": "application/json",
					"X-Z8-App-Type": "mobile",
				},
				method: "POST",
			}),
		);

		expect(response.status).toBe(200);
		expect(mockState.consumeAppAuthCode).toHaveBeenCalledWith({
			app: "mobile",
			code: "ONE-TIME-CODE",
		});
		expect(await response.json()).toEqual({ token: "session-token" });
	});
});
