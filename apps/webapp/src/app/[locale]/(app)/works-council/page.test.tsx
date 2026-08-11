/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, within } from "@testing-library/react";
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
	getTranslate: vi.fn(),
	translate: vi.fn((key: string, fallback: string) =>
		key === "worksCouncil.loadingLabel"
			? "Betriebsratsportal wird geladen"
			: fallback,
	),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: mockState.getTranslate,
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

async function renderWorksCouncilContent(
	props: Parameters<typeof WorksCouncilPage>[0] = {},
) {
	const page = WorksCouncilPage(props);
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
		mockState.getTranslate.mockResolvedValue(mockState.translate);
		mockState.requireUser.mockResolvedValue({
			user: { id: "user-1" },
			session: { activeOrganizationId: "org-1" },
		});
		mockState.requireAbility.mockResolvedValue(
			defineAbilityFor(createPrincipal()),
		);
		mockState.findOrganization.mockResolvedValue({ worksCouncilEnabled: true });
		mockState.loadWorksCouncilSettings.mockResolvedValue({
			reviewWindowDays: 30,
		});
		mockState.buildWorksCouncilPortalModel.mockResolvedValue({ entries: [] });
	});

	it("renders the generic visual shell while translation and access remain unresolved", () => {
		mockState.requireUser.mockReturnValue(new Promise(() => {}));
		mockState.getTranslate.mockReturnValue(new Promise(() => {}));

		render(
			WorksCouncilPage({
				searchParams: new Promise(() => {}),
			}),
		);

		const status = screen.getByRole("status", {
			name: "Loading Works Council portal",
		});
		expect(status).toBe(screen.getByTestId("works-council-loading"));
		expect(status.getAttribute("aria-live")).toBe("polite");
		expect(status.getAttribute("aria-busy")).toBe("true");
		expect(
			within(status).queryByText("Betriebsratsportal wird geladen"),
		).toBeNull();
		expect(screen.queryByText(/org-1|user-1/i)).toBeNull();
	});

	it("renders the localized loading status after translation resolves", async () => {
		mockState.requireUser.mockReturnValue(new Promise(() => {}));

		render(WorksCouncilPage({}));
		const status = screen.getByTestId("works-council-loading");

		expect(
			await within(status).findByText("Betriebsratsportal wird geladen"),
		).toBeTruthy();
		expect(status.getAttribute("aria-labelledby")).toBe(
			"works-council-loading-label",
		);
		expect(screen.getAllByRole("status")).toHaveLength(1);
		expect(mockState.translate).toHaveBeenCalledWith(
			"worksCouncil.loadingLabel",
			"Loading works council",
		);
	});

	it("defines the loading label in every common locale catalog", () => {
		const languages = [
			"en",
			"de",
			"fr",
			"es",
			"it",
			"pt",
			"el",
			"pl",
			"tr",
			"gsw",
		];

		for (const language of languages) {
			const catalog = JSON.parse(
				readFileSync(
					resolve(process.cwd(), `messages/common/${language}.json`),
					"utf8",
				),
			) as { worksCouncil?: { loadingLabel?: string } };
			const loadingLabel = catalog.worksCouncil?.loadingLabel;

			expect(loadingLabel).toBeTruthy();
			if (language !== "en") {
				expect(loadingLabel).not.toBe("Loading works council");
			}
		}
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

	it("keeps audit and model loading scoped to the active organization", async () => {
		const dashboard = await renderWorksCouncilContent({
			searchParams: Promise.resolve({
				from: "2026-07-01",
				to: "2026-07-31",
			}),
		});

		expect(mockState.connection).toHaveBeenCalledOnce();
		expect(mockState.loadWorksCouncilSettings).toHaveBeenCalledWith("org-1");
		expect(mockState.auditWorksCouncilPortalViewed).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				actorUserId: "user-1",
			}),
		);
		expect(mockState.buildWorksCouncilPortalModel).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				actorUserId: "user-1",
			}),
		);
		expect(
			mockState.auditWorksCouncilPortalViewed.mock.invocationCallOrder[0],
		).toBeLessThan(
			mockState.buildWorksCouncilPortalModel.mock.invocationCallOrder[0],
		);
		expect(dashboard.props.model).toEqual({ entries: [] });
	});
});
