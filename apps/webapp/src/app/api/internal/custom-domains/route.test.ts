import { beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from "./route";

const { query, env } = vi.hoisted(() => ({
	query: vi.fn(),
	env: { CRON_SECRET: undefined as string | undefined },
}));

vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/env", () => ({ env }));
vi.mock("@/db", async () => {
	const { drizzle } = await import("drizzle-orm/pg-proxy");
	return { db: drizzle(query) };
});

const url = "http://web.app-prod.svc.cluster.local:3000/api/internal/custom-domains";
const authorization = "Bearer test-secret";
function request(headers: Record<string, string> = { authorization }, method = "GET") {
	return new Request(url, { headers, method });
}

beforeEach(() => {
	env.CRON_SECRET = "test-secret";
	query.mockReset().mockResolvedValue({ rows: [] });
});

describe("internal custom-domain inventory", () => {
	it.each(["", "192.0.2.1"])(
		"hides the route when Traefik supplies X-Real-IP (%j), even with a valid token",
		async (realIp) => {
			const response = await GET(request({ authorization, "x-real-ip": realIp }));
			expect(response.status).toBe(404);
			expect(await response.text()).toBe("");
			expect(query).not.toHaveBeenCalled();
		},
	);

	it("rejects ingress before checking credentials", async () => {
		const response = await GET(
			request({ "x-real-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.1" }),
		);
		expect(response.status).toBe(404);
		expect(query).not.toHaveBeenCalled();
	});

	it.each([undefined, "Bearer wrong", "test-secret", "Basic test-secret", "Bearer  test-secret"])(
		"rejects invalid cron authorization (%s)",
		async (header) => {
			const response = await GET(request(header ? { authorization: header } : {}));
			expect(response.status).toBe(401);
			expect(await response.text()).toBe("");
			expect(query).not.toHaveBeenCalled();
		},
	);

	it("fails closed without a configured secret", async () => {
		env.CRON_SECRET = undefined;
		expect((await GET(request())).status).toBe(401);
		expect(query).not.toHaveBeenCalled();
	});

	it.each(Object.entries({ POST, PUT, PATCH, DELETE, HEAD, OPTIONS }))(
		"rejects %s without reading the inventory",
		async (method, handle) => {
			const response = await handle(request({ authorization }, method));
			expect(response.status).toBe(405);
			expect(response.headers.get("allow")).toBe("GET");
			expect(query).not.toHaveBeenCalled();
		},
	);

	it("selects only verified hostnames and serves a normalized inventory on each poll", async () => {
		query.mockResolvedValueOnce({
			rows: [["TIME.Example.org.:443"], ["Login.acme.com."], ["time.example.org"]],
		});
		const poll = () =>
			GET(
				request({
					authorization,
					"x-forwarded-for": "10.0.0.4",
					"x-forwarded-host": new URL(url).host,
					"x-forwarded-port": "3000",
					"x-forwarded-proto": "http",
				}),
			);
		const response = await poll();
		expect(query).toHaveBeenCalledWith(
			'select "domain" from "organization_domain" where "organization_domain"."domain_verified" = $1',
			[true],
			"all",
			expect.anything(),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("application/json");
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({ domains: ["login.acme.com", "time.example.org"] });
		const empty = await poll();
		expect(empty.status).toBe(200);
		expect(await empty.json()).toEqual({ domains: [] });
	});

	it("aborts reconciliation if the query fails", async () => {
		query.mockRejectedValueOnce(new Error("Connection lost"));
		expect((await GET(request())).status).toBe(500);
	});

	it.each(["https://example.org/path", "*.example.org", "127.0.0.1"])(
		"aborts the whole inventory for a malformed verified row (%s)",
		async (domain) => {
			query.mockResolvedValueOnce({ rows: [["login.acme.com"], [domain]] });
			expect((await GET(request())).status).toBe(500);
		},
	);
});
