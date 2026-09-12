import { generateKeyPairSync } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findFirst: vi.fn(),
	getOrgSecret: vi.fn(),
	update: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: (...conditions: unknown[]) => ({ conditions }),
	eq: (column: string, value: unknown) => ({ column, value }),
}));
vi.mock("@/db", () => ({
	db: {
		query: { organizationSocialOAuth: { findFirst: mocks.findFirst } },
		update: mocks.update,
	},
}));
vi.mock("@/db/schema", () => ({
	organizationSocialOAuth: {
		id: "config.id",
		organizationId: "config.organizationId",
	},
}));
vi.mock("@/lib/vault/secrets", () => ({ getOrgSecret: mocks.getOrgSecret }));

const { checkSocialOAuthConfiguration } = await import("./configuration-check");

const config = {
	id: "cfg-1",
	organizationId: "org-1",
	provider: "google",
	clientId: "client-id",
	isActive: true,
	providerConfig: null,
	lastTestSuccess: true,
};

function check(configId = "cfg-1") {
	return checkSocialOAuthConfiguration(configId, "org-1");
}

function privateKey(namedCurve = "prime256v1") {
	return generateKeyPairSync("ec", { namedCurve }).privateKey.export({
		type: "pkcs8",
		format: "pem",
	});
}

describe("social OAuth configuration readiness", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.findFirst.mockResolvedValue(config);
		mocks.getOrgSecret.mockResolvedValue("test-only-client-secret");
	});

	it.each(["google", "github", "linkedin"])(
		"reports %s readiness without verifying authentication",
		async (provider) => {
			mocks.findFirst.mockResolvedValue({ ...config, provider });

			const result = await check();

			expect(result).toEqual({
				checkType: "configuration",
				authenticationVerified: false,
				success: true,
				status: "ready",
			});
			expect(mocks.findFirst).toHaveBeenCalledWith(
				expect.objectContaining({
					where: {
						conditions: [
							{ column: "config.id", value: "cfg-1" },
							{ column: "config.organizationId", value: "org-1" },
						],
					},
				}),
			);
			expect(mocks.getOrgSecret).toHaveBeenCalledWith(
				"org-1",
				`social/${provider}/client_secret`,
			);
			expect(mocks.update).not.toHaveBeenCalled();
			expect(JSON.stringify(result)).not.toContain("test-only-client-secret");
		},
	);

	it("does not read credentials for a missing or cross-org configuration", async () => {
		mocks.findFirst.mockResolvedValue(null);

		expect(await check("other-org-config")).toMatchObject({
			success: false,
			status: "not_found",
			authenticationVerified: false,
		});
		expect(mocks.getOrgSecret).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it("reports inactive configurations without reading secrets", async () => {
		mocks.findFirst.mockResolvedValue({ ...config, isActive: false });

		expect(await check()).toMatchObject({ success: false, status: "inactive" });
		expect(mocks.getOrgSecret).not.toHaveBeenCalled();
	});

	it.each(["", "   ", null, { id: "cfg-1" }])(
		"rejects invalid identifiers before querying (%j)",
		async (id) => {
			expect(await check(id as string)).toMatchObject({
				success: false,
				status: "not_found",
				authenticationVerified: false,
			});
			expect(mocks.findFirst).not.toHaveBeenCalled();
			expect(mocks.getOrgSecret).not.toHaveBeenCalled();
		},
	);

	it("rejects unknown providers without constructing a credential path", async () => {
		mocks.findFirst.mockResolvedValue({ ...config, provider: "other/path" });
		expect(await check()).toMatchObject({
			success: false,
			status: "incomplete",
			authenticationVerified: false,
		});
		expect(mocks.getOrgSecret).not.toHaveBeenCalled();
	});

	it.each(["", "   "])("rejects a blank client ID (%j)", async (clientId) => {
		mocks.findFirst.mockResolvedValue({ ...config, clientId });

		expect(await check()).toMatchObject({
			success: false,
			status: "incomplete",
		});
		expect(mocks.getOrgSecret).not.toHaveBeenCalled();
	});

	it.each([null, "", "   "])(
		"never falls back to shared credentials for a missing org secret (%j)",
		async (secret) => {
			mocks.getOrgSecret.mockResolvedValue(secret);

			expect(await check()).toMatchObject({
				success: false,
				status: "incomplete",
			});
			expect(mocks.getOrgSecret).toHaveBeenCalledTimes(1);
		},
	);

	it.each(["database", "vault"])("sanitizes %s failures", async (boundary) => {
		const failingMock =
			boundary === "database" ? mocks.findFirst : mocks.getOrgSecret;
		failingMock.mockRejectedValue(
			new Error("private-token-at-internal-vault-host"),
		);

		const result = await check();

		expect(result).toMatchObject({
			success: false,
			status: "unavailable",
			authenticationVerified: false,
		});
		expect(JSON.stringify(result)).not.toContain("private-token");
		expect(mocks.update).not.toHaveBeenCalled();
	});

	describe("Apple", () => {
		beforeEach(() => {
			mocks.findFirst.mockResolvedValue({
				...config,
				provider: "apple",
				providerConfig: { apple: { teamId: "team-1", keyId: "key-1" } },
			});
			mocks.getOrgSecret.mockResolvedValue(privateKey());
		});

		it("checks organization credential paths and a usable ES256 key", async () => {
			expect(await check()).toMatchObject({
				success: true,
				status: "ready",
				authenticationVerified: false,
			});
			expect(mocks.getOrgSecret.mock.calls).toEqual([
				["org-1", "social/apple/client_secret"],
				["org-1", "social/apple/private_key"],
			]);
		});

		it("accepts legacy JSON-string provider configuration", async () => {
			mocks.findFirst.mockResolvedValue({
				...config,
				provider: "apple",
				providerConfig: JSON.stringify({
					apple: { teamId: "team-1", keyId: "key-1" },
				}),
			});
			expect(await check()).toMatchObject({ success: true, status: "ready" });
		});

		it.each([
			null,
			"not-json",
			"null",
			[],
			{ apple: {} },
			{ apple: { teamId: "  ", keyId: "key-1" } },
			{ apple: { teamId: "team-1", keyId: "" } },
		])("rejects incomplete provider fields (%j)", async (providerConfig) => {
			mocks.findFirst.mockResolvedValue({
				...config,
				provider: "apple",
				providerConfig,
			});
			expect(await check()).toMatchObject({
				success: false,
				status: "incomplete",
			});
		});

		it.each([null, "not-a-private-key", privateKey("secp384r1")])(
			"rejects missing, malformed, or wrong-curve private keys (%#)",
			async (key) => {
				mocks.getOrgSecret
					.mockResolvedValueOnce("stored-client-secret")
					.mockResolvedValueOnce(key);
				expect(await check()).toMatchObject({
					success: false,
					status: "incomplete",
				});
			},
		);
	});
});
