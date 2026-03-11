import type {
	ClockinAbsence,
	ClockinAbsenceSearchRequest,
	ClockinEmployee,
	ClockinPaginatedResponse,
	ClockinWorkday,
	ClockinWorkdaySearchRequest,
} from "./types";

const BASE_URL = "https://customerapi.clockin.de";

export class ClockinClient {
	constructor(private readonly token: string) {}

	private async request<T>(path: string, init?: RequestInit): Promise<T> {
		const response = await fetch(`${BASE_URL}${path}`, {
			...init,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
		});

		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`Clockin API error ${response.status}: ${text}`);
		}

		return response.json() as Promise<T>;
	}

	async testConnection(): Promise<{ success: true } | { success: false; error: string }> {
		try {
			await this.getEmployees();
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Failed to connect to Clockin",
			};
		}
	}

	async getEmployees(): Promise<ClockinEmployee[]> {
		const response = await this.request<ClockinPaginatedResponse<ClockinEmployee>>("/v3/employees");
		return response.data;
	}

	async searchWorkdays(input: ClockinWorkdaySearchRequest): Promise<ClockinWorkday[]> {
		const response = await this.request<ClockinPaginatedResponse<ClockinWorkday>>(
			"/v3/workdays/search",
			{
				method: "POST",
				body: JSON.stringify({
					employee_ids: input.employeeIds,
					start_date: input.startDate,
					end_date: input.endDate,
				}),
			},
		);

		return response.data;
	}

	async searchAbsences(input: ClockinAbsenceSearchRequest): Promise<ClockinAbsence[]> {
		const scopes = [
			{ key: "starts_at", operator: ">=", value: input.startDate },
			{ key: "ends_at", operator: "<=", value: input.endDate },
		];

		if (input.employeeIds?.length) {
			scopes.push({
				key: "employee_id",
				operator: "in",
				value: input.employeeIds,
			});
		}

		const response = await this.request<ClockinPaginatedResponse<ClockinAbsence>>(
			"/v3/absences/search",
			{
				method: "POST",
				body: JSON.stringify({ scopes }),
			},
		);

		return response.data;
	}
}
