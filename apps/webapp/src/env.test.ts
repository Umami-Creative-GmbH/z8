import { afterEach, describe, expect, test, vi } from "vitest";

const originalEnv = process.env;

const baseEnv = {
	BETTER_AUTH_SECRET: "a".repeat(32),
	S3_PUBLIC_BUCKET: "z8-test-bucket",
	S3_PUBLIC_ACCESS_KEY_ID: "test-access-key",
	S3_PUBLIC_SECRET_ACCESS_KEY: "test-secret-key",
	S3_PUBLIC_ENDPOINT: "https://s3.example.com",
	S3_PUBLIC_URL: "https://cdn.example.com",
};

async function importEnv(env: Record<string, string | undefined>) {
	vi.resetModules();
	process.env = {
		...originalEnv,
		...baseEnv,
		...env,
		CI: "false",
		SKIP_ENV_VALIDATION: "false",
	};
	return import("./env");
}

describe("env", () => {
	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	test("defaults to the vault secret store provider", async () => {
		const { env } = await importEnv({ SECRET_STORE_PROVIDER: undefined });

		expect(env.SECRET_STORE_PROVIDER).toBe("vault");
	});

	test("fails validation when the Scaleway provider is missing credentials", async () => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});

		await expect(
			importEnv({
				SECRET_STORE_PROVIDER: "scaleway",
				SCALEWAY_ACCESS_KEY: undefined,
				SCALEWAY_SECRET_KEY: undefined,
				SCALEWAY_PROJECT_ID: undefined,
			})
		).rejects.toThrow("process.exit:1");
	});

	test("passes validation when the Scaleway provider has credentials", async () => {
		const { env } = await importEnv({
			SECRET_STORE_PROVIDER: "scaleway",
			SCALEWAY_ACCESS_KEY: "SCWXXXXXXXXXXXXXXXXX",
			SCALEWAY_SECRET_KEY: "test-scaleway-secret-key",
			SCALEWAY_PROJECT_ID: "11111111-1111-1111-1111-111111111111",
		});

		expect(env.SECRET_STORE_PROVIDER).toBe("scaleway");
		expect(env.SCALEWAY_REGION).toBe("fr-par");
		expect(env.SCALEWAY_KEY_MANAGER_API_URL).toBe("https://api.scaleway.com");
	});

	test.each(["smtp", "resend"])("accepts strict system email provider %s", async (provider) => {
		const { env } = await importEnv({ EMAIL_PROVIDER: provider });

		expect(env.EMAIL_PROVIDER).toBe(provider);
	});

	test("treats empty system email provider as unset", async () => {
		const { env } = await importEnv({ EMAIL_PROVIDER: "" });

		expect(env.EMAIL_PROVIDER).toBeUndefined();
	});

	test("treats empty optional SMTP validated values as unset", async () => {
		const { env } = await importEnv({
			SMTP_SECURE: "",
			SMTP_REQUIRE_TLS: "",
			SMTP_FROM_EMAIL: "",
		});

		expect(env.SMTP_SECURE).toBeUndefined();
		expect(env.SMTP_REQUIRE_TLS).toBeUndefined();
		expect(env.SMTP_FROM_EMAIL).toBeUndefined();
	});

	test("rejects invalid system email providers", async () => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});

		await expect(importEnv({ EMAIL_PROVIDER: "mailgun" })).rejects.toThrow("process.exit:1");
	});

	test("accepts managed Redis TLS configuration", async () => {
		const { env } = await importEnv({
			REDIS_HOST: "managed-redis.example.com",
			REDIS_PORT: "6380",
			REDIS_PASSWORD: "redis-password",
			REDIS_TLS: "true",
		});

		expect(env.REDIS_HOST).toBe("managed-redis.example.com");
		expect(env.REDIS_PORT).toBe("6380");
		expect(env.REDIS_PASSWORD).toBe("redis-password");
		expect(env.REDIS_TLS).toBe("true");
	});
});
