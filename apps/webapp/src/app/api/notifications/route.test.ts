import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
	signedIn: true,
	mfaRequired: false,
	ssoRequired: false,
}));

vi.mock("next/headers", async () =>
	(await import("@/test/integration-harness")).nextHeaders(),
);
vi.mock("next/server", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextServer(importOriginal),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				authState.signedIn
					? {
							user: { id: "user-current" },
							session: { activeOrganizationId: "org-current" },
							mfaRequired: authState.mfaRequired,
							ssoRequired: authState.ssoRequired,
						}
					: null,
		},
	},
}));

const routes = await import("./route");
const count = await import("./count/route");

beforeEach(() => {
	authState.signedIn = true;
	authState.mfaRequired = false;
	authState.ssoRequired = false;
});

describe.each([
	["user-previous", "org-current"],
	["user-current", "org-previous"],
])("notification request expectation %s/%s", (userId, organizationId) => {
	it.each(["GET", "PATCH", "DELETE", "COUNT"] as const)(
		"rejects a %s request from the previous identity before database access",
		async (method) => {
			const request = new NextRequest("https://z8.test/api/notifications", {
				method: method === "COUNT" ? "GET" : method,
				headers: {
					"x-z8-notification-user": userId,
					"x-z8-notification-organization": organizationId,
					"Content-Type": "application/json",
				},
				...(method === "PATCH" || method === "DELETE"
					? { body: JSON.stringify({ markAllRead: true, deleteAll: true }) }
					: {}),
			});
			const response =
				method === "COUNT"
					? await count.GET(request)
					: await routes[method](request);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: "Your account or organization changed. Refresh and try again.",
			});
		},
	);
});

describe("notification request authorization", () => {
	it.each(["GET", "PATCH", "DELETE", "COUNT"] as const)(
		"requires a fresh session for %s even when expectation headers match",
		async (method) => {
			authState.signedIn = false;
			const request = new NextRequest("https://z8.test/api/notifications", {
				method: method === "COUNT" ? "GET" : method,
				headers: {
					"x-z8-notification-user": "user-current",
					"x-z8-notification-organization": "org-current",
				},
			});
			const response =
				method === "COUNT"
					? await count.GET(request)
					: await routes[method](request);
			expect(response.status).toBe(401);
		},
	);
});

describe.each(["mfaRequired", "ssoRequired"] as const)(
	"notification authorization while %s",
	(requirement) => {
		it.each(["GET", "PATCH", "DELETE", "COUNT"] as const)(
			"denies %s before database access",
			async (method) => {
				authState[requirement] = true;
				const request = new NextRequest("https://z8.test/api/notifications", {
					method: method === "COUNT" ? "GET" : method,
					headers: {
						"x-z8-notification-user": "user-current",
						"x-z8-notification-organization": "org-current",
					},
				});
				const response =
					method === "COUNT"
						? await count.GET(request)
						: await routes[method](request);
				expect(response.status).toBe(401);
			},
		);
	},
);
