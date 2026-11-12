import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readTestText } from "@/test/read-test-text";

const appDir = join(import.meta.dirname, "../../app");

const actionCases = [
	[
		"API key create",
		"[locale]/(app)/settings/enterprise/api-keys/actions.ts",
		"createApiKey",
		"createOrganizationApiKey(",
		"verifyApiKeyPermission(",
	],
	[
		"API key update",
		"[locale]/(app)/settings/enterprise/api-keys/actions.ts",
		"updateApiKey",
		"updateOrganizationApiKey(",
		"verifyApiKeyPermission(",
	],
	[
		"API key delete",
		"[locale]/(app)/settings/enterprise/api-keys/actions.ts",
		"deleteApiKey",
		"revokeOrganizationApiKey(",
		"verifyApiKeyPermission(",
	],
] as const;

function actionSection(source: string, action: string) {
	const start = source.indexOf(`export async function ${action}`);
	const next = source.indexOf("export async function ", start + 1);
	return source.slice(start, next === -1 ? undefined : next);
}

describe("explicit-organization privileged server actions", () => {
	it.each(
		actionCases,
	)("guards %s before its first side effect", (_name, path, action, sideEffect, guardCall = "requireActiveOrganizationActionActor") => {
		const section = actionSection(
			readTestText(join(appDir, path), "utf8"),
			action,
		);
		const guard = section.indexOf(guardCall);
		const mutation = section.indexOf(sideEffect);

		expect(guard, `${action} guard`).toBeGreaterThanOrEqual(0);
		expect(mutation, `${action} side effect`).toBeGreaterThan(guard);
	});
});

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
