import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	env: {
		MAIN_DOMAIN: "ui.z8-time.app",
		PLATFORM_DOMAIN: "ui.z8-time.app",
	},
	db: {
		query: {
			organization: {
				findFirst: vi.fn(),
			},
			organizationBranding: {
				findFirst: vi.fn(),
			},
		},
	},
	getConfiguredProviders: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mockState.env }));
vi.mock("@/db", () => ({ db: mockState.db }));
vi.mock("@/lib/social-oauth", () => ({ getConfiguredProviders: mockState.getConfiguredProviders }));

const {
	classifyDomainHost,
	getPlatformDomainConfig,
	getPlatformOrganizationAliasLabel,
	getPlatformOrganizationLabel,
	normalizeDomainHost,
	resolvePlatformOrganization,
} = await import("./platform-domain");

describe("platform domain host helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.db.query.organization.findFirst.mockReset();
		mockState.db.query.organizationBranding.findFirst.mockReset();
		mockState.getConfiguredProviders.mockReset();
		mockState.env.MAIN_DOMAIN = "ui.z8-time.app";
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
		mockState.getConfiguredProviders.mockResolvedValue({
			google: false,
			github: false,
			linkedin: false,
			apple: false,
		});
	});

	it("normalizes hosts by lowercasing and removing ports", () => {
		expect(normalizeDomainHost("Acme.UI.Z8-Time.App:443")).toBe("acme.ui.z8-time.app");
		expect(normalizeDomainHost("https://Acme.UI.Z8-Time.App/login")).toBe("acme.ui.z8-time.app");
		expect(normalizeDomainHost("  ")).toBeNull();
	});

	it("classifies the main domain and localhost as main", () => {
		expect(classifyDomainHost("ui.z8-time.app")).toEqual({
			type: "main",
			hostname: "ui.z8-time.app",
		});
		expect(classifyDomainHost("localhost:3000")).toEqual({ type: "main", hostname: "localhost" });
		expect(classifyDomainHost("tenant.localhost:3000")).toEqual({
			type: "main",
			hostname: "tenant.localhost",
		});
	});

	it("classifies one-label platform organization subdomains", () => {
		expect(classifyDomainHost("acme.ui.z8-time.app")).toEqual({
			type: "platformOrganization",
			hostname: "acme.ui.z8-time.app",
			label: "acme",
			rootDomain: "ui.z8-time.app",
		});
		expect(getPlatformOrganizationLabel("org_123.ui.z8-time.app")).toBe("org_123");
	});

	it("builds a dns-safe organization id alias label", () => {
		expect(getPlatformOrganizationAliasLabel("Org_ID-123")).toBe("orgid-4f72675f49442d313233");
	});

	it("classifies one-label localhost platform subdomains as organizations", () => {
		mockState.env.PLATFORM_DOMAIN = "localhost:3000";
		mockState.env.MAIN_DOMAIN = "localhost:3000";

		expect(classifyDomainHost("acme.localhost:3000")).toEqual({
			type: "platformOrganization",
			hostname: "acme.localhost",
			label: "acme",
			rootDomain: "localhost",
		});
	});

	it("does not classify multi-level platform hosts as organization subdomains", () => {
		expect(classifyDomainHost("deep.acme.ui.z8-time.app")).toEqual({
			type: "unknownPlatform",
			hostname: "deep.acme.ui.z8-time.app",
			rootDomain: "ui.z8-time.app",
		});
	});

	it("classifies unrelated hosts as custom domain candidates", () => {
		expect(classifyDomainHost("login.acme.test")).toEqual({
			type: "customDomain",
			hostname: "login.acme.test",
		});
	});
});

describe("platform organization resolution", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.db.query.organization.findFirst.mockReset();
		mockState.db.query.organizationBranding.findFirst.mockReset();
		mockState.getConfiguredProviders.mockReset();
		mockState.env.MAIN_DOMAIN = "ui.z8-time.app";
		mockState.env.PLATFORM_DOMAIN = "ui.z8-time.app";
		mockState.getConfiguredProviders.mockResolvedValue({
			google: false,
			github: false,
			linkedin: false,
			apple: false,
		});
	});

	it("resolves platform labels by slug when no id matches", async () => {
		mockState.db.query.organization.findFirst
			.mockResolvedValueOnce({ id: "org_slug", slug: "acme", name: "Acme" })
			.mockResolvedValueOnce(null);

		const result = await resolvePlatformOrganization("acme");

		expect(result).toEqual({ id: "org_slug", slug: "acme", name: "Acme" });
		expect(mockState.db.query.organization.findFirst).toHaveBeenCalledTimes(2);
	});

	it("prefers organization id aliases when a slug shadows another organization id", async () => {
		mockState.db.query.organization.findFirst
			.mockResolvedValueOnce({ id: "org_shadow", slug: "org_victim", name: "Shadow" })
			.mockResolvedValueOnce({ id: "org_victim", slug: "victim", name: "Victim" });

		const result = await resolvePlatformOrganization("org_victim");

		expect(result).toEqual({ id: "org_victim", slug: "victim", name: "Victim" });
		expect(mockState.db.query.organization.findFirst).toHaveBeenCalledTimes(2);
	});

	it("falls back to organization id when no slug matches", async () => {
		mockState.db.query.organization.findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "org_123", slug: "acme", name: "Acme" });

		const result = await resolvePlatformOrganization("org_123");

		expect(result).toEqual({ id: "org_123", slug: "acme", name: "Acme" });
		expect(mockState.db.query.organization.findFirst).toHaveBeenCalledTimes(2);
	});

	it("resolves encoded organization id aliases without lowercasing the id", async () => {
		mockState.db.query.organization.findFirst
			.mockResolvedValueOnce({ id: "Org_ID-123", slug: "acme", name: "Acme" })
			.mockResolvedValueOnce(null);

		const result = await resolvePlatformOrganization("orgid-4f72675f49442d313233");

		expect(result).toEqual({ id: "Org_ID-123", slug: "acme", name: "Acme" });
		expect(mockState.db.query.organization.findFirst).toHaveBeenCalledTimes(2);
	});

	it("returns null when neither slug nor id matches", async () => {
		mockState.db.query.organization.findFirst.mockResolvedValue(null);

		await expect(resolvePlatformOrganization("missing")).resolves.toBeNull();
	});

	it("builds a domain auth context for platform organization subdomains", async () => {
		mockState.db.query.organization.findFirst.mockResolvedValueOnce({
			id: "org_123",
			slug: "acme",
			name: "Acme",
		});
		mockState.db.query.organizationBranding.findFirst.mockResolvedValueOnce({
			logoUrl: "https://cdn.example/logo.png",
			backgroundImageUrl: null,
			appName: "Acme Time",
			primaryColor: "#2563eb",
			accentColor: "#0ea5e9",
		});
		mockState.getConfiguredProviders.mockResolvedValueOnce({
			google: true,
			github: false,
			linkedin: false,
			apple: false,
		});

		const result = await getPlatformDomainConfig("acme.ui.z8-time.app");

		expect(result).toEqual({
			organizationId: "org_123",
			organizationSlug: "acme",
			domain: "acme.ui.z8-time.app",
			canonicalDomain: "acme.ui.z8-time.app",
			isCanonical: true,
			authConfig: {
				emailPasswordEnabled: true,
				socialProvidersEnabled: ["google", "github", "linkedin", "apple"],
				ssoEnabled: false,
				passkeyEnabled: true,
			},
			branding: {
				logoUrl: "https://cdn.example/logo.png",
				backgroundImageUrl: null,
				appName: "Acme Time",
				primaryColor: "#2563eb",
				accentColor: "#0ea5e9",
			},
			socialOAuthConfigured: {
				google: true,
				github: false,
				linkedin: false,
				apple: false,
			},
			turnstile: {
				enabled: false,
				siteKey: null,
				isEnterprise: false,
			},
		});
	});

	it("marks organization id hosts as aliases with slug canonical domain", async () => {
		mockState.db.query.organization.findFirst
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "org_123", slug: "acme", name: "Acme" });
		mockState.db.query.organizationBranding.findFirst.mockResolvedValueOnce(null);

		const result = await getPlatformDomainConfig("org_123.ui.z8-time.app");

		expect(result?.organizationId).toBe("org_123");
		expect(result?.organizationSlug).toBe("acme");
		expect(result?.domain).toBe("org_123.ui.z8-time.app");
		expect(result?.canonicalDomain).toBe("acme.ui.z8-time.app");
		expect(result?.isCanonical).toBe(false);
	});
});
