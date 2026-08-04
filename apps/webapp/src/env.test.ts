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

const operationalEnvDefaults = {
	QUEUE_HEALTH_TIMEOUT_MS: "1000",
	QUEUE_JOB_ATTEMPTS: "3",
	QUEUE_JOB_BACKOFF_DELAY_MS: "1000",
	QUEUE_COMPLETED_JOB_RETENTION_COUNT: "100",
	QUEUE_COMPLETED_JOB_RETENTION_SECONDS: "86400",
	QUEUE_FAILED_JOB_RETENTION_COUNT: "500",
	QUEUE_FAILED_JOB_RETENTION_SECONDS: "604800",
	REDIS_MAX_RECONNECT_ATTEMPTS: "8",
	REDIS_LOG_THROTTLE_MS: "30000",
	REDIS_MAX_RETRIES_PER_REQUEST: "1",
	REDIS_RECONNECT_BASE_DELAY_MS: "100",
	REDIS_RECONNECT_MAX_DELAY_MS: "2000",
	REDIS_HEALTH_TIMEOUT_MS: "1000",
	SMTP_CONNECTION_TIMEOUT_MS: "10000",
	SMTP_GREETING_TIMEOUT_MS: "10000",
	SMTP_SOCKET_TIMEOUT_MS: "30000",
	TURNSTILE_TIMEOUT_MS: "5000",
	WEBHOOK_RETRY_DELAYS_MS: "0,1000,5000,30000,120000,600000",
	WEBHOOK_MAX_ATTEMPTS: "6",
	WEBHOOK_TIMEOUT_MS: "30000",
	WEBHOOK_MAX_RESPONSE_BODY_LENGTH: "10240",
	WORK_BALANCE_JOB_BATCH_LIMIT: "1000",
	CLOCKODO_IMPORT_QUERY_CHUNK_SIZE: "500",
	CLOCKODO_IMPORT_CONCURRENCY: "4",
	EXPORT_FETCH_BATCH_SIZE: "1000",
	TUS_MAX_UPLOAD_SIZE_BYTES: "10485760",
	IMAGE_MAX_UPLOAD_SIZE_BYTES: "10485760",
	TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: "10485760",
	TUS_MULTIPART_PART_SIZE_BYTES: "8388608",
	JOB_EXECUTION_RETENTION_DAYS: "90",
	DOMAIN_CACHE_TTL_SECONDS: "300",
	SECRET_STORE_STATUS_CACHE_TTL_SECONDS: "86400",
} as const;

const operationalEnvOverrides = {
	QUEUE_HEALTH_TIMEOUT_MS: "1100",
	QUEUE_JOB_ATTEMPTS: "4",
	QUEUE_JOB_BACKOFF_DELAY_MS: "1200",
	QUEUE_COMPLETED_JOB_RETENTION_COUNT: "110",
	QUEUE_COMPLETED_JOB_RETENTION_SECONDS: "90000",
	QUEUE_FAILED_JOB_RETENTION_COUNT: "510",
	QUEUE_FAILED_JOB_RETENTION_SECONDS: "605000",
	REDIS_MAX_RECONNECT_ATTEMPTS: "9",
	REDIS_LOG_THROTTLE_MS: "31000",
	REDIS_MAX_RETRIES_PER_REQUEST: "2",
	REDIS_RECONNECT_BASE_DELAY_MS: "110",
	REDIS_RECONNECT_MAX_DELAY_MS: "2100",
	REDIS_HEALTH_TIMEOUT_MS: "1100",
	SMTP_CONNECTION_TIMEOUT_MS: "11000",
	SMTP_GREETING_TIMEOUT_MS: "12000",
	SMTP_SOCKET_TIMEOUT_MS: "31000",
	TURNSTILE_TIMEOUT_MS: "5100",
	WEBHOOK_RETRY_DELAYS_MS: "0,2000,6000,31000,121000,601000,900000",
	WEBHOOK_MAX_ATTEMPTS: "7",
	WEBHOOK_TIMEOUT_MS: "31000",
	WEBHOOK_MAX_RESPONSE_BODY_LENGTH: "11240",
	WORK_BALANCE_JOB_BATCH_LIMIT: "1100",
	CLOCKODO_IMPORT_QUERY_CHUNK_SIZE: "510",
	CLOCKODO_IMPORT_CONCURRENCY: "5",
	EXPORT_FETCH_BATCH_SIZE: "1100",
	TUS_MAX_UPLOAD_SIZE_BYTES: "10485761",
	IMAGE_MAX_UPLOAD_SIZE_BYTES: "10485762",
	TRAVEL_EXPENSE_MAX_UPLOAD_SIZE_BYTES: "10485763",
	TUS_MULTIPART_PART_SIZE_BYTES: "8388609",
	JOB_EXECUTION_RETENTION_DAYS: "91",
	DOMAIN_CACHE_TTL_SECONDS: "301",
	SECRET_STORE_STATUS_CACHE_TTL_SECONDS: "86401",
} as const;

async function importEnv(
	env: Record<string, string | undefined>,
	validationMode: { CI: string; SKIP_ENV_VALIDATION: string } = {
		CI: "false",
		SKIP_ENV_VALIDATION: "false",
	},
) {
	vi.resetModules();
	const inheritedEnv = { ...originalEnv };
	for (const key of Object.keys(operationalEnvDefaults)) {
		delete inheritedEnv[key];
	}
	process.env = {
		...inheritedEnv,
		...baseEnv,
		...env,
		...validationMode,
	};
	return import("./env");
}

describe("env", () => {
	afterEach(() => {
		process.env = originalEnv;
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	test("defaults to the vault secret store provider", async () => {
		const { env } = await importEnv({ SECRET_STORE_PROVIDER: undefined });

		expect(env.SECRET_STORE_PROVIDER).toBe("vault");
	});

	test("defaults organization creation disabling to false", async () => {
		const { env } = await importEnv({ DISABLE_ORGANIZATION_CREATION: undefined });

		expect(env.DISABLE_ORGANIZATION_CREATION).toBe("false");
	});

	test("accepts disabling organization creation", async () => {
		const { env } = await importEnv({ DISABLE_ORGANIZATION_CREATION: "true" });

		expect(env.DISABLE_ORGANIZATION_CREATION).toBe("true");
	});

	test("defaults telemetry reporting to enabled", async () => {
		const { env } = await importEnv({ TELEMETRY_ENABLED: undefined });

		expect(env.TELEMETRY_ENABLED).toBe("true");
	});

	test("accepts disabling telemetry reporting", async () => {
		const { env } = await importEnv({ TELEMETRY_ENABLED: "false" });

		expect(env.TELEMETRY_ENABLED).toBe("false");
	});

	test("rejects invalid telemetry reporting values", async () => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});

		await expect(importEnv({ TELEMETRY_ENABLED: "0" })).rejects.toThrow(
			"process.exit:1",
		);
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
			}),
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

	test("allows browser imports to read public environment variables", async () => {
		vi.stubGlobal("window", {});

		const { env } = await importEnv({
			NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN: "phc_test",
		});

		expect(env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN).toBe("phc_test");
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
		const redisCaCert = "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----";
		const { env } = await importEnv({
			REDIS_HOST: "managed-redis.example.com",
			REDIS_PORT: "6380",
			REDIS_USERNAME: "default",
			REDIS_PASSWORD: "redis-password",
			REDIS_TLS: "true",
			REDIS_CA_CERT: redisCaCert,
		});

		expect(env.REDIS_HOST).toBe("managed-redis.example.com");
		expect(env.REDIS_PORT).toBe("6380");
		expect(env.REDIS_USERNAME).toBe("default");
		expect(env.REDIS_PASSWORD).toBe("redis-password");
		expect(env.REDIS_TLS).toBe("true");
		expect(env.REDIS_CA_CERT).toBe(redisCaCert);
	});

	test("defaults the Redis command timeout to two seconds", async () => {
		const { env } = await importEnv({ REDIS_COMMAND_TIMEOUT_MS: undefined });

		expect(env.REDIS_COMMAND_TIMEOUT_MS).toBe("2000");
	});

	test("accepts a custom Redis command timeout", async () => {
		const { env } = await importEnv({ REDIS_COMMAND_TIMEOUT_MS: "3500" });

		expect(env.REDIS_COMMAND_TIMEOUT_MS).toBe("3500");
	});

	test.each(["0", "-1", "1.5", "invalid"])(
		"rejects invalid Redis command timeout %s",
		async (timeout) => {
			vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`process.exit:${code}`);
			});

			await expect(importEnv({ REDIS_COMMAND_TIMEOUT_MS: timeout })).rejects.toThrow(
				"process.exit:1",
			);
		},
	);

	test("exposes PostgreSQL startup options through the validated environment", async () => {
		const { env } = await importEnv({ PGOPTIONS: "-c statement_timeout=5000" });

		expect(env.PGOPTIONS).toBe("-c statement_timeout=5000");
	});

	test("defaults all operational server settings when they are unset", async () => {
		const unsetOperationalEnv = Object.fromEntries(
			Object.keys(operationalEnvDefaults).map((key) => [key, undefined]),
		);
		const { env } = await importEnv(unsetOperationalEnv);

		for (const [key, value] of Object.entries(operationalEnvDefaults)) {
			expect(env[key as keyof typeof operationalEnvDefaults]).toBe(value);
		}
	});

	test("accepts overrides for all operational server settings", async () => {
		const { env } = await importEnv(operationalEnvOverrides);

		for (const [key, value] of Object.entries(operationalEnvOverrides)) {
			expect(env[key as keyof typeof operationalEnvOverrides]).toBe(value);
		}
	});

	test.each([
		{ CI: "true", SKIP_ENV_VALIDATION: "false" },
		{ CI: "false", SKIP_ENV_VALIDATION: "true" },
	])("defaults all operational server settings when validation is skipped", async (mode) => {
		const unsetOperationalEnv = Object.fromEntries(
			Object.keys(operationalEnvDefaults).map((key) => [key, undefined]),
		);
		const { env } = await importEnv(unsetOperationalEnv, mode);

		for (const [key, value] of Object.entries(operationalEnvDefaults)) {
			expect(env[key as keyof typeof operationalEnvDefaults]).toBe(value);
		}
	});

	test("keeps explicit operational values when validation is skipped", async () => {
		const { env } = await importEnv(operationalEnvOverrides, {
			CI: "false",
			SKIP_ENV_VALIDATION: "true",
		});

		for (const [key, value] of Object.entries(operationalEnvOverrides)) {
			expect(env[key as keyof typeof operationalEnvOverrides]).toBe(value);
		}
	});

	test.each([
		{ CI: "true", SKIP_ENV_VALIDATION: "false" },
		{ CI: "false", SKIP_ENV_VALIDATION: "true" },
	])("defaults empty operational server settings when validation is skipped", async (mode) => {
		const emptyOperationalEnv = Object.fromEntries(
			Object.keys(operationalEnvDefaults).map((key) => [key, ""]),
		);
		const { env } = await importEnv(emptyOperationalEnv, mode);

		for (const [key, value] of Object.entries(operationalEnvDefaults)) {
			expect(env[key as keyof typeof operationalEnvDefaults]).toBe(value);
		}
	});

	test("treats empty operational server settings as unset", async () => {
		const emptyOperationalEnv = Object.fromEntries(
			Object.keys(operationalEnvDefaults).map((key) => [key, ""]),
		);
		const { env } = await importEnv(emptyOperationalEnv);

		for (const [key, value] of Object.entries(operationalEnvDefaults)) {
			expect(env[key as keyof typeof operationalEnvDefaults]).toBe(value);
		}
	});

	test.each(["0", "-1", "1.5", "invalid"])(
		"rejects malformed positive integer operational setting %s",
		async (value) => {
			vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`process.exit:${code}`);
			});

			await expect(importEnv({ QUEUE_JOB_ATTEMPTS: value })).rejects.toThrow(
				"process.exit:1",
			);
		},
	);

	test("rejects an unsafe positive integer operational setting", async () => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});

		await expect(importEnv({ QUEUE_JOB_ATTEMPTS: "9007199254740992" })).rejects.toThrow(
			"process.exit:1",
		);
	});

	test.each(["5242879", "5368709121"])(
		"rejects TUS multipart part size outside the S3 range: %s",
		async (value) => {
			vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`process.exit:${code}`);
			});

			await expect(
				importEnv({ TUS_MULTIPART_PART_SIZE_BYTES: value }),
			).rejects.toThrow("process.exit:1");
		},
	);

	test.each(["5242880", "5368709120"])(
		"accepts TUS multipart part size at an S3 boundary: %s",
		async (value) => {
			const { env } = await importEnv({ TUS_MULTIPART_PART_SIZE_BYTES: value });

			expect(env.TUS_MULTIPART_PART_SIZE_BYTES).toBe(value);
		},
	);

	test("rejects a millisecond setting above Node's maximum timeout", async () => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});

		await expect(importEnv({ QUEUE_HEALTH_TIMEOUT_MS: "2147483648" })).rejects.toThrow(
			"process.exit:1",
		);
	});

	test.each(["-1,1000", "0,1.5", "0,,1000", "0,invalid", "0, 1000"])(
		"rejects malformed webhook retry delays %s",
		async (value) => {
			vi.spyOn(process, "exit").mockImplementation((code) => {
				throw new Error(`process.exit:${code}`);
			});

			await expect(importEnv({ WEBHOOK_RETRY_DELAYS_MS: value })).rejects.toThrow(
				"process.exit:1",
			);
		},
	);

	test("rejects a webhook retry delay above Node's maximum timeout", async () => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});

		await expect(
			importEnv({ WEBHOOK_RETRY_DELAYS_MS: "0,1000,5000,30000,120000,2147483648" }),
		).rejects.toThrow("process.exit:1");
	});

	test("rejects webhook attempts exceeding the retry delay count", async () => {
		vi.spyOn(process, "exit").mockImplementation((code) => {
			throw new Error(`process.exit:${code}`);
		});

		await expect(
			importEnv({
				WEBHOOK_RETRY_DELAYS_MS: "0,1000",
				WEBHOOK_MAX_ATTEMPTS: "3",
			}),
		).rejects.toThrow("process.exit:1");
	});

	test("ignores inherited operational settings not supplied by a test", async () => {
		const inheritedValue = originalEnv.QUEUE_JOB_ATTEMPTS;
		originalEnv.QUEUE_JOB_ATTEMPTS = "invalid";

		try {
			const { env } = await importEnv({});

			expect(env.QUEUE_JOB_ATTEMPTS).toBe("3");
		} finally {
			if (inheritedValue === undefined) {
				delete originalEnv.QUEUE_JOB_ATTEMPTS;
			} else {
				originalEnv.QUEUE_JOB_ATTEMPTS = inheritedValue;
			}
		}
	});
});
