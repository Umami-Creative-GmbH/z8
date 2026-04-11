import type {
	ClockinAbsence,
	ClockinAbsenceSearchRequest,
	ClockinEmployee,
	ClockinPaginatedResponse,
	ClockinWorkday,
	ClockinWorkdaySearchRequest,
} from "./types";

const BASE_URL = "https://customerapi.clockin.de";

type ClockinSearchScope = {
	key: string;
	operator: string;
	value: string | number[];
};

type ClockinResponseLinks = {
	next: string | null;
};

export class ClockinClient {
	constructor(private readonly token: string) {}

	private isPaginatedResponse<T>(value: unknown): value is ClockinPaginatedResponse<T> {
		if (!value || typeof value !== "object") {
			return false;
		}

		const response = value as {
			data?: unknown;
			links?: ClockinResponseLinks | null;
		};

		return (
			Array.isArray(response.data) &&
			!!response.links &&
			typeof response.links === "object" &&
			("next" in response.links) &&
			(response.links.next === null || typeof response.links.next === "string")
		);
	}

	private getRequestInit(init?: RequestInit): RequestInit {
		return {
			...init,
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${this.token}`,
				"Content-Type": "application/json",
				...init?.headers,
			},
		};
	}

	private async parseResponse<T>(response: Response): Promise<T> {
		if (!response.ok) {
			const text = await response.text().catch(() => "");
			throw new Error(`Clockin API error ${response.status}: ${text}`);
		}

		const text = await response.text().catch(() => "");

		try {
			return JSON.parse(text) as T;
		} catch {
			throw new Error(`Clockin API error ${response.status}: invalid JSON response`);
		}
	}

	private async requestPage<T>(url: string, init?: RequestInit): Promise<ClockinPaginatedResponse<T>> {
		const response = await fetch(url, this.getRequestInit(init));
		const payload = await this.parseResponse<unknown>(response);

		if (!this.isPaginatedResponse<T>(payload)) {
			throw new Error(`Clockin API error ${response.status}: invalid JSON response`);
		}

		return payload;
	}

	private async fetchAllPages<T>(path: string, init?: RequestInit): Promise<T[]> {
		const requestInit = this.getRequestInit(init);
		let nextUrl: string | null = `${BASE_URL}${path}`;
		const data: T[] = [];

		while (nextUrl) {
			const response: ClockinPaginatedResponse<T> = await this.requestPage<T>(nextUrl, requestInit);
			data.push(...response.data);
			nextUrl = response.links.next;
		}

		return data;
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
		return this.fetchAllPages<ClockinEmployee>("/v3/employees");
	}

	async searchWorkdays(input: ClockinWorkdaySearchRequest): Promise<ClockinWorkday[]> {
		return this.fetchAllPages<ClockinWorkday>(
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
	}

	async searchAbsences(input: ClockinAbsenceSearchRequest): Promise<ClockinAbsence[]> {
		const scopes: ClockinSearchScope[] = [
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

		return this.fetchAllPages<ClockinAbsence>(
			"/v3/absences/search",
			{
				method: "POST",
				body: JSON.stringify({ scopes }),
			},
		);
	}
}
