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

	it("looks up a worker by email", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{
							id: "worker-1",
							employeeNumber: "E-001",
							email: "ada@example.com",
						},
					],
				}),
				{ status: 200 },
			),
		);

		const client = new WorkdayApiClient({
			instanceUrl: "https://example.workday.com",
			tenantId: "acme",
			timeoutMs: 5000,
		});

		const worker = await client.findWorkerByEmail("token_123", "ada@example.com");

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://example.workday.com/ccx/api/v1/acme/workers?email=ada%40example.com&limit=1",
			expect.objectContaining({
				method: "GET",
				headers: expect.objectContaining({
					Authorization: "Bearer token_123",
				}),
			}),
		);
		expect(worker).toEqual({
			id: "worker-1",
			employeeNumber: "E-001",
			email: "ada@example.com",
		});
	});

	it("posts attendance payloads", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ id: "attendance-1" }), { status: 201 }),
		);

		const client = new WorkdayApiClient({
			instanceUrl: "https://example.workday.com",
			tenantId: "acme",
			timeoutMs: 5000,
		});

		await expect(
			client.createAttendance("token_123", {
				workerId: "worker-1",
				sourceId: "wp-1",
				startDate: "2026-01-10",
				endDate: "2026-01-10",
				hours: 4,
				projectName: "Apollo",
				categoryName: "Regular",
			}),
		).resolves.toBeUndefined();

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://example.workday.com/ccx/api/v1/acme/payroll-inputs/attendance",
			expect.objectContaining({
				method: "POST",
				headers: expect.objectContaining({
					Authorization: "Bearer token_123",
					"Content-Type": "application/json",
				}),
				body: JSON.stringify({
					workerId: "worker-1",
					sourceId: "wp-1",
					startDate: "2026-01-10",
					endDate: "2026-01-10",
					hours: 4,
					projectName: "Apollo",
					categoryName: "Regular",
				}),
			}),
		);
	});
});
