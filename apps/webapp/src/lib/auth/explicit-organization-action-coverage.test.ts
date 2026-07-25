import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appDir = join(import.meta.dirname, "../../app");

const actionCases = [
	[
		"invite code create",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"createInviteCode",
		"inviteCodeService.create(",
	],
	[
		"invite code update",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"updateInviteCode",
		"inviteCodeService.update(",
	],
	[
		"invite code delete",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"deleteInviteCode",
		"inviteCodeService.delete(",
	],
	[
		"invite code list",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"listInviteCodes",
		"inviteCodeService.list(",
	],
	[
		"invite code stats",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"getInviteCodeStats",
		"inviteCodeService.getUsageStats(",
	],
	[
		"invite code QR",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"generateInviteQRCode",
		"qrCodeService.generateInviteQR(",
	],
	[
		"invite base URL",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"getInviteBaseUrl",
		"getOrganizationBaseUrl(",
	],
	[
		"pending member list",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"listPendingMembers",
		"pendingMemberService.listPending(",
	],
	[
		"pending member count",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"getPendingMemberCount",
		"pendingMemberService.countPending(",
	],
	[
		"pending member approve",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"approvePendingMember",
		"pendingMemberService.approve(",
	],
	[
		"pending member reject",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"rejectPendingMember",
		"pendingMemberService.reject(",
	],
	[
		"pending member bulk approve",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"bulkApprovePendingMembers",
		"pendingMemberService.bulkApprove(",
	],
	[
		"pending member bulk reject",
		"[locale]/(app)/settings/organizations/invite-code-actions.ts",
		"bulkRejectPendingMembers",
		"pendingMemberService.bulkReject(",
	],
	[
		"API key create",
		"[locale]/(app)/settings/enterprise/api-keys/actions.ts",
		"createApiKey",
		"auth.api.createApiKey(",
		"verifyApiKeyPermission(",
	],
	[
		"API key update",
		"[locale]/(app)/settings/enterprise/api-keys/actions.ts",
		"updateApiKey",
		"auth.api.updateApiKey(",
		"verifyApiKeyPermission(",
	],
	[
		"API key delete",
		"[locale]/(app)/settings/enterprise/api-keys/actions.ts",
		"deleteApiKey",
		"auth.api.deleteApiKey(",
		"verifyApiKeyPermission(",
	],
	[
		"webhook create",
		"[locale]/(app)/settings/webhooks/actions.ts",
		"createWebhook",
		"createWebhookEndpoint(",
	],
	[
		"webhook update",
		"[locale]/(app)/settings/webhooks/actions.ts",
		"updateWebhook",
		"updateWebhookEndpoint(",
	],
	[
		"webhook delete",
		"[locale]/(app)/settings/webhooks/actions.ts",
		"deleteWebhook",
		"deleteWebhookEndpoint(",
	],
	[
		"webhook secret",
		"[locale]/(app)/settings/webhooks/actions.ts",
		"regenerateSecret",
		"regenerateWebhookSecret(",
	],
	[
		"webhook test",
		"[locale]/(app)/settings/webhooks/actions.ts",
		"testWebhook",
		"createDeliveryRecord(",
	],
	[
		"webhook list",
		"[locale]/(app)/settings/webhooks/actions.ts",
		"getWebhooks",
		"getWebhookEndpointsByOrganization(",
	],
	[
		"webhook delivery logs",
		"[locale]/(app)/settings/webhooks/actions.ts",
		"getWebhookDeliveryLogs",
		"getDeliveryLogs(",
	],
	[
		"Clockodo mappings",
		"[locale]/(app)/settings/clockodo-import/actions.ts",
		"saveUserMappings",
		"db\n\t\t\t\t\t.insert(clockodoUserMapping)",
		"requireAdmin(",
	],
	[
		"Clockin credentials",
		"[locale]/(app)/settings/import/clockin-actions.ts",
		"validateClockinCredentials",
		"new ClockinClient(",
		"requireAdmin(",
	],
	[
		"import review scan",
		"[locale]/(app)/settings/import/review-actions.ts",
		"startImportReviewScan",
		"createImportBatch(",
		"requireImportAdmin(",
	],
	[
		"import review decision",
		"[locale]/(app)/settings/import/review-actions.ts",
		"applyImportDecisionAction",
		"applyImportRowDecision(",
		"requireImportAdmin(",
	],
	[
		"import review commit",
		"[locale]/(app)/settings/import/review-actions.ts",
		"startImportCommitAction",
		"createCommitJobsForAcceptedRows(",
		"requireImportAdmin(",
	],
	[
		"Telegram setup",
		"[locale]/(app)/settings/telegram/actions.ts",
		"setupTelegramBot",
		"storeOrgSecret(",
		"requireAdmin(",
	],
	[
		"Telegram settings",
		"[locale]/(app)/settings/telegram/actions.ts",
		"updateTelegramSettings",
		".update(telegramBotConfig)",
		"requireAdmin(",
	],
	[
		"Telegram disconnect",
		"[locale]/(app)/settings/telegram/actions.ts",
		"disconnectTelegramBot",
		"deleteOrgSecret(",
		"requireAdmin(",
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
			readFileSync(join(appDir, path), "utf8"),
			action,
		);
		const guard = section.indexOf(guardCall);
		const mutation = section.indexOf(sideEffect);

		expect(guard, `${action} guard`).toBeGreaterThanOrEqual(0);
		expect(mutation, `${action} side effect`).toBeGreaterThan(guard);
	});

	it.each([
		["Clockodo", "[locale]/(app)/settings/clockodo-import/actions.ts"],
		["Clockin", "[locale]/(app)/settings/import/clockin-actions.ts"],
		["import review", "[locale]/(app)/settings/import/review-actions.ts"],
		["Telegram", "[locale]/(app)/settings/telegram/actions.ts"],
	] as const)("uses the lifecycle-aware actor check in the shared %s gate", (_name, path) => {
		const source = readFileSync(join(appDir, path), "utf8");
		expect(source).toContain("runActiveOrganizationActionActorCheck({");
	});

	it.each([
		[
			"updateInviteCode",
			/inviteCodeService\.update\(\s*inviteCodeId,\s*organizationId,/,
		],
		[
			"deleteInviteCode",
			/inviteCodeService\.delete\(\s*inviteCodeId,\s*organizationId,\s*session\.user\.id/,
		],
		[
			"getInviteCodeStats",
			/inviteCodeService\.getUsageStats\(\s*inviteCodeId,\s*organizationId/,
		],
		[
			"generateInviteQRCode",
			/inviteCodeService\.getById\(\s*inviteCodeId,\s*organizationId/,
		],
	] as const)("passes organization scope through %s", (action, scopedCall) => {
		const source = readFileSync(
			join(
				appDir,
				"[locale]/(app)/settings/organizations/invite-code-actions.ts",
			),
			"utf8",
		);
		expect(actionSection(source, action)).toMatch(scopedCall);
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
		const source = readFileSync(join(appDir, path), "utf8");
		const mutation = source.indexOf(sideEffect);
		const guard = source.lastIndexOf(
			"requireActiveOrganizationActionActor",
			mutation,
		);

		expect(guard, `${path} guard`).toBeGreaterThanOrEqual(0);
		expect(mutation, `${path} side effect`).toBeGreaterThan(guard);
	});
});
