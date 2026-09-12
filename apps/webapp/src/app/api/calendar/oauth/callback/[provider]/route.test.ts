import { createHmac } from "node:crypto";
import { Effect } from "effect";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	context: vi.fn(async () => null),
	exchange: vi.fn(),
	employee: vi.fn(async () => ({ id: "employee", userId: "actor" })),
}));
vi.mock("@/env", () => ({
	env: { BETTER_AUTH_SECRET: "calendar-test-secret" },
}));
vi.mock("@/lib/auth-helpers", () => ({ getVerifiedOrgContext: mocks.context }));
vi.mock("@/lib/app-url", () => ({
	getDefaultAppBaseUrl: () => "https://app.test",
}));
vi.mock("@/lib/calendar-sync/providers", () => ({
	isProviderSupported: () => true,
	getCalendarProvider: () => ({ exchangeCodeForTokens: mocks.exchange }),
}));
vi.mock("@/lib/calendar-sync/token-store", () => ({
	storeCalendarTokens: vi.fn(),
}));
vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mocks.employee },
			calendarConnection: {
				findFirst: async () => {
					throw new Error("Must not query calendar connections");
				},
			},
		},
	},
}));
import { GET } from "./route";

it("rechecks current org SSO access before exchanging tokens from previously signed calendar state", async () => {
	mocks.exchange.mockReturnValue(Effect.succeed({}));
	const payload = JSON.stringify({
		employeeId: "employee",
		organizationId: "locked",
		token: "nonce",
		timestamp: Date.now(),
	});
	const state = Buffer.from(
		JSON.stringify({
			payload,
			signature: createHmac("sha256", "calendar-test-secret")
				.update(payload)
				.digest("hex"),
		}),
	).toString("base64url");
	const response = await GET(
		{
			nextUrl: new URL(
				`https://app.test/api/calendar/oauth/callback/google?code=code&state=${state}`,
			),
		} as never,
		{ params: Promise.resolve({ provider: "google" }) },
	);
	expect(response.headers.get("location")).toContain(
		"Organization%20access%20denied",
	);
	expect(mocks.exchange).not.toHaveBeenCalled();
	expect(mocks.employee).not.toHaveBeenCalled();
});
