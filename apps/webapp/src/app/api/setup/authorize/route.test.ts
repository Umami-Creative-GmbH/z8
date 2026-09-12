import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	exchange: vi.fn(),
	getDomainConfig: vi.fn(),
	resolvePlatformOrganization: vi.fn(),
	env: { APP_URL: "https://z8.example.com" as string | undefined },
}));
vi.mock("@/lib/setup/bootstrap.server", () => ({ setupBootstrap: mocks }));
vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/lib/domain/domain-service", () => ({
	getDomainConfig: mocks.getDomainConfig,
}));
vi.mock("@/lib/domain/platform-domain", () => ({
	resolvePlatformOrganization: mocks.resolvePlatformOrganization,
}));

describe("setup code exchange route", () => {
	beforeEach(() => {
		vi.resetAllMocks();
		mocks.env.APP_URL = "https://z8.example.com";
		mocks.getDomainConfig.mockResolvedValue(null);
		mocks.resolvePlatformOrganization.mockResolvedValue(null);
	});

	it("exchanges the printed default dev setup link without any configured origin or domain rows", async () => {
		mocks.env.APP_URL = undefined;
		mocks.exchange.mockResolvedValue({ token: "b".repeat(64), maxAge: 600 });
		const { GET } = await import("./route");
		const response = await GET(
			new NextRequest(
				`https://0.0.0.0:3000/api/setup/authorize?code=${"a".repeat(64)}`,
				{ headers: { host: "localhost:3000" } },
			),
		);
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"http://localhost:3000/setup",
		);
		expect(response.headers.get("set-cookie")).toContain("HttpOnly");
		expect(response.headers.get("set-cookie")).not.toContain("Secure");
		expect(mocks.exchange).toHaveBeenCalledWith("a".repeat(64));
		expect(mocks.getDomainConfig).not.toHaveBeenCalled();
		expect(mocks.resolvePlatformOrganization).not.toHaveBeenCalled();
	});

	it("uses the configured public Host before consuming a code despite an internal Next request URL", async () => {
		mocks.exchange.mockResolvedValue({ token: "b".repeat(64), maxAge: 600 });
		const { GET } = await import("./route");
		const response = await GET(
			new NextRequest(
				`https://0.0.0.0:3000/api/setup/authorize?code=${"a".repeat(64)}&locale=en`,
				{
					headers: {
						host: "z8.example.com",
						"x-forwarded-host": "evil.example",
					},
				},
			),
		);
		expect(response.headers.get("location")).toBe(
			"https://z8.example.com/en/setup",
		);
		expect(mocks.exchange).toHaveBeenCalledOnce();
		// A fresh instance has no organization/domain records yet.
		expect(mocks.getDomainConfig).not.toHaveBeenCalled();
		expect(mocks.resolvePlatformOrganization).not.toHaveBeenCalled();
	});

	it.each([
		"evil.example",
		"z8.example.com/evil",
		"z8.example.com@evil.example",
		"z8.example.com:65536",
	])(
		"rejects Host %s without consuming or redirecting the code-bearing request",
		async (host) => {
			const { GET } = await import("./route");
			const response = await GET(
				new NextRequest(
					"https://z8.example.com/api/setup/authorize?code=private-code",
					{ headers: { host } },
				),
			);
			expect(response.status).toBe(400);
			expect(response.headers.get("location")).toBeNull();
			expect(response.headers.get("set-cookie")).toBeNull();
			expect(response.headers.get("cache-control")).toContain("no-store");
			expect(response.headers.get("referrer-policy")).toBe("no-referrer");
			expect(await response.text()).toBe("Setup authorization unavailable");
			expect(mocks.exchange).not.toHaveBeenCalled();
		},
	);

	it("honors a configured HTTP localhost port and its cookie transport despite an internal HTTPS URL", async () => {
		mocks.env.APP_URL = "http://localhost:4310";
		mocks.exchange.mockResolvedValue({ token: "b".repeat(64), maxAge: 600 });
		const { GET } = await import("./route");
		const response = await GET(
			new NextRequest(
				`https://0.0.0.0:3000/api/setup/authorize?code=${"a".repeat(64)}`,
				{ headers: { host: "localhost:4310" } },
			),
		);
		expect(response.headers.get("location")).toBe(
			"http://localhost:4310/setup",
		);
		expect(response.headers.get("set-cookie")).not.toContain("Secure");
		expect(response.headers.get("set-cookie")).toContain("HttpOnly");
		expect(mocks.exchange).toHaveBeenCalledOnce();
	});

	it("fails closed before exchange when custom-domain verification is unavailable", async () => {
		mocks.getDomainConfig.mockRejectedValue(
			new Error("private database error"),
		);
		const { GET } = await import("./route");
		const response = await GET(
			new NextRequest(
				"https://0.0.0.0:3000/api/setup/authorize?code=private-code",
				{ headers: { host: "tenant.example.org" } },
			),
		);
		expect(response.status).toBe(400);
		expect(response.headers.get("location")).toBeNull();
		expect(await response.text()).toBe("Setup authorization unavailable");
		expect(mocks.exchange).not.toHaveBeenCalled();
	});

	it("sets a short-lived HttpOnly host-only cookie and redirects to a clean localized URL", async () => {
		mocks.exchange.mockResolvedValue({ token: "b".repeat(64), maxAge: 17 });
		const { GET } = await import("./route");
		const response = await GET(
			new NextRequest(
				`https://z8.example.com/api/setup/authorize?code=${"a".repeat(64)}&locale=de`,
			),
		);
		expect(mocks.exchange).toHaveBeenCalledWith("a".repeat(64));
		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe(
			"https://z8.example.com/de/setup",
		);
		expect(response.headers.get("set-cookie")).toContain("HttpOnly");
		expect(response.headers.get("set-cookie")).toContain("Secure");
		expect(response.headers.get("set-cookie")).toContain("SameSite=strict");
		expect(response.headers.get("set-cookie")).toContain("Max-Age=17");
		expect(response.headers.get("set-cookie")).not.toContain("Domain=");
		expect(response.headers.get("cache-control")).toContain("no-store");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	});

	it("removes invalid codes from the URL without issuing authorization or accepting redirect targets", async () => {
		mocks.exchange.mockResolvedValue(null);
		const { GET } = await import("./route");
		const response = await GET(
			new NextRequest(
				"https://z8.example.com/api/setup/authorize?code=invalid&locale=https://evil.example",
			),
		);
		expect(response.headers.get("location")).toBe(
			"https://z8.example.com/setup",
		);
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	});

	it("fails closed without reflecting a code or Redis error", async () => {
		mocks.exchange.mockRejectedValue(new Error("secret Redis command"));
		const { GET } = await import("./route");
		const response = await GET(
			new NextRequest("https://z8.example.com/api/setup/authorize?code=secret"),
		);
		expect(response.headers.get("location")).toBe(
			"https://z8.example.com/setup",
		);
		expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
		expect(await response.text()).not.toContain("secret");
	});
	it("does not consume a code for HEAD link probes", async () => {
		const { HEAD } = await import("./route");
		const response = await HEAD();
		expect(response.status).toBe(405);
		expect(mocks.exchange).not.toHaveBeenCalled();
		expect(response.headers.get("referrer-policy")).toBe("no-referrer");
	});
});
