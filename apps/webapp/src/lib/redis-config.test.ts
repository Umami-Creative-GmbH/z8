import { describe, expect, test } from "vitest";
import { createRedisConnectionOptions, createRedisTlsOptions } from "./redis-config";

describe("createRedisTlsOptions", () => {
	test("returns undefined when Redis TLS is disabled", () => {
		expect(
			createRedisTlsOptions(
				false,
				"-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----",
			),
		).toBeUndefined();
	});

	test("uses an explicit undefined CA when enabled without a CA cert", () => {
		expect(createRedisTlsOptions(true, undefined)).toEqual({ ca: undefined });
	});

	test("uses inline CA certificate when Redis TLS is enabled", () => {
		const redisCaCert = "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----";

		expect(createRedisTlsOptions(true, redisCaCert)).toEqual({ ca: redisCaCert });
	});
});

describe("createRedisConnectionOptions", () => {
	test("includes username and TLS CA options for Redis clients", () => {
		const redisCaCert = "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----";

		expect(
			createRedisConnectionOptions({
				REDIS_HOST: "redis.internal",
				REDIS_PORT: "6380",
				REDIS_USERNAME: "default",
				REDIS_PASSWORD: "secret",
				REDIS_TLS: "true",
				REDIS_CA_CERT: redisCaCert,
			}),
		).toEqual({
			host: "redis.internal",
			port: 6380,
			username: "default",
			password: "secret",
			tls: { ca: redisCaCert },
		});
	});

	test("falls back to local Redis defaults without optional credentials", () => {
		expect(
			createRedisConnectionOptions({
				REDIS_HOST: undefined,
				REDIS_PORT: undefined,
				REDIS_USERNAME: undefined,
				REDIS_PASSWORD: undefined,
				REDIS_TLS: undefined,
				REDIS_CA_CERT: undefined,
			}),
		).toEqual({
			host: "localhost",
			port: 6379,
			username: undefined,
			password: undefined,
			tls: undefined,
		});
	});
});
