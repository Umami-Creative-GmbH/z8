export type ScalewayKeyManagerClientOptions = {
	apiUrl?: string;
	secretKey: string;
	projectId: string;
	region: string;
};

type JsonRecord = Record<string, unknown>;

export class ScalewayKeyManagerClient {
	private readonly apiUrl: string;
	private readonly secretKey: string;
	private readonly projectId: string;
	private readonly region: string;

	constructor(options: ScalewayKeyManagerClientOptions) {
		this.apiUrl = (options.apiUrl ?? "https://api.scaleway.com").replace(/\/+$/, "");
		this.secretKey = options.secretKey;
		this.projectId = options.projectId;
		this.region = options.region;
	}

	async listOrganizationKeys(organizationId: string) {
		const searchParams = new URLSearchParams({
			project_id: this.projectId,
			scheduled_for_deletion: "false",
		});
		searchParams.set("tags", this.organizationTag(organizationId));

		const response = await this.request<{ keys: unknown[] }>(`/keys?${searchParams}`);
		return response.keys;
	}

	async getKey(keyId: string) {
		return this.request(`/keys/${encodeURIComponent(keyId)}`);
	}

	async createOrganizationKey(organizationId: string) {
		return this.request("/keys", {
			method: "POST",
			body: {
				project_id: this.projectId,
				name: `z8-org-${organizationId}-customer-secrets`,
				usage: { symmetric_encryption: "aes_256_gcm" },
				tags: ["z8-customer-secrets", this.organizationTag(organizationId)],
				unprotected: false,
			},
		});
	}

	async createPlatformKey(name: string) {
		return this.request("/keys", {
			method: "POST",
			body: {
				project_id: this.projectId,
				name,
				usage: { symmetric_encryption: "aes_256_gcm" },
				tags: ["z8-platform-secrets"],
				unprotected: false,
			},
		});
	}

	async encrypt(keyId: string, plaintext: string, associatedData: string) {
		const response = await this.request<{ ciphertext: string }>(
			`/keys/${encodeURIComponent(keyId)}/encrypt`,
			{
				method: "POST",
				body: {
					plaintext: Buffer.from(plaintext, "utf8").toString("base64"),
					associated_data: { value: associatedData },
				},
			},
		);
		return response.ciphertext;
	}

	async decrypt(keyId: string, ciphertext: string, associatedData: string) {
		const response = await this.request<{ plaintext: string }>(
			`/keys/${encodeURIComponent(keyId)}/decrypt`,
			{
				method: "POST",
				body: {
					ciphertext,
					associated_data: { value: associatedData },
				},
			},
		);
		return Buffer.from(response.plaintext, "base64").toString("utf8");
	}

	private async request<T extends JsonRecord>(
		path: string,
		options: { method?: "GET" | "POST"; body?: JsonRecord } = {},
	) {
		const response = await fetch(`${this.basePath()}${path}`, {
			method: options.method ?? "GET",
			headers: {
				"Content-Type": "application/json",
				"X-Auth-Token": this.secretKey,
			},
			body: options.body ? JSON.stringify(options.body) : undefined,
		});

		if (!response.ok) {
			throw new Error(`Scaleway Key Manager request failed with status ${response.status}`);
		}

		return (await response.json()) as T;
	}

	private basePath() {
		return `${this.apiUrl}/key-manager/v1alpha1/regions/${encodeURIComponent(this.region)}`;
	}

	private organizationTag(organizationId: string) {
		return `z8-org:${organizationId}`;
	}
}
