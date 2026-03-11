import { afterEach, describe, expect, it, vi } from "vitest";
import { ClockinClient } from "./client";

describe("ClockinClient", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("sends bearer-authenticated employee requests", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [
						{
							id: 1,
							first_name: "Ada",
							last_name: "Lovelace",
							email: "ada@example.com",
							personnel_number: "E-001",
							department_name: null,
							entry_date: null,
							contract_ending: null,
							trial_period_end_date: null,
							created_at: "2026-03-01T00:00:00Z",
							updated_at: "2026-03-01T00:00:00Z",
						},
					],
					links: { first: null, last: null, prev: null, next: null },
					meta: {
						current_page: 1,
						from: 1,
						last_page: 1,
						path: "https://customerapi.clockin.de/v3/employees",
						per_page: 15,
						to: 1,
						total: 1,
					},
				}),
				{ status: 200 },
			),
		);

		const client = new ClockinClient("token-value");
		const employees = await client.getEmployees();

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://customerapi.clockin.de/v3/employees",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer token-value",
					Accept: "application/json",
				}),
			}),
		);
		expect(employees).toHaveLength(1);
		expect(employees[0]?.email).toBe("ada@example.com");
	});

	it("posts required workday search filters", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(
				JSON.stringify({
					data: [],
					links: { first: null, last: null, prev: null, next: null },
					meta: {
						current_page: 1,
						from: null,
						last_page: 1,
						path: "https://customerapi.clockin.de/v3/workdays/search",
						per_page: 15,
						to: null,
						total: 0,
					},
				}),
				{ status: 200 },
			),
		);

		const client = new ClockinClient("token-value");
		await client.searchWorkdays({
			employeeIds: [1, 2],
			startDate: "2026-03-01",
			endDate: "2026-03-31",
		});

		expect(fetchSpy).toHaveBeenCalledWith(
			"https://customerapi.clockin.de/v3/workdays/search",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					employee_ids: [1, 2],
					start_date: "2026-03-01",
					end_date: "2026-03-31",
				}),
			}),
		);
	});

	it("returns structured connection failures", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(
			new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 }),
		);

		const client = new ClockinClient("bad-token");

		await expect(client.testConnection()).resolves.toEqual({
			success: false,
			error: 'Clockin API error 401: {"message":"unauthorized"}',
		});
	});
});
