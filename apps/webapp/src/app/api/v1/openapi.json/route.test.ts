import { beforeEach, describe, expect, it, vi } from "vitest";
import generatedDocument from "../../../../../openapi/public-api-v1.json";

const installation = vi.hoisted(() => ({
	APP_URL: undefined as string | undefined,
	BETTER_AUTH_URL: undefined as string | undefined,
	NEXT_PUBLIC_APP_URL: undefined as string | undefined,
	MAIN_DOMAIN: undefined as string | undefined,
	PLATFORM_DOMAIN: undefined as string | undefined,
}));
vi.mock("@/env", () => ({ env: installation }));

import { GET } from "./route";

describe("public OpenAPI download", () => {
	beforeEach(() => {
		installation.APP_URL = "https://workforce.example.org:8443";
		installation.BETTER_AUTH_URL = undefined;
		installation.NEXT_PUBLIC_APP_URL = undefined;
		installation.MAIN_DOMAIN = undefined;
		installation.PLATFORM_DOMAIN = undefined;
	});

	it("downloads the deployed contract without credentials and retains the self-hosted API target after import", async () => {
		installation.MAIN_DOMAIN = "main.example.org";
		installation.PLATFORM_DOMAIN = "platform.example.org";
		// Next.js can see its internal listening URL behind the installation's proxy.
		const response = await GET(
			new Request("http://localhost:3000/api/v1/openapi.json"),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
		expect(response.headers.get("content-disposition")).toBe(
			'attachment; filename="z8-public-api-v1.openapi.json"',
		);
		const imported = JSON.parse(await response.text());
		expect(imported.openapi).toBe("3.1.0");
		expect(new URL("/api/v1/employees", imported.servers[0].url).href).toBe(
			"https://workforce.example.org:8443/api/v1/employees",
		);
		// Installation targeting changes only the server, never the generated contract.
		expect({ ...imported, servers: generatedDocument.servers }).toEqual(
			generatedDocument,
		);
	});

	it("keeps hosted imports on the hosted API instead of the documentation host", async () => {
		installation.APP_URL = "https://ui.z8-time.app";
		const response = await GET(
			new Request("http://localhost:3000/api/v1/openapi.json"),
		);
		const imported = JSON.parse(await response.text());
		// Resolve the imported server even if the client was opened on the docs site.
		const server = new URL(
			imported.servers[0].url,
			"https://docs.z8-time.app/docs/api-reference",
		);
		expect(new URL("/api/v1/work-periods", server).href).toBe(
			"https://ui.z8-time.app/api/v1/work-periods",
		);
	});

	it.each(["BETTER_AUTH_URL", "NEXT_PUBLIC_APP_URL"] as const)(
		"retains self-hosted targets configured through %s",
		async (setting) => {
			installation.APP_URL = undefined;
			installation[setting] = "http://workforce.example.org:4310";
			installation.MAIN_DOMAIN = "main.example.org";
			installation.PLATFORM_DOMAIN = "platform.example.org";
			const response = await GET(
				new Request("http://localhost:3000/api/v1/openapi.json"),
			);
			const imported = await response.json();
			expect(new URL("/api/v1/employees", imported.servers[0].url).href).toBe(
				"http://workforce.example.org:4310/api/v1/employees",
			);
		},
	);

	it("retains the configured public domain when a proxy serves the download from an internal URL", async () => {
		installation.APP_URL = undefined;
		installation.MAIN_DOMAIN = "workforce.example.org";
		installation.PLATFORM_DOMAIN = "workforce.example.org";
		const response = await GET(
			new Request("http://localhost:3000/api/v1/openapi.json", {
				headers: {
					Host: "workforce.example.org",
					"x-forwarded-proto": "https",
				},
			}),
		);
		const imported = JSON.parse(await response.text());
		expect(new URL("/api/v1/employees", imported.servers[0].url).href).toBe(
			"https://workforce.example.org/api/v1/employees",
		);
		expect({ ...imported, servers: generatedDocument.servers }).toEqual(
			generatedDocument,
		);
	});

	describe.each(["MAIN_DOMAIN", "PLATFORM_DOMAIN"] as const)(
		"%s installation targets",
		(setting) => {
			it.each([
				[
					"workforce.example.org",
					"https://workforce.example.org/api/v1/employees",
				],
				[
					"workforce.example.org:8443",
					"https://workforce.example.org:8443/api/v1/employees",
				],
				[
					"http://workforce.example.org:4310/app",
					"http://workforce.example.org:4310/api/v1/employees",
				],
				[
					"https://workforce.example.org:8443",
					"https://workforce.example.org:8443/api/v1/employees",
				],
			])(
				"retains the public scheme and port configured as %s after import",
				async (value, target) => {
					installation.APP_URL = undefined;
					installation[setting] = value;
					const response = await GET(
						new Request("http://localhost:3000/api/v1/openapi.json"),
					);
					const imported = JSON.parse(await response.text());
					expect(
						new URL("/api/v1/employees", imported.servers[0].url).href,
					).toBe(target);
				},
			);
		},
	);

	it("uses the serving origin when no public installation URL is configured", async () => {
		installation.APP_URL = undefined;
		const response = await GET(
			new Request("http://localhost:4310/api/v1/openapi.json"),
		);
		const imported = await response.json();
		expect(new URL("/api/v1/projects", imported.servers[0].url).href).toBe(
			"http://localhost:4310/api/v1/projects",
		);
	});

	it("serves the same public contract regardless of caller credentials or organization data", async () => {
		const anonymous = await GET(
			new Request("http://localhost:3000/api/v1/openapi.json"),
		);
		const authenticated = await GET(
			new Request(
				"http://localhost:3000/api/v1/openapi.json?organizationId=private-org",
				{
					headers: {
						Authorization: "Bearer PRIVATE-API-KEY",
						Cookie: "better-auth.session_token=PRIVATE-SESSION",
						Origin: "https://docs.z8-time.app",
						"x-forwarded-host": "docs.z8-time.app",
					},
				},
			),
		);
		expect(await authenticated.text()).toBe(await anonymous.text());
		expect(authenticated.headers.has("set-cookie")).toBe(false);
		expect(authenticated.headers.get("cache-control")).toBe("no-store");
	});
});
