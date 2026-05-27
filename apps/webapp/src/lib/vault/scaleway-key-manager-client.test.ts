import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ScalewayKeyManagerClient } from "./scaleway-key-manager-client";

const originalFetch = globalThis.fetch;

const createClient = () =>
	new ScalewayKeyManagerClient({
		apiUrl: "https://key-manager.test",
		secretKey: "test-secret-key",
		projectId: "project-123",
		region: "fr-par",
	});

const getJsonBody = async (request: RequestInit | undefined) => {
	expect(request?.body).toEqual(expect.any(String));
	return JSON.parse(request?.body as string) as Record<string, unknown>;
};

describe("ScalewayKeyManagerClient", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	test("lists organization keys with project, deletion, tag filters, and auth header", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({ keys: [{ id: "key-1" }] }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const keys = await createClient().listOrganizationKeys("org-1");

		expect(keys).toEqual([{ id: "key-1" }]);
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		const parsedUrl = new URL(url);
		expect(parsedUrl.origin).toBe("https://key-manager.test");
		expect(parsedUrl.pathname).toBe("/key-manager/v1alpha1/regions/fr-par/keys");
		expect(parsedUrl.searchParams.get("project_id")).toBe("project-123");
		expect(parsedUrl.searchParams.get("scheduled_for_deletion")).toBe("false");
		expect(parsedUrl.searchParams.get("tags")).toBe("z8-org:org-1");
		expect(request.headers).toMatchObject({
			"X-Auth-Token": "test-secret-key",
		});
	});

	test("creates a protected AES-256-GCM organization key with expected name and tags", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({ id: "key-1" }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const key = await createClient().createOrganizationKey("org-1");

		expect(key).toEqual({ id: "key-1" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://key-manager.test/key-manager/v1alpha1/regions/fr-par/keys");
		expect(request.method).toBe("POST");
		expect(request.headers).toMatchObject({
			"Content-Type": "application/json",
			"X-Auth-Token": "test-secret-key",
		});
		expect(await getJsonBody(request)).toEqual({
			project_id: "project-123",
			name: "z8-org-org-1-customer-secrets",
			usage: { symmetric_encryption: "aes_256_gcm" },
			tags: ["z8-customer-secrets", "z8-org:org-1"],
			unprotected: false,
		});
	});

	test("creates a protected AES-256-GCM platform key with expected name and tag", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({ id: "key-platform" }), {
				status: 201,
				headers: { "Content-Type": "application/json" },
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const key = await createClient().createPlatformKey("z8-platform-abc123def4");

		expect(key).toEqual({ id: "key-platform" });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://key-manager.test/key-manager/v1alpha1/regions/fr-par/keys");
		expect(request.method).toBe("POST");
		expect(await getJsonBody(request)).toEqual({
			project_id: "project-123",
			name: "z8-platform-abc123def4",
			usage: { symmetric_encryption: "aes_256_gcm" },
			tags: ["z8-platform-secrets"],
			unprotected: false,
		});
	});

	test("gets a key from the direct key response object", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({ id: "key-1", name: "z8-org-org-1-customer-secrets" }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		const key = await createClient().getKey("key-1");

		expect(key).toEqual({ id: "key-1", name: "z8-org-org-1-customer-secrets" });
		expect(fetchMock).toHaveBeenCalledWith(
			"https://key-manager.test/key-manager/v1alpha1/regions/fr-par/keys/key-1",
			expect.objectContaining({ method: "GET" }),
		);
	});

	test("encrypts and decrypts with base64 plaintext without associated data", async () => {
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ ciphertext: "scw-km-v1:opaque-ciphertext" }), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				}),
			)
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						plaintext: Buffer.from("secret value", "utf8").toString("base64"),
					}),
					{
						status: 200,
						headers: { "Content-Type": "application/json" },
					},
				),
			);
		globalThis.fetch = fetchMock as typeof fetch;

		const client = createClient();
		const ciphertext = await client.encrypt("key-1", "secret value", "org-1:email/api_key");
		const plaintext = await client.decrypt("key-1", ciphertext, "org-1:email/api_key");

		expect(ciphertext).toBe("scw-km-v1:opaque-ciphertext");
		expect(plaintext).toBe("secret value");
		expect(fetchMock).toHaveBeenCalledTimes(2);
		const [encryptUrl, encryptRequest] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(encryptUrl).toBe(
			"https://key-manager.test/key-manager/v1alpha1/regions/fr-par/keys/key-1/encrypt",
		);
		expect(await getJsonBody(encryptRequest)).toEqual({
			plaintext: Buffer.from("secret value", "utf8").toString("base64"),
		});

		const [decryptUrl, decryptRequest] = fetchMock.mock.calls[1] as [string, RequestInit];
		expect(decryptUrl).toBe(
			"https://key-manager.test/key-manager/v1alpha1/regions/fr-par/keys/key-1/decrypt",
		);
		expect(await getJsonBody(decryptRequest)).toEqual({
			ciphertext: "scw-km-v1:opaque-ciphertext",
		});
	});

	test("throws a sanitized error for non-2xx responses", async () => {
		const fetchMock = vi.fn(async () =>
			new Response(JSON.stringify({ message: "token test-secret-key denied" }), {
				status: 403,
				headers: { "Content-Type": "application/json" },
			}),
		);
		globalThis.fetch = fetchMock as typeof fetch;

		await expect(createClient().getKey("key-1")).rejects.toThrow(
			"Scaleway Key Manager request failed with status 403",
		);
		await expect(createClient().getKey("key-1")).rejects.not.toThrow("test-secret-key");
	});
});
