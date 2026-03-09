import type {
	WorkdayAbsencePayload,
	WorkdayAttendancePayload,
	WorkdayAuthToken,
	WorkdayOAuthCredentials,
	WorkdayWorker,
} from "./types";

interface WorkdayApiClientOptions {
	instanceUrl: string;
	tenantId: string;
	timeoutMs?: number;
}

interface WorkdayTokenResponse {
	access_token: string;
	token_type?: string;
	expires_in?: number;
}

interface WorkdayWorkersResponse {
	data?: WorkdayWorker[];
	workers?: WorkdayWorker[];
}

class WorkdayApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = "WorkdayApiError";
		this.status = status;
	}
}

export class WorkdayApiClient {
	private readonly instanceUrl: string;
	private readonly tenantId: string;
	private readonly timeoutMs: number;

	constructor(options: WorkdayApiClientOptions) {
		this.instanceUrl = options.instanceUrl.replace(/\/$/, "");
		this.tenantId = options.tenantId;
		this.timeoutMs = options.timeoutMs ?? 30000;
	}

	async getOAuthToken(credentials: WorkdayOAuthCredentials): Promise<WorkdayAuthToken> {
		const body = new URLSearchParams({
			grant_type: "client_credentials",
			client_id: credentials.clientId,
			client_secret: credentials.clientSecret,
		});

		if (credentials.scope) {
			body.set("scope", credentials.scope);
		}

		const response = await fetch(this.getTokenUrl(), {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
				Accept: "application/json",
			},
			body,
			signal: AbortSignal.timeout(this.timeoutMs),
		});

		if (!response.ok) {
			throw new Error(`Workday OAuth token request failed with status ${response.status}`);
		}

		const payload = (await response.json()) as WorkdayTokenResponse;
		if (!payload.access_token) {
			throw new Error("Workday OAuth token response did not include access_token");
		}

		const expiresInMs = (payload.expires_in ?? 3600) * 1000;
		return {
			accessToken: payload.access_token,
			tokenType: payload.token_type ?? "Bearer",
			expiresAt: Date.now() + expiresInMs,
		};
	}

	async testConnection(accessToken?: string): Promise<{ success: boolean; error?: string }> {
		try {
			const response = await fetch(this.getPingUrl(), {
				method: "GET",
				headers: {
					Accept: "application/json",
					...(accessToken
						? {
							Authorization: `Bearer ${accessToken}`,
						}
						: {}),
				},
				signal: AbortSignal.timeout(this.timeoutMs),
			});

			if (!response.ok) {
				return {
					success: false,
					error: `Workday API ping failed with status ${response.status}`,
				};
			}

			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : "Unknown error",
			};
		}
	}

	async findWorkerByEmployeeNumber(
		accessToken: string,
		employeeNumber: string,
	): Promise<WorkdayWorker | null> {
		return this.findWorker(accessToken, "employeeNumber", employeeNumber);
	}

	async findWorkerByEmail(accessToken: string, email: string): Promise<WorkdayWorker | null> {
		return this.findWorker(accessToken, "email", email);
	}

	async createAttendance(
		accessToken: string,
		payload: WorkdayAttendancePayload,
	): Promise<void> {
		await this.postJson(this.getAttendanceUrl(), accessToken, payload, "attendance export");
	}

	async createAbsence(accessToken: string, payload: WorkdayAbsencePayload): Promise<void> {
		await this.postJson(this.getAbsenceUrl(), accessToken, payload, "absence export");
	}

	private getTokenUrl(): string {
		return `${this.instanceUrl}/ccx/oauth2/${this.tenantId}/token`;
	}

	private getPingUrl(): string {
		return `${this.instanceUrl}/ccx/api/v1/${this.tenantId}/workers?limit=1`;
	}

	private getWorkersUrl(queryKey: "employeeNumber" | "email", queryValue: string): string {
		const params = new URLSearchParams({
			[queryKey]: queryValue,
			limit: "1",
		});
		return `${this.instanceUrl}/ccx/api/v1/${this.tenantId}/workers?${params.toString()}`;
	}

	private getAttendanceUrl(): string {
		return `${this.instanceUrl}/ccx/api/v1/${this.tenantId}/payroll-inputs/attendance`;
	}

	private getAbsenceUrl(): string {
		return `${this.instanceUrl}/ccx/api/v1/${this.tenantId}/payroll-inputs/absences`;
	}

	private async findWorker(
		accessToken: string,
		queryKey: "employeeNumber" | "email",
		queryValue: string,
	): Promise<WorkdayWorker | null> {
		const response = await fetch(this.getWorkersUrl(queryKey, queryValue), {
			method: "GET",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${accessToken}`,
			},
			signal: AbortSignal.timeout(this.timeoutMs),
		});

		if (response.status === 404) {
			return null;
		}

		if (!response.ok) {
			throw new WorkdayApiError(
				`Workday worker lookup failed with status ${response.status}`,
				response.status,
			);
		}

		const payload = (await response.json()) as WorkdayWorkersResponse;
		const workers = payload.data ?? payload.workers ?? [];
		return workers[0] ?? null;
	}

	private async postJson(
		url: string,
		accessToken: string,
		payload: object,
		action: string,
	): Promise<void> {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				Accept: "application/json",
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(this.timeoutMs),
		});

		if (!response.ok) {
			throw new WorkdayApiError(
				`Workday ${action} failed with status ${response.status}`,
				response.status,
			);
		}
	}
}
