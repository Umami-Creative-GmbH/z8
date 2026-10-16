import { afterEach, describe, expect, it, vi } from "vitest";
import { getDevelopmentTurnstileKeys } from "./development-keys";

afterEach(() => vi.unstubAllEnvs());

describe("local development Turnstile keys", () => {
	it.each([
		"localhost",
		"localhost:3000",
		"z8.localhost",
		"tenant.z8.localhost:443",
		"127.0.0.1:4230",
	])("uses Cloudflare test keys on %s in development", (host) => {
		vi.stubEnv("NODE_ENV", "development");
		expect(getDevelopmentTurnstileKeys(host)).toEqual({
			siteKey: "1x00000000000000000000AA",
			secretKey: "1x0000000000000000000000000000000AA",
		});
	});
	it.each(["production", "test"])("never selects test keys in %s", (mode) => {
		vi.stubEnv("NODE_ENV", mode);
		expect(getDevelopmentTurnstileKeys("z8.localhost")).toBeNull();
	});
	it.each([
		"z8-time.app",
		"z8.localhost.attacker.org",
		"attacker@z8.localhost",
		"z8.localhost/path",
		"z8.localhost:99999",
		"",
		null,
		undefined,
	])(
		"does not select test keys for an invalid or non-local host %s",
		(host) => {
			vi.stubEnv("NODE_ENV", "development");
			expect(getDevelopmentTurnstileKeys(host)).toBeNull();
		},
	);
});
