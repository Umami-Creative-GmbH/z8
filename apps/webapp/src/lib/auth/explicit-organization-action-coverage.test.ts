import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTestText } from "@/test/read-test-text";

const appDir = join(import.meta.dirname, "../../app");

const routeCases = [
	["Slack disconnect", "api/slack/setup/route.ts", "disconnectLegacySlackInstallation("],
	["Telegram setup", "api/telegram/setup/route.ts", "storeOrgSecret("],
	["Telegram disconnect", "api/telegram/setup/route.ts", "disconnectLegacyTelegramInstallation("],
	["Teams disconnect", "api/teams/setup/route.ts", "disconnectLegacyTeamsTenantInstallation("],
] as const;

const retiredRouteCases = [
	["Slack OAuth start", "api/slack/oauth/authorize/route.ts"],
	["Slack OAuth callback", "api/slack/oauth/callback/route.ts"],
] as const;

describe("explicit-organization privileged API routes", () => {
	it.each(routeCases)("guards %s before organization mutation", (_name, path, sideEffect) => {
		const source = readTestText(join(appDir, path), "utf8");
		const mutation = source.indexOf(sideEffect);
		const guard = source.lastIndexOf("requireActiveOrganizationActionActor", mutation);

		expect(guard, `${path} guard`).toBeGreaterThanOrEqual(0);
		expect(mutation, `${path} side effect`).toBeGreaterThan(guard);
	});

	it.each(retiredRouteCases)("keeps retired %s free of organization mutations", (_name, path) => {
		const source = readTestText(join(appDir, path), "utf8");

		expect(source).toContain("status: 410");
		expect(source).not.toContain("db.insert(");
		expect(source).not.toContain("db.update(");
		expect(source).not.toContain("exchangeOAuthCode(");
	});
});
