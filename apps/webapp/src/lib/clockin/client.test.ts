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

	it("aggregates employees across paginated responses", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
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
						links: {
							first: null,
							last: null,
							prev: null,
							next: "https://customerapi.clockin.de/v3/employees?page=2",
						},
						meta: {
							current_page: 1,
							from: 1,
							last_page: 2,
							path: "https://customerapi.clockin.de/v3/employees",
							per_page: 15,
							to: 1,
							total: 2,
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: [
							{
								id: 2,
								first_name: "Grace",
								last_name: "Hopper",
								email: "grace@example.com",
								personnel_number: "E-002",
								department_name: null,
								entry_date: null,
								contract_ending: null,
								trial_period_end_date: null,
								created_at: "2026-03-02T00:00:00Z",
								updated_at: "2026-03-02T00:00:00Z",
							},
						],
						links: { first: null, last: null, prev: null, next: null },
						meta: {
							current_page: 2,
							from: 2,
							last_page: 2,
							path: "https://customerapi.clockin.de/v3/employees",
							per_page: 15,
							to: 2,
							total: 2,
						},
					}),
					{ status: 200 },
				),
			);

		const client = new ClockinClient("token-value");
		const employees = await client.getEmployees();

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			"https://customerapi.clockin.de/v3/employees",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer token-value",
					Accept: "application/json",
					"Content-Type": "application/json",
				}),
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"https://customerapi.clockin.de/v3/employees?page=2",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer token-value",
					Accept: "application/json",
					"Content-Type": "application/json",
				}),
			}),
		);
		expect(employees.map((employee) => employee.email)).toEqual([
			"ada@example.com",
			"grace@example.com",
		]);
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

	it("paginates absence searches using the original POST body", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: [
							{
								id: 1,
								employee_id: 1,
								type: "vacation",
								status: "approved",
								starts_at: "2026-03-10",
								ends_at: "2026-03-11",
								created_at: "2026-03-01T00:00:00Z",
								updated_at: "2026-03-01T00:00:00Z",
							},
						],
						links: {
							first: null,
							last: null,
							prev: null,
							next: "https://customerapi.clockin.de/v3/absences/search?page=2",
						},
						meta: {
							current_page: 1,
							from: 1,
							last_page: 2,
							path: "https://customerapi.clockin.de/v3/absences/search",
							per_page: 15,
							to: 1,
							total: 2,
						},
					}),
					{ status: 200 },
				),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						data: [
							{
								id: 2,
								employee_id: 2,
								type: "vacation",
								status: "approved",
								starts_at: "2026-03-12",
								ends_at: "2026-03-13",
								created_at: "2026-03-02T00:00:00Z",
								updated_at: "2026-03-02T00:00:00Z",
							},
						],
						links: { first: null, last: null, prev: null, next: null },
						meta: {
							current_page: 2,
							from: 2,
							last_page: 2,
							path: "https://customerapi.clockin.de/v3/absences/search",
							per_page: 15,
							to: 2,
							total: 2,
						},
					}),
					{ status: 200 },
				),
			);

		const client = new ClockinClient("token-value");
		const absences = await client.searchAbsences({
			employeeIds: [1, 2],
			startDate: "2026-03-01",
			endDate: "2026-03-31",
		});

		const expectedBody = JSON.stringify({
			scopes: [
				{ key: "starts_at", operator: ">=", value: "2026-03-01" },
				{ key: "ends_at", operator: "<=", value: "2026-03-31" },
				{ key: "employee_id", operator: "in", value: [1, 2] },
			],
		});

		expect(fetchSpy).toHaveBeenCalledTimes(2);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			1,
			"https://customerapi.clockin.de/v3/absences/search",
			expect.objectContaining({
				method: "POST",
				body: expectedBody,
			}),
		);
		expect(fetchSpy).toHaveBeenNthCalledWith(
			2,
			"https://customerapi.clockin.de/v3/absences/search?page=2",
			expect.objectContaining({
				method: "POST",
				body: expectedBody,
			}),
		);
		expect(absences.map((absence) => absence.id)).toEqual([1, 2]);
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

	it("returns a structured error for invalid JSON responses", async () => {
		vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("not-json", { status: 200 }));

		const client = new ClockinClient("token-value");

		await expect(client.testConnection()).resolves.toEqual({
			success: false,
			error: "Clockin API error 200: invalid JSON response",
		});
	});
});
