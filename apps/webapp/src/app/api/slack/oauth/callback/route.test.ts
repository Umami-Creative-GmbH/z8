import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	findState: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));
vi.mock("@/env", () => ({ env: { APP_URL: "https://app.test" } }));
vi.mock("@/db", () => ({
	db: { query: { slackOAuthState: { findFirst: mocks.findState } } },
}));
vi.mock("@/db/schema", () => ({ slackOAuthState: {}, slackWorkspaceConfig: {} }));
vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));
vi.mock("@/lib/auth/organization-action-authorization", () => ({
	runActiveOrganizationActionActorCheck: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/slack/api", () => ({ exchangeOAuthCode: vi.fn() }));
vi.mock("@/lib/vault", () => ({ storeOrgSecret: vi.fn() }));

import { GET } from "./route";

function callback(query: string) {
	return GET(
		new Request(`https://app.test/api/slack/oauth/callback?${query}`) as never,
	);
}

describe("Slack OAuth callback", () => {
	beforeEach(() => {
		mocks.findState.mockReset();
	});

	it("returns a cancelled install to the Slack tab of Chat Integrations", async () => {
		const response = await callback("error=access_denied");
		const location = new URL(response.headers.get("location") ?? "");

		expect(location.pathname).toBe("/settings/notification-channels");
		expect(location.searchParams.get("tab")).toBe("slack");
		expect(location.searchParams.get("slack_error")).toBe("access_denied");
	});

	it("returns an unknown state to the Slack tab with the error", async () => {
		mocks.findState.mockResolvedValue(undefined);
		const response = await callback("code=c&state=s");
		const location = new URL(response.headers.get("location") ?? "");

		expect(location.pathname).toBe("/settings/notification-channels");
		expect(location.searchParams.get("tab")).toBe("slack");
		expect(location.searchParams.get("slack_error")).toBe("invalid_state");
	});
});
