import { isValidElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineAbilityFor, type PrincipalContext } from "@/lib/authorization";

const mockState = vi.hoisted(() => ({
	connection: vi.fn(async () => undefined),
	redirect: vi.fn((path: string) => {
		throw new Error(`redirect:${path}`);
	}),
	requireUser: vi.fn(),
	requireAbility: vi.fn(),
	findOrganization: vi.fn(),
	loadWorksCouncilSettings: vi.fn(),
	auditWorksCouncilPortalViewed: vi.fn(),
	buildWorksCouncilPortalModel: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	redirect: mockState.redirect,
}));

vi.mock("next/server", () => ({
	connection: mockState.connection,
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireUser: mockState.requireUser,
	requireAbility: mockState.requireAbility,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: mockState.findOrganization,
			},
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	organization: {
		id: "organization.id",
	},
}));

vi.mock("@/lib/works-council/settings", () => ({
	loadWorksCouncilSettings: mockState.loadWorksCouncilSettings,
}));

vi.mock("@/lib/works-council/access-audit", () => ({
	auditWorksCouncilPortalViewed: mockState.auditWorksCouncilPortalViewed,
}));

vi.mock("@/lib/works-council/review-data", () => ({
	buildWorksCouncilPortalModel: mockState.buildWorksCouncilPortalModel,
}));

vi.mock("@/components/works-council/works-council-dashboard", () => ({
	WorksCouncilDashboard: ({ model }: { model: unknown }) => ({ model }),
}));

const { default: WorksCouncilPage } = await import("./page");

async function renderWorksCouncilContent() {
	const page = WorksCouncilPage({});
	if (!isValidElement(page) || !isValidElement(page.props.children)) {
		throw new Error("Expected a focused Works Council boundary");
	}
	const content = page.props.children as React.ReactElement<
		{ searchParams?: Promise<{ from?: string; to?: string }> },
		(props: {
			searchParams?: Promise<{ from?: string; to?: string }>;
		}) => Promise<React.ReactNode>
	>;
	return content.type(content.props);
}

function createPrincipal(): PrincipalContext {
	return {
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: {
			organizationId: "org-1",
			role: "admin",
			status: "active",
		},
		employee: null,
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
	};
}

describe("WorksCouncilPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireUser.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mockState.requireAbility.mockResolvedValue(
			defineAbilityFor(createPrincipal()),
		);
		mockState.findOrganization.mockResolvedValue({ worksCouncilEnabled: true });
	});

	it("redirects before loading Works Council data when the organization feature is disabled", async () => {
		mockState.findOrganization.mockResolvedValue({
			worksCouncilEnabled: false,
		});

		await expect(renderWorksCouncilContent()).rejects.toThrow("redirect:/");

		expect(mockState.redirect).toHaveBeenCalledWith("/");
		expect(mockState.loadWorksCouncilSettings).not.toHaveBeenCalled();
		expect(mockState.auditWorksCouncilPortalViewed).not.toHaveBeenCalled();
		expect(mockState.buildWorksCouncilPortalModel).not.toHaveBeenCalled();
	});
});
