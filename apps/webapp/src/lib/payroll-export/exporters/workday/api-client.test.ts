import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkdayApiClient } from "./api-client";

describe("WorkdayApiClient", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("retrieves an OAuth2 token", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					access_token: "token_123",
					token_type: "Bearer",
					expires_in: 3600,
				}),
				{ status: 200 },
			),
		);

		const client = new WorkdayApiClient({
			instanceUrl: "https://example.workday.com",
			tenantId: "acme",
			timeoutMs: 5000,
		});

		const token = await client.getOAuthToken({
			clientId: "client_123",
			clientSecret: "secret_123",
			scope: "system",
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://example.workday.com/ccx/oauth2/acme/token",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					"Content-Type": "application/x-www-form-urlencoded",
				}),
			}),
		);
		expect(token.accessToken).toBe("token_123");
		expect(token.tokenType).toBe("Bearer");
		expect(token.expiresAt).toBeTypeOf("number");
	});

	it("tests connectivity with a lightweight ping", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ ok: true }), { status: 200 }),
		);

		const client = new WorkdayApiClient({
			instanceUrl: "https://example.workday.com",
			tenantId: "acme",
			timeoutMs: 5000,
		});

		await expect(client.testConnection("token_123")).resolves.toEqual({ success: true });
	});

	it("returns connection error details when ping fails", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 }),
		);

		const client = new WorkdayApiClient({
			instanceUrl: "https://example.workday.com",
			tenantId: "acme",
			timeoutMs: 5000,
		});

		await expect(client.testConnection("token_123")).resolves.toEqual({
			success: false,
			error: "Workday API ping failed with status 401",
		});
	});
});
