import { describe, expect, test, vi } from "vitest";
import { getPostgresSslConfig } from "./postgres-ssl";

describe("getPostgresSslConfig", () => {
	test("disables SSL when POSTGRES_SSL_MODE is unset", () => {
		expect(getPostgresSslConfig({})).toBe(false);
	});

	test("treats empty variables as unset, like the app env", () => {
		expect(getPostgresSslConfig({ POSTGRES_SSL_MODE: "" })).toBe(false);
		expect(
			getPostgresSslConfig(
				{
					POSTGRES_SSL_MODE: "verify-full",
					POSTGRES_SSL_CA_CERT: "",
					POSTGRES_SSL_ROOT_CERT_PATH: "/path/to/ca.pem",
				},
				(path) => `cert from ${path}`,
			),
		).toEqual({ ca: "cert from /path/to/ca.pem", rejectUnauthorized: true });
	});

	test("rejects an unknown mode", () => {
		expect(() => getPostgresSslConfig({ POSTGRES_SSL_MODE: "allow" })).toThrow(
			"POSTGRES_SSL_MODE must be one of",
		);
	});

	test("reads process.env by default", () => {
		vi.stubEnv("POSTGRES_SSL_MODE", "require");
		try {
			expect(getPostgresSslConfig()).toEqual({ rejectUnauthorized: false });
		} finally {
			vi.unstubAllEnvs();
		}
	});

	test("uses encrypted connections without certificate verification for require", () => {
		expect(getPostgresSslConfig({ POSTGRES_SSL_MODE: "require" })).toEqual({
			rejectUnauthorized: false,
		});
	});

	test("uses verify-full with a root certificate file path", () => {
		expect(
			getPostgresSslConfig(
				{
					POSTGRES_SSL_MODE: "verify-full",
					POSTGRES_SSL_ROOT_CERT_PATH: "/path/to/scaleway-ca.pem",
				},
				(path) => `cert from ${path}`,
			),
		).toEqual({
			ca: "cert from /path/to/scaleway-ca.pem",
			rejectUnauthorized: true,
		});
	});

	test("uses inline CA certificate content when provided", () => {
		expect(
			getPostgresSslConfig({
				POSTGRES_SSL_MODE: "verify-full",
				POSTGRES_SSL_CA_CERT: "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----",
			}),
		).toEqual({
			ca: "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----",
			rejectUnauthorized: true,
		});
	});
});
