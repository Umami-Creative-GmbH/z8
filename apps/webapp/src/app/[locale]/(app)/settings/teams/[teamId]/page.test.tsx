/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { use } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentSettingsAccessMock, redirectWithLocaleMock } = vi.hoisted(() => ({
	getCurrentSettingsAccessMock: vi.fn(),
	redirectWithLocaleMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getCurrentSettingsAccess: getCurrentSettingsAccessMock,
}));

vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: redirectWithLocaleMock,
}));

vi.mock("./team-detail-page-client", () => ({
	TeamDetailPageClient: ({ params }: { params: Promise<{ teamId: string }> }) => {
		use(params);
		return <div>Team detail</div>;
	},
}));

const { default: TeamDetailPage } = await import("./page");

describe("TeamDetailPage route boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the settings fallback while params remain unresolved", () => {
		getCurrentSettingsAccessMock.mockReturnValue(new Promise<never>(() => {}));
		const page = TeamDetailPage({ params: new Promise<never>(() => {}) });

		expect(page).not.toBeInstanceOf(Promise);
		render(page);

		expect(screen.getByLabelText("Loading settings")).toBeTruthy();
	});

	it.each([
		null,
		{
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: null,
			membershipRole: null,
			employee: null,
		},
		{
			userId: "user-1",
			organizationId: "org-1",
			settingsAccess: "member",
			membershipRole: "member",
			employee: { id: "employee-1", role: "employee" },
		},
	])(
		"redirects callers without scoped-manager settings access away from team detail settings",
		async (caller) => {
			getCurrentSettingsAccessMock.mockResolvedValue(caller);
			redirectWithLocaleMock.mockImplementation((path: string) => {
				throw new Error(`REDIRECT:${path}`);
			});

			const page = TeamDetailPage({ params: Promise.resolve({ teamId: "team-1" }) });
			const guardedElement = page.props.children as {
				type: (props: { params: Promise<{ teamId: string }> }) => Promise<unknown>;
				props: { params: Promise<{ teamId: string }> };
			};

			await expect(guardedElement.type(guardedElement.props)).rejects.toThrow("REDIRECT:/settings");
			expect(redirectWithLocaleMock).toHaveBeenCalledWith("/settings");
		},
	);

	it("keeps params consumption in the client implementation", () => {
		const routeDirectory = resolve(process.cwd(), "src/app/[locale]/(app)/settings/teams/[teamId]");
		const pageSource = readFileSync(resolve(routeDirectory, "page.tsx"), "utf8");
		const clientSource = readFileSync(
			resolve(routeDirectory, "team-detail-page-client.tsx"),
			"utf8",
		);

		expect(pageSource).not.toMatch(/^\s*["']use client["'];/);
		expect(pageSource).toContain("<Suspense fallback={<SettingsContentLoading />}>");
		expect(pageSource).toContain("<TeamDetailPageClient params={params} />");
		expect(pageSource).not.toContain("use(params)");
		expect(clientSource).toMatch(/^\s*["']use client["'];/);
		expect(clientSource).toContain("export function TeamDetailPageClient");
		expect(clientSource).toContain("use(params)");
	});
});
