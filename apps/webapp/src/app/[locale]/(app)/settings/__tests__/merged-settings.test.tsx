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
	organizationBaseUrl: vi.fn(),
	domains: vi.fn(),
	branding: vi.fn(),
	platformAuthConfig: vi.fn(),
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
	datev: vi.fn(),
	lexware: vi.fn(),
	sage: vi.fn(),
	personio: vi.fn(),
	successfactors: vi.fn(),
	workday: vi.fn(),
	payrollHistory: vi.fn(),
	payrollIdentifierFields: vi.fn(),
	organizationTimezone: vi.fn(),
	vehicles: vi.fn(),
	vehicleUse: vi.fn(),
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
vi.mock("@/lib/app-url", () => ({ getOrganizationBaseUrl: mocks.organizationBaseUrl }));
vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: mocks.organizationTimezone,
}));
vi.mock("../enterprise/email/actions", () => ({
	getEmailConfig: mocks.email,
	getSecretStoreConnectionStatus: mocks.secretStatus,
}));
vi.mock("../enterprise/email/template-actions", () => ({
	listEmailTemplates: mocks.templates,
}));
vi.mock("../enterprise/api-keys/actions", () => ({ listApiKeys: mocks.keys }));
vi.mock("@/lib/webhooks", () => ({
	getWebhookEndpointsByOrganization: mocks.webhooks,
}));
vi.mock("@/lib/webhooks/webhook-service", () => ({
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
	getPlatformAuthConfigAction: mocks.platformAuthConfig,
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
	connectDiscordBot: vi.fn(),
	disconnectDiscordBot: vi.fn(),
}));
vi.mock("../notification-channels/telegram-panel", () => ({
	TelegramPanel: () => null,
}));
vi.mock("../payroll-export/actions", () => ({
	getDatevConfigAction: mocks.datev,
	getLexwareConfigAction: mocks.lexware,
	getSageConfigAction: mocks.sage,
	getPersonioConfigAction: mocks.personio,
	getSuccessFactorsConfigAction: mocks.successfactors,
	getWorkdayConfigAction: mocks.workday,
	getExportHistoryAction: mocks.payrollHistory,
	getPayrollIdentifierFieldsAction: mocks.payrollIdentifierFields,
}));
vi.mock("../vehicles/actions", () => ({
	getVehicleSettings: mocks.vehicles,
}));
vi.mock("../vehicles/vehicle-use-actions", () => ({
	getVehicleUseAdminDataAction: mocks.vehicleUse,
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
vi.mock("@/components/settings/email-templates/email-template-settings-client", () => ({
	EmailTemplateSettingsClient: () => null,
}));
vi.mock("@/components/settings/enterprise/email-config-form", () => ({
	EmailConfigForm: () => null,
}));
vi.mock("@/components/settings/notification-channel-settings", () => ({
	NotificationChannelSettings: () => null,
}));
vi.mock("@/components/settings/discord-channel-settings", () => ({
	DiscordChannelSettings: () => null,
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
vi.mock("@/components/organization/organization-clocking-reminders-card", () => ({
	OrganizationClockingRemindersCard: () => null,
}));
vi.mock("@/components/organization/organization-period-submissions-card", () => ({
	OrganizationPeriodSubmissionsCard: () => null,
}));
vi.mock("@/components/organization/organization-tracking-card", () => ({
	OrganizationTrackingCard: () => null,
}));
vi.mock("@/components/settings/custom-roles/custom-roles-management", () => ({
	CustomRolesManagement: () => null,
}));
vi.mock("@/components/settings/custom-roles/team-permissions-tab", () => ({
	TeamPermissionsTab: () => null,
}));
vi.mock("@/components/settings/payroll-export/export-form", () => ({
	ExportForm: () => null,
}));
vi.mock("@/components/settings/payroll-export/datev-config-form", () => ({
	DatevConfigForm: () => null,
}));
vi.mock("@/components/settings/payroll-export/lexware-config-form", () => ({
	LexwareConfigForm: () => null,
}));
vi.mock("@/components/settings/payroll-export/sage-config-form", () => ({
	SageConfigForm: () => null,
}));
vi.mock("@/components/settings/payroll-export/personio-config-form", () => ({
	PersonioConfigForm: () => null,
}));
vi.mock("@/components/settings/payroll-export/successfactors-config-form", () => ({
	SuccessFactorsConfigForm: () => null,
}));
vi.mock("@/components/settings/payroll-export/workday-config-form", () => ({
	WorkdayConfigForm: () => null,
}));
vi.mock("@/components/settings/payroll-export/wage-type-mappings", () => ({
	WageTypeMappings: () => null,
}));
vi.mock("@/components/settings/payroll-export/expense-wage-type-mappings", () => ({
	ExpenseWageTypeMappings: () => null,
}));
vi.mock("@/components/settings/payroll-export/export-history", () => ({
	ExportHistory: () => null,
}));
vi.mock("@/components/settings/vehicles/vehicle-settings", () => ({
	VehicleSettings: () => null,
}));
vi.mock("@/components/settings/vehicle-use/vehicle-use-settings", () => ({
	VehicleUseSwitch: () => null,
	VehicleUseAssignments: () => null,
}));
vi.mock("@/components/settings/travel-expense/travel-expense-settings-tabs", () => ({
	TravelExpenseSettingsTabs: () => null,
}));
vi.mock("@/components/settings/travel-expense/allowance-overrides-settings", () => ({
	AllowanceOverridesSettingsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/expense-officer-settings", () => ({
	ExpenseOfficerSettingsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/foreign-expense-conversions", () => ({
	ForeignExpenseConversionsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/mileage-policy-settings", () => ({
	MileagePolicySettingsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/per-diem-policy-settings", () => ({
	PerDiemPolicySettingsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/reference-rate-settings", () => ({
	ReferenceRateSettingsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/reimbursement-channel-settings", () => ({
	ReimbursementChannelSettingsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/reimbursement-currency-settings", () => ({
	ReimbursementCurrencySettingsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/travel-expense-approver-settings", () => ({
	TravelExpenseApproverSettingsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/travel-expense-policy-management", () => ({
	TravelExpensePolicyManagement: () => null,
}));
vi.mock("@/components/settings/travel-expense/travel-expense-project-exceptions", () => ({
	TravelExpenseProjectExceptionsCard: () => null,
}));
vi.mock("@/components/settings/travel-expense/travel-expense-receipt-exception-settings", () => ({
	TravelExpenseReceiptExceptionSettingsCard: () => null,
}));
vi.mock("@/components/travel-expenses/finance/officer-coverage-gap", () => ({
	OfficerCoverageGapNotice: () => null,
}));

import AuditPage from "../audit-export/page";
import ClockingPage from "../clocking/page";
import DeveloperPage from "../enterprise/api-keys/page";

vi.mock("@/components/settings/enterprise/domains-branding-tabs", () => ({
	DomainsAndBrandingTabs: () => null,
}));

import DomainsPage from "../enterprise/domains/page";
import EmailPage from "../enterprise/email/page";
import IdentityPage from "../enterprise/identity-setup/page";
import ChatPage from "../notification-channels/page";
import PayrollExportPage from "../payroll-export/page";
import RolesPage from "../roles/page";
import TravelExpensesPage from "../travel-expenses/page";
import VehiclesPage from "../vehicles/page";

const mergedPages = [
	EmailPage,
	DeveloperPage,
	AuditPage,
	IdentityPage,
	ChatPage,
	ClockingPage,
	RolesPage,
	PayrollExportPage,
	TravelExpensesPage,
	VehiclesPage,
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
		settingsAccess: "orgAdmin",
	});
	mocks.email.mockResolvedValue({ success: true, data: null });
	mocks.secretStatus.mockResolvedValue({ success: true, data: { connected: false } });
	mocks.templates.mockResolvedValue({ success: true, data: [{ key: "invite", override: null }] });
	mocks.keys.mockResolvedValue({ success: true, data: [{ id: "key-1" }] });
	mocks.webhooks.mockResolvedValue([{ id: "webhook-1" }]);
	mocks.auditConfig.mockResolvedValue({
		success: true,
		data: { signingKeyFingerprint: "fingerprint", signingKeyVersion: 2 },
	});
	mocks.packages.mockResolvedValue({ success: true, data: [] });
	mocks.identity.mockResolvedValue({ success: true, data: { step: "provider" } });
	mocks.organizationBaseUrl.mockResolvedValue("https://work.customer.test");
	mocks.providers.mockResolvedValue({ success: true, data: [] });
	mocks.domains.mockResolvedValue({ success: true, data: [] });
	mocks.branding.mockResolvedValue({ success: true, data: { appName: "Z8" } });
	mocks.platformAuthConfig.mockResolvedValue({ success: true, data: null });
	mocks.social.mockResolvedValue({ success: true, data: [] });
	for (const loader of [mocks.slack, mocks.teams, mocks.discord])
		loader.mockResolvedValue({ success: true, data: null });
	mocks.organization.mockResolvedValue({
		id: "org-1",
		slug: "org-1",
		timezone: "Europe/Berlin",
		createdAt: new Date("2026-01-01T00:00:00Z"),
	});
	for (const loader of [mocks.tracking, mocks.autoClockOut, mocks.reminders, mocks.submissions])
		loader.mockResolvedValue({});
	for (const loader of [
		mocks.datev,
		mocks.lexware,
		mocks.sage,
		mocks.personio,
		mocks.successfactors,
		mocks.workday,
	])
		loader.mockResolvedValue({ success: true, data: null });
	mocks.payrollHistory.mockResolvedValue({ success: true, data: [] });
	mocks.payrollIdentifierFields.mockResolvedValue({ success: true, data: [] });
	mocks.organizationTimezone.mockResolvedValue("Europe/Berlin");
	mocks.vehicles.mockResolvedValue({
		success: true,
		data: { vehicles: [], employees: [], teams: [] },
	});
	mocks.vehicleUse.mockResolvedValue({
		success: true,
		data: {
			settings: { enabled: true },
			assignments: [],
			employees: [],
			teams: [],
		},
	});
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
				mocks.datev,
				mocks.lexware,
				mocks.sage,
				mocks.personio,
				mocks.successfactors,
				mocks.workday,
				mocks.payrollHistory,
				mocks.payrollIdentifierFields,
				mocks.vehicles,
				mocks.vehicleUse,
			])
				expect(loader).not.toHaveBeenCalled();
		},
	);
	it("combines email delivery and templates while keeping the active organization scope", async () => {
		const page = await content(EmailPage);
		expect(page.key).toBe("org-1");
		expect(tabs(page)).toEqual(["delivery", "templates"]);
		expect(mocks.email).toHaveBeenCalledWith();
		expect(mocks.secretStatus).toHaveBeenCalledWith();
		expect(page.props.tabs[1].panel.props.templates).toEqual([
			{ definition: { key: "invite" }, override: null },
		]);
	});
	it("combines API keys and webhooks with their original organization and user props", async () => {
		// The keys and webhooks tabs are assembled client-side by DeveloperAccessClient
		// (enterprise/api-keys/page-client.tsx); the server page supplies their data.
		const page = await content(DeveloperPage);
		expect(mocks.keys).toHaveBeenCalledWith();
		expect(mocks.webhooks).toHaveBeenCalledWith("org-1");
		expect(page.props).toMatchObject({
			organizationId: "org-1",
			currentUserId: "user-1",
			settingsAccess: "orgAdmin",
			initialApiKeys: [{ id: "key-1" }],
			initialKeysError: false,
			initialWebhooks: [{ id: "webhook-1" }],
			initialWebhooksError: false,
		});
	});
	it("exposes audit activity, configuration, packages and keys at one level", async () => {
		const page = await content(AuditPage);
		expect(tabs(page)).toEqual(["activity", "config", "packages", "keys"]);
		expect(page.props.tabs[0].panel.props).toMatchObject({
			organizationId: "org-1",
			organizationTimezone: "Europe/Berlin",
		});
		expect(mocks.auditConfig).toHaveBeenCalledWith();
		expect(mocks.packages).toHaveBeenCalledWith({});
	});
	it("keeps signing keys unavailable until audit configuration exists", async () => {
		mocks.auditConfig.mockResolvedValue({ success: true, data: null });
		expect(tabs(await content(AuditPage))).toEqual(["activity", "config", "packages"]);
	});
	it("puts guided identity setup, SSO and social login together using the organization callback origin", async () => {
		const page = await content(IdentityPage);
		expect(tabs(page)).toEqual(["local-mfa", "setup", "sso", "social-oauth"]);
		expect(mocks.organizationBaseUrl).toHaveBeenCalledWith("org-1");
		for (const tab of page.props.tabs.slice(1)) {
			expect(tab.panel.props.callbackBaseUrl).toBe("https://work.customer.test");
		}
	});
	it("combines the four chat services", async () => {
		const page = await content(ChatPage);
		expect(tabs(page)).toEqual(["slack", "teams", "telegram", "discord"]);
		expect(page.key).toBe("org-1");
	});
	it("loads moved clocking settings for the active organization", async () => {
		const page = await content(ClockingPage);
		expect(tabs(page)).toEqual(["tracking", "automatic-clock-out", "reminders", "submissions"]);
		for (const loader of [mocks.tracking, mocks.autoClockOut, mocks.reminders])
			expect(loader).toHaveBeenCalledWith(expect.anything(), "org-1");
		expect(mocks.submissions).toHaveBeenCalledWith(
			expect.anything(),
			"org-1",
			expect.objectContaining({ clock: expect.anything() }),
		);
		expect(page.props.tabs[1].panel.props).toMatchObject({
			settingsAccess: "orgAdmin",
		});
	});
	it("combines custom roles and team permissions for the active organization", async () => {
		const page = await content(RolesPage);
		expect(page.key).toBe("org-1");
		expect(page.props.defaultTab).toBe("roles");
		expect(tabs(page)).toEqual(["roles", "team-permissions"]);
		expect(page.props.tabs[0].panel.props).toMatchObject({
			organizationId: "org-1",
		});
		expect(page.props.tabs[1].panel.props).toMatchObject({
			organizationId: "org-1",
		});
	});
	it("renders all nine payroll export tabs on SettingsTabbedPage with smart default", async () => {
		const unconfigured = await content(PayrollExportPage);
		expect(unconfigured.key).toBe("org-1");
		expect(unconfigured.props.measure).toBe(true);
		expect(unconfigured.props.defaultTab).toBe("datev");
		expect(tabs(unconfigured)).toEqual([
			"export",
			"datev",
			"lexware",
			"sage",
			"personio",
			"successfactors",
			"workday",
			"mappings",
			"history",
		]);
		expect(unconfigured.props.tabs[8].panel.props).toMatchObject({
			organizationTimezone: "Europe/Berlin",
		});

		mocks.datev.mockResolvedValue({ success: true, data: { id: "datev-1" } });
		const configured = await content(PayrollExportPage);
		expect(configured.props.defaultTab).toBe("export");
	});
	it("mounts travel expense settings tabs scoped to the active organization", async () => {
		const page = await content(TravelExpensesPage);
		expect(page.key).toBe("org-1");
		expect(Object.keys(page.props)).toEqual([
			"review",
			"currencies",
			"rates",
			"exceptions",
			"access",
		]);
	});
	it("combines vehicle settings, usage, and assignments on SettingsTabbedPage", async () => {
		const page = await content(VehiclesPage);
		expect(page.key).toBe("org-1");
		expect(page.props.measure).toBe(true);
		expect(page.props.defaultTab).toBe("vehicles");
		expect(tabs(page)).toEqual(["vehicles", "use", "assignments"]);
	});
	it.each(["sso", "social-oauth"])(
		"redirects a legacy identity tab on the domains URL",
		async (tab) => {
			await expect(
				DomainsPage({
					searchParams: Promise.resolve({ tab }),
				}).props.children.type({ searchParams: Promise.resolve({ tab }) }),
			).rejects.toThrow(`redirect:/settings/enterprise/identity-setup?tab=${tab}`);
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
