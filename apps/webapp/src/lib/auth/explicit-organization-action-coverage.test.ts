import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTestText } from "@/test/read-test-text";

const appDir = join(import.meta.dirname, "../../app");

const routeCases = [
	["Slack disconnect", "api/slack/setup/route.ts", "deleteOrgSecret("],
	[
		"Slack OAuth start",
		"api/slack/oauth/authorize/route.ts",
		"db.insert(slackOAuthState)",
	],
	[
		"Slack OAuth callback",
		"api/slack/oauth/callback/route.ts",
		"exchangeOAuthCode(",
	],
	["Discord setup", "api/discord/setup/route.ts", "storeOrgSecret("],
	["Discord disconnect", "api/discord/setup/route.ts", "deleteOrgSecret("],
	["Telegram setup", "api/telegram/setup/route.ts", "storeOrgSecret("],
	["Telegram disconnect", "api/telegram/setup/route.ts", "deleteOrgSecret("],
	["Teams setup", "api/teams/setup/route.ts", "db.insert(teamsTenantConfig)"],
] as const;

describe("explicit-organization privileged API routes", () => {
	it.each(
		routeCases,
	)("guards %s before organization mutation", (_name, path, sideEffect) => {
		const source = readTestText(join(appDir, path), "utf8");
		const mutation = source.indexOf(sideEffect);
		const guard = source.lastIndexOf(
			"requireActiveOrganizationActionActor",
			mutation,
		);

		expect(guard, `${path} guard`).toBeGreaterThanOrEqual(0);
		expect(mutation, `${path} side effect`).toBeGreaterThan(guard);
	});
});
