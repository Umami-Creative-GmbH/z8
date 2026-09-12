import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	env: {
		APP_URL: undefined as string | undefined,
		BETTER_AUTH_URL: undefined as string | undefined,
		NEXT_PUBLIC_APP_URL: undefined as string | undefined,
		MAIN_DOMAIN: undefined as string | undefined,
		PLATFORM_DOMAIN: undefined as string | undefined,
	},
	getDomainConfig: vi.fn(),
	resolvePlatformOrganization: vi.fn(),
}));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("./domain-service", () => ({ getDomainConfig: mocks.getDomainConfig }));
vi.mock("./platform-domain", () => ({
	resolvePlatformOrganization: mocks.resolvePlatformOrganization,
}));

import { resolvePublicRequestOrigin } from "./request-origin";

function request(
	host?: string,
	url = "https://0.0.0.0:3000/setup?code=private-code",
) {
	return new Request(url, {
		headers: {
			...(host === undefined ? {} : { host }),
			"x-forwarded-host": "forwarded.attacker.test",
			"x-forwarded-proto": "http",
		},
	});
}

describe("validated public request origin", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		for (const key of Object.keys(mocks.env) as (keyof typeof mocks.env)[]) {
			mocks.env[key] = undefined;
		}
		mocks.getDomainConfig.mockResolvedValue(null);
		mocks.resolvePlatformOrganization.mockResolvedValue(null);
	});

	it("accepts startup's exact default localhost origin without configuration or domain rows", async () => {
		await expect(
			resolvePublicRequestOrigin(request("localhost:3000")),
		).resolves.toBe("http://localhost:3000");
		await expect(
			resolvePublicRequestOrigin(
				request(undefined, "http://localhost:3000/setup?code=private-code"),
			),
		).resolves.toBe("http://localhost:3000");
		expect(mocks.getDomainConfig).not.toHaveBeenCalled();
		expect(mocks.resolvePlatformOrganization).not.toHaveBeenCalled();
	});

	it.each([
		"localhost:3001",
		"localhost",
		"other.localhost:3000",
		"127.0.0.1:3000",
		"unverified.example.org",
		"0.0.0.0:3000",
		"[::]:3000",
	])(
		"does not expand startup's default trust to unconfigured authority %s",
		async (host) => {
			await expect(resolvePublicRequestOrigin(request(host))).rejects.toThrow(
				"Public request origin unavailable",
			);
			await expect(
				resolvePublicRequestOrigin(request(undefined, `http://${host}/setup`)),
			).rejects.toThrow("Public request origin unavailable");
		},
	);

	it.each([
		"APP_URL",
		"BETTER_AUTH_URL",
		"NEXT_PUBLIC_APP_URL",
		"MAIN_DOMAIN",
		"PLATFORM_DOMAIN",
	] as const)(
		"does not add the localhost default when %s is explicitly configured",
		async (key) => {
			mocks.env[key] = "http://localhost:4310";
			await expect(
				resolvePublicRequestOrigin(request("localhost:4310")),
			).resolves.toBe("http://localhost:4310");
			await expect(
				resolvePublicRequestOrigin(request("localhost:3000")),
			).rejects.toThrow("Public request origin unavailable");
		},
	);

	it.each(["APP_URL", "BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const)(
		"trusts configured %s without tenant/domain rows and preserves HTTP/custom ports",
		async (key) => {
			mocks.env[key] = "http://dev.example.test:4310/app";
			await expect(
				resolvePublicRequestOrigin(request("dev.example.test:4310")),
			).resolves.toBe("http://dev.example.test:4310");
			expect(mocks.getDomainConfig).not.toHaveBeenCalled();
			expect(mocks.resolvePlatformOrganization).not.toHaveBeenCalled();
		},
	);

	it.each(["MAIN_DOMAIN", "PLATFORM_DOMAIN"] as const)(
		"accepts configured %s root without a database lookup",
		async (key) => {
			mocks.env[key] = "public.example.test";
			await expect(
				resolvePublicRequestOrigin(request("PUBLIC.EXAMPLE.TEST:443")),
			).resolves.toBe("https://public.example.test");
			expect(mocks.getDomainConfig).not.toHaveBeenCalled();
			expect(mocks.resolvePlatformOrganization).not.toHaveBeenCalled();
		},
	);

	it("only accepts a registered platform organization and uses the platform-configured scheme/port", async () => {
		mocks.env.PLATFORM_DOMAIN = "http://platform.example.test:4310";
		mocks.resolvePlatformOrganization.mockResolvedValue({ id: "org" });
		await expect(
			resolvePublicRequestOrigin(request("team.platform.example.test:4310")),
		).resolves.toBe("http://team.platform.example.test:4310");
		expect(mocks.resolvePlatformOrganization).toHaveBeenCalledWith("team");
		expect(mocks.getDomainConfig).not.toHaveBeenCalled();
	});

	it.each([
		"missing.platform.example.test",
		"nested.team.platform.example.test",
		"team.platform.example.test:8080",
	])(
		"rejects unknown platform authority %s without falling back to custom-domain policy",
		async (host) => {
			mocks.env.PLATFORM_DOMAIN = "platform.example.test";
			mocks.getDomainConfig.mockResolvedValue({
				domain: host,
				organizationId: "org",
			});
			await expect(resolvePublicRequestOrigin(request(host))).rejects.toThrow(
				"Public request origin unavailable",
			);
			expect(mocks.getDomainConfig).not.toHaveBeenCalled();
		},
	);

	it("uses HTTPS for a verified custom domain, ignoring both forwarding headers", async () => {
		mocks.getDomainConfig.mockResolvedValue({
			domain: "tenant.example.org",
			organizationId: "org",
		});
		await expect(
			resolvePublicRequestOrigin(request("tenant.example.org")),
		).resolves.toBe("https://tenant.example.org");
		expect(mocks.getDomainConfig).toHaveBeenCalledWith("tenant.example.org");
	});

	it.each([
		"unverified.example.org",
		"https://public.example.test",
		"public.example.test/path",
		"public.example.test@evil.test",
		"public.example.test,evil.test",
		"public.example.test:65536",
		"public.example.test:0",
		"public.example.test:8080",
		"public.example.test%2fevil.test",
		"0.0.0.0:3000",
		"[::]:3000",
		"localhost:3000",
	])(
		"never falls back from invalid/unverified Host %s to a configured origin",
		async (host) => {
			mocks.env.APP_URL = "https://public.example.test";
			await expect(resolvePublicRequestOrigin(request(host))).rejects.toThrow(
				"Public request origin unavailable",
			);
		},
	);

	it("uses the first operator-configured public origin when Host is absent", async () => {
		mocks.env.APP_URL = "http://localhost:4310";
		mocks.env.BETTER_AUTH_URL = "https://auth.example.test/api/auth";
		await expect(resolvePublicRequestOrigin(request())).resolves.toBe(
			"http://localhost:4310",
		);
		expect(mocks.getDomainConfig).not.toHaveBeenCalled();
	});

	it("only uses a Host-less request URL when its public origin is verified", async () => {
		mocks.getDomainConfig.mockResolvedValue({
			domain: "tenant.example.org",
			organizationId: "org",
		});
		await expect(
			resolvePublicRequestOrigin(
				request(
					undefined,
					"https://tenant.example.org/setup?code=private-code",
				),
			),
		).resolves.toBe("https://tenant.example.org");
		mocks.getDomainConfig.mockResolvedValue(null);
		await expect(
			resolvePublicRequestOrigin(
				request(undefined, "https://unverified.example.org/setup"),
			),
		).rejects.toThrow("Public request origin unavailable");
	});

	it("rejects the Host-less internal bind address even when a domain lookup could succeed", async () => {
		mocks.getDomainConfig.mockResolvedValue({ organizationId: "org" });
		await expect(resolvePublicRequestOrigin(request())).rejects.toThrow(
			"Public request origin unavailable",
		);
		expect(mocks.getDomainConfig).not.toHaveBeenCalled();
	});

	it("fails closed on domain lookup errors without surfacing their details", async () => {
		mocks.getDomainConfig.mockRejectedValue(
			new Error("private database details"),
		);
		await expect(
			resolvePublicRequestOrigin(request("tenant.example.org")),
		).rejects.toThrow(/^Public request origin unavailable$/);
	});

	it.each([
		"javascript:alert(1)",
		"https://user:password@public.example.test",
		"https://0.0.0.0:3000",
	])(
		"does not use an invalid operator origin %s for Host-less callers",
		async (origin) => {
			mocks.env.APP_URL = origin;
			await expect(resolvePublicRequestOrigin(request())).rejects.toThrow(
				"Public request origin unavailable",
			);
		},
	);
});
