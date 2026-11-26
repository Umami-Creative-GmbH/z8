import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));
vi.mock("@/env", () => ({ env: { APP_URL: "https://app.test" } }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import { GET } from "./route";

function callback(query: string) {
	return GET(new Request(`https://app.test/api/slack/oauth/callback?${query}`) as never);
}

describe("Slack OAuth callback", () => {
	it("returns a cancelled install to the Slack tab of Chat Integrations", async () => {
		const response = await callback("error=access_denied");
		const location = new URL(response.headers.get("location") ?? "");

		expect(location.pathname).toBe("/settings/notification-channels");
		expect(location.searchParams.get("tab")).toBe("slack");
		expect(location.searchParams.get("slack_error")).toBe("access_denied");
	});

	it("returns 410 Gone for retired deployment OAuth code/state callbacks", async () => {
		const response = await callback("code=c&state=s");
		expect(response.status).toBe(410);
		await expect(response.json()).resolves.toMatchObject({
			code: "legacy_slack_oauth_retired",
		});
	});
});
