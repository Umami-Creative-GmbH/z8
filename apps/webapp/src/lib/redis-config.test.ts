import { describe, expect, test } from "vitest";
import { createRedisTlsOptions } from "./redis-config";

describe("createRedisTlsOptions", () => {
	test("returns undefined when Redis TLS is disabled", () => {
		expect(createRedisTlsOptions(false, "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----")).toBeUndefined();
	});

	test("returns empty TLS options when enabled without a CA cert", () => {
		expect(createRedisTlsOptions(true, undefined)).toEqual({});
	});

	test("uses inline CA certificate when Redis TLS is enabled", () => {
		const redisCaCert = "-----BEGIN CERTIFICATE-----\ntest-ca\n-----END CERTIFICATE-----";

		expect(createRedisTlsOptions(true, redisCaCert)).toEqual({ ca: redisCaCert });
	});
});
