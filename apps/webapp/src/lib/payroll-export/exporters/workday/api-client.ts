import type {
	WorkdayAuthToken,
	WorkdayOAuthCredentials,
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

	private getTokenUrl(): string {
		return `${this.instanceUrl}/ccx/oauth2/${this.tenantId}/token`;
	}

	private getPingUrl(): string {
		return `${this.instanceUrl}/ccx/api/v1/${this.tenantId}/workers?limit=1`;
	}
}
