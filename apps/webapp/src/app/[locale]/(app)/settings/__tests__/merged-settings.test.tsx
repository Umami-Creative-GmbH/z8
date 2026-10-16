import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	access: vi.fn(),
	email: vi.fn(),
	secretStatus: vi.fn(),
	templates: vi.fn(),
	keys: vi.fn(),
	webhooks: vi.fn(),
	auditConfig: vi.fn(),
	packages: vi.fn(),
	identity: vi.fn(),
	domains: vi.fn(),
	branding: vi.fn(),
	providers: vi.fn(),
	social: vi.fn(),
	slack: vi.fn(),
	teams: vi.fn(),
	discord: vi.fn(),
	tracking: vi.fn(),
	autoClockOut: vi.fn(),
	reminders: vi.fn(),
	submissions: vi.fn(),
	organization: vi.fn(),
	redirect: vi.fn((url: string) => {
		throw new Error(`redirect:${url}`);
	}),
}));
vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mocks.access,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirect,
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/db", () => ({
	db: {
		query: { organization: { findFirst: mocks.organization } },
		select: () => ({
			from: () => ({
				where: () => ({ limit: async () => [{ role: "admin" }] }),
			}),
		}),
	},
}));
vi.mock("@/lib/auth-domain-config", () => ({
	getOrganizationPlatformOrigins: () => ["https://org-1.example.com"],
}));
vi.mock("../enterprise/email/actions", () => ({
	getEmailConfig: mocks.email,
	getSecretStoreConnectionStatus: mocks.secretStatus,
}));
vi.mock("../email-templates/actions", () => ({
	listEmailTemplates: mocks.templates,
}));
vi.mock("../enterprise/api-keys/actions", () => ({ listApiKeys: mocks.keys }));
vi.mock("@/lib/webhooks", () => ({
	getWebhookEndpointsByOrganization: mocks.webhooks,
}));
vi.mock("../audit-export/actions", () => ({
	getAuditConfigAction: mocks.auditConfig,
	getAuditPackagesAction: mocks.packages,
}));
vi.mock("../enterprise/actions", () => ({
	getEnterpriseIdentitySetupAction: mocks.identity,
	listDomainsAction: mocks.domains,
	getBrandingAction: mocks.branding,
	listSSOProvidersAction: mocks.providers,
	listSocialOAuthConfigsAction: mocks.social,
}));
vi.mock("../notification-channels/actions", () => ({
	getSlackNotificationChannelConfig: mocks.slack,
	getTeamsNotificationChannelConfig: mocks.teams,
	getDiscordNotificationChannelConfig: mocks.discord,
	updateSlackNotificationChannelSettings: vi.fn(),
	updateTeamsNotificationChannelSettings: vi.fn(),
	updateDiscordNotificationChannelSettings: vi.fn(),
}));
vi.mock("../notification-channels/telegram-panel", () => ({
	TelegramPanel: () => null,
}));
vi.mock("@/lib/organization/tracking-settings", () => ({
	loadOrganizationTrackingSettings: mocks.tracking,
}));
vi.mock("@/lib/time-tracking/automatic-clock-out/settings", () => ({
	loadAutoClockOutSettings: mocks.autoClockOut,
}));
vi.mock("@/lib/time-tracking/clocking-reminders/settings", () => ({
	loadClockingReminderSettings: mocks.reminders,
}));
vi.mock("@/lib/time-tracking/period-submissions/settings", () => ({
	loadPeriodSubmissionSettings: mocks.submissions,
}));
vi.mock("@/components/settings/settings-tabbed-page", () => ({
	SettingsTabbedPage: () => null,
}));
vi.mock(
	"@/components/settings/email-templates/email-template-settings-client",
	() => ({ EmailTemplateSettingsClient: () => null }),
);
vi.mock("@/components/settings/enterprise/email-config-form", () => ({
	EmailConfigForm: () => null,
}));
vi.mock("@/components/settings/notification-channel-settings", () => ({
	NotificationChannelSettings: () => null,
}));
vi.mock("@/components/enterprise/api-key-page-client", () => ({
	ApiKeyPageClient: () => null,
}));
vi.mock("@/components/webhooks/webhooks-page-client", () => ({
	WebhooksPageClient: () => null,
}));
vi.mock("@/components/settings/audit-log-viewer", () => ({
	AuditLogViewer: () => null,
}));
vi.mock("@/components/settings/audit-export/audit-config-form", () => ({
	AuditConfigForm: () => null,
}));
vi.mock("@/components/settings/audit-export/audit-pack-generator-card", () => ({
	AuditPackGeneratorCard: () => null,
}));
vi.mock("@/components/settings/audit-export/audit-packages-table", () => ({
	AuditPackagesTable: () => null,
}));
vi.mock("@/components/settings/audit-export/key-management", () => ({
	KeyManagement: () => null,
}));
vi.mock("@/components/settings/enterprise/identity-setup-wizard", () => ({
	IdentitySetupWizard: () => null,
}));
vi.mock("@/components/settings/enterprise/sso-provider-management", () => ({
	SSOProviderManagement: () => null,
}));
vi.mock("@/components/settings/enterprise/social-oauth-management", () => ({
	SocialOAuthManagement: () => null,
}));
vi.mock("@/components/organization/organization-auto-clock-out-card", () => ({
	OrganizationAutoClockOutCard: () => null,
}));
vi.mock(
	"@/components/organization/organization-clocking-reminders-card",
	() => ({ OrganizationClockingRemindersCard: () => null }),
);
vi.mock(
	"@/components/organization/organization-period-submissions-card",
	() => ({ OrganizationPeriodSubmissionsCard: () => null }),
);
vi.mock("@/components/organization/organization-tracking-card", () => ({
	OrganizationTrackingCard: () => null,
}));

import AuditPage from "../audit-export/page";
import LegacyAuditPage from "../audit-log/page";
import ClockingPage from "../clocking/page";
import LegacyDiscordPage from "../discord/page";
import LegacyEmailPage from "../email-templates/page";
import DeveloperPage from "../enterprise/api-keys/page";
import LegacyEnterpriseAuditPage from "../enterprise/audit-log/page";
import LegacyBrandingPage from "../enterprise/branding/page";

vi.mock("@/components/settings/enterprise/domains-branding-tabs", () => ({
	DomainsAndBrandingTabs: () => null,
}));

import DomainsPage from "../enterprise/domains/page";
import EmailPage from "../enterprise/email/page";
import IdentityPage from "../enterprise/identity-setup/page";
import LegacySSOPage from "../enterprise/sso/page";
import ChatPage from "../notification-channels/page";
import LegacySlackPage from "../slack/page";
import LegacyTeamsPage from "../teams-notifications/page";
import LegacyTelegramPage from "../telegram/page";
import LegacyWebhooksPage from "../webhooks/page";

const mergedPages = [
	EmailPage,
	DeveloperPage,
	AuditPage,
	IdentityPage,
	ChatPage,
	ClockingPage,
];
async function content(page: (typeof mergedPages)[number]) {
	return page().props.children.type();
}
const tabs = (page: Awaited<ReturnType<typeof content>>) =>
	page.props.tabs.map((tab: { value: string }) => tab.value);
beforeEach(() => {
	vi.clearAllMocks();
	mocks.access.mockResolvedValue({
		organizationId: "org-1",
		authContext: { user: { id: "user-1" } },
	});
	mocks.email.mockResolvedValue(null);
	mocks.secretStatus.mockResolvedValue({ connected: false });
	mocks.templates.mockResolvedValue([{ key: "invite", override: null }]);
	mocks.keys.mockResolvedValue({ success: true, data: [{ id: "key-1" }] });
	mocks.webhooks.mockResolvedValue([{ id: "webhook-1" }]);
	mocks.auditConfig.mockResolvedValue({
		success: true,
		data: { signingKeyFingerprint: "fingerprint", signingKeyVersion: 2 },
	});
	mocks.packages.mockResolvedValue({ success: true, data: [] });
	mocks.identity.mockResolvedValue({ step: "provider" });
	mocks.providers.mockResolvedValue([]);
	mocks.domains.mockResolvedValue([]);
	mocks.branding.mockResolvedValue({ appName: "Z8" });
	mocks.social.mockResolvedValue([]);
	for (const loader of [mocks.slack, mocks.teams, mocks.discord])
		loader.mockResolvedValue({ success: true, data: null });
	mocks.organization.mockResolvedValue({
		id: "org-1",
		slug: "org-1",
		timezone: "Europe/Berlin",
		createdAt: new Date("2026-01-01T00:00:00Z"),
	});
	for (const loader of [
		mocks.tracking,
		mocks.autoClockOut,
		mocks.reminders,
		mocks.submissions,
	])
		loader.mockResolvedValue({});
});
describe("merged organization settings", () => {
	it.each(mergedPages)(
		"guards the merged page before returning organization controls",
		async (page) => {
			mocks.access.mockRejectedValue(new Error("denied"));
			await expect(content(page)).rejects.toThrow("denied");
			for (const loader of [
				mocks.email,
				mocks.templates,
				mocks.keys,
				mocks.webhooks,
				mocks.providers,
				mocks.social,
				mocks.tracking,
				mocks.autoClockOut,
				mocks.reminders,
				mocks.submissions,
				mocks.slack,
				mocks.teams,
				mocks.discord,
			])
				expect(loader).not.toHaveBeenCalled();
		},
	);
	it("combines email delivery and templates while keeping the active organization scope", async () => {
		const page = await content(EmailPage);
		expect(page.key).toBe("org-1");
		expect(tabs(page)).toEqual(["delivery", "templates"]);
		expect(mocks.email).toHaveBeenCalledWith("org-1");
		expect(mocks.secretStatus).toHaveBeenCalledWith("org-1");
		expect(page.props.tabs[1].panel.props.templates).toEqual([
			{ definition: { key: "invite" }, override: null },
		]);
	});
	it("combines API keys and webhooks with their original organization and user props", async () => {
		const page = await content(DeveloperPage);
		expect(tabs(page)).toEqual(["keys", "webhooks"]);
		expect(mocks.keys).toHaveBeenCalledWith("org-1");
		expect(mocks.webhooks).toHaveBeenCalledWith("org-1");
		expect(page.props.tabs[0].panel.props).toMatchObject({
			organizationId: "org-1",
			currentUserId: "user-1",
		});
	});
	it("exposes audit activity, configuration, packages and keys at one level", async () => {
		const page = await content(AuditPage);
		expect(tabs(page)).toEqual(["activity", "config", "packages", "keys"]);
		expect(page.props.tabs[0].panel.props).toMatchObject({
			organizationId: "org-1",
			organizationTimezone: "Europe/Berlin",
		});
		expect(mocks.auditConfig).toHaveBeenCalledWith("org-1");
		expect(mocks.packages).toHaveBeenCalledWith("org-1");
	});
	it("keeps signing keys unavailable until audit configuration exists", async () => {
		mocks.auditConfig.mockResolvedValue({ success: true, data: null });
		expect(tabs(await content(AuditPage))).toEqual([
			"activity",
			"config",
			"packages",
		]);
	});
	it("puts guided identity setup, SSO and social login together using the organization callback origin", async () => {
		const page = await content(IdentityPage);
		expect(tabs(page)).toEqual(["setup", "sso", "social-oauth"]);
		expect(page.props.tabs[1].panel.props.callbackBaseUrl).toBe(
			"https://org-1.example.com",
		);
		expect(page.props.tabs[2].panel.props.callbackBaseUrl).toBe(
			"https://org-1.example.com",
		);
	});
	it("combines the four chat services", async () => {
		const page = await content(ChatPage);
		expect(tabs(page)).toEqual(["slack", "teams", "telegram", "discord"]);
		expect(page.key).toBe("org-1");
	});
	it("loads moved clocking settings for the active organization", async () => {
		const page = await content(ClockingPage);
		expect(tabs(page)).toEqual([
			"tracking",
			"automatic-clock-out",
			"reminders",
			"submissions",
		]);
		for (const loader of [mocks.tracking, mocks.autoClockOut, mocks.reminders])
			expect(loader).toHaveBeenCalledWith(expect.anything(), "org-1");
		expect(mocks.submissions).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({ clock: expect.anything() }),
		);
		expect(page.props.tabs[1].panel.props).toMatchObject({
			organizationId: "org-1",
			currentMemberRole: "admin",
		});
	});
	it.each([
		[LegacyEmailPage, "/settings/enterprise/email?tab=templates"],
		[LegacyTelegramPage, "/settings/notification-channels?tab=telegram"],
		[LegacyWebhooksPage, "/settings/enterprise/api-keys?tab=webhooks"],
		[LegacyAuditPage, "/settings/audit-export?tab=activity"],
		[LegacyEnterpriseAuditPage, "/settings/audit-export?tab=activity"],
		[LegacySlackPage, "/settings/notification-channels?tab=slack"],
		[LegacyTeamsPage, "/settings/notification-channels?tab=teams"],
		[LegacyDiscordPage, "/settings/notification-channels?tab=discord"],
		[LegacySSOPage, "/settings/enterprise/identity-setup?tab=sso"],
		[LegacyBrandingPage, "/settings/enterprise/domains?tab=branding"],
	])("preserves a guarded legacy route", async (page, target) => {
		const render = () => {
			const result = page();
			return result instanceof Promise ? result : result.props.children.type();
		};
		await expect(render()).rejects.toThrow(`redirect:${target}`);
		mocks.access.mockRejectedValue(new Error("denied"));
		await expect(render()).rejects.toThrow("denied");
	});
	it.each(["sso", "social-oauth"])(
		"redirects a legacy identity tab on the domains URL",
		async (tab) => {
			await expect(
				DomainsPage({
					searchParams: Promise.resolve({ tab }),
				}).props.children.type({ searchParams: Promise.resolve({ tab }) }),
			).rejects.toThrow(
				`redirect:/settings/enterprise/identity-setup?tab=${tab}`,
			);
			expect(mocks.domains).not.toHaveBeenCalled();
			expect(mocks.providers).not.toHaveBeenCalled();
		},
	);
	it("keeps domain and branding data separate from identity-provider loaders", async () => {
		const props = { searchParams: Promise.resolve({ tab: "branding" }) };
		const page = await DomainsPage(props).props.children.type(props);
		expect(page.props).toMatchObject({
			initialDomains: [],
			initialBranding: { appName: "Z8" },
			organizationId: "org-1",
			defaultUrls: { canonical: "https://org-1.example.com" },
		});
		expect(mocks.providers).not.toHaveBeenCalled();
		expect(mocks.social).not.toHaveBeenCalled();
	});
});
