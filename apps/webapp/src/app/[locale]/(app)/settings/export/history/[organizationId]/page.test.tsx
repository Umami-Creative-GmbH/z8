/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	resolveArrival: vi.fn(),
	requireOrgAdminSettingsAccess: vi.fn(),
	redirectWithLocale: vi.fn((path: string): never => {
		throw new Error(`redirect:${path}`);
	}),
	translate: (_key: string, fallback: string, params?: Record<string, string>) =>
		fallback.replace(/\{(\w+)\}/g, (_match, name: string) => params?.[name] ?? ""),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireUser: async () => ({
		user: { id: "user-1" },
		session: { activeOrganizationId: "org-active" },
	}),
	requireOrgAdminSettingsAccess: mocks.requireOrgAdminSettingsAccess,
}));
vi.mock("@/lib/export/history-arrival", () => ({
	resolveExportHistoryArrival: mocks.resolveArrival,
}));
vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: mocks.redirectWithLocale,
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));
vi.mock("@/tolgee/server", () => ({ getTranslate: async () => mocks.translate }));
vi.mock("@tolgee/react", () => ({ useTranslate: () => ({ t: mocks.translate }) }));
// Unconfigured storage would otherwise open the Storage Settings tab.
vi.mock("@/lib/storage/export-s3-client", () => ({
	isExportS3Configured: async () => false,
}));
vi.mock("@/app/[locale]/(app)/settings/export/actions", () => ({
	getExportHistoryAction: async () => ({ success: true, data: [] }),
	getStorageConfigAction: async () => ({ success: true, data: null }),
}));
vi.mock("@/components/settings/export/export-form", () => ({
	ExportForm: () => <div>export form</div>,
}));
vi.mock("@/components/settings/export/export-history", () => ({
	ExportHistory: ({ organizationId }: { organizationId: string }) => (
		<div>export history of {organizationId}</div>
	),
}));
vi.mock("@/components/settings/export/storage-settings-form", () => ({
	StorageSettingsForm: () => <div>storage settings form</div>,
}));
vi.mock("@/components/settings/settings-skeletons", () => ({
	SettingsPageSkeleton: () => <div>loading</div>,
}));

const { default: OrganizationExportHistoryPage } = await import("./page");

type BoundaryPage = ReactElement<{ children: ReactElement<{ params: unknown }> }>;

async function renderPageFor(organizationId: string) {
	const page = OrganizationExportHistoryPage({
		params: Promise.resolve({ organizationId }),
	}) as BoundaryPage;
	const content = page.props.children;
	render(await (content.type as (props: unknown) => Promise<ReactElement>)(content.props));
}

describe("organization export history route", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireOrgAdminSettingsAccess.mockResolvedValue({ organizationId: "org-active" });
	});

	it("opens the history of the active organization behind the org-admin guard", async () => {
		mocks.resolveArrival.mockResolvedValue({ status: "active" });

		await renderPageFor("org-active");

		expect(mocks.resolveArrival).toHaveBeenCalledWith({
			userId: "user-1",
			activeOrganizationId: "org-active",
			organizationId: "org-active",
		});
		expect(mocks.requireOrgAdminSettingsAccess).toHaveBeenCalled();
		expect(screen.getByRole("tab", { name: "Export History" }).getAttribute("aria-selected")).toBe(
			"true",
		);
		expect(screen.getByText("export history of org-active")).toBeTruthy();
	});

	it("offers a switch to the export's organization without loading any history", async () => {
		mocks.resolveArrival.mockResolvedValue({
			status: "switch_organization",
			organizationId: "org-export",
			organizationName: "Acme",
		});

		await renderPageFor("org-export");

		const link = screen.getByRole("link", { name: "Switch to Acme" });
		const target = new URL(link.getAttribute("href") ?? "", "https://app.example.com");
		expect(target.pathname).toBe("/init");
		expect(target.searchParams.get("organizationId")).toBe("org-export");
		expect(target.searchParams.get("callbackUrl")).toBe("/settings/export/history/org-export");
		expect(screen.queryByText(/export history of/)).toBeNull();
		expect(mocks.requireOrgAdminSettingsAccess).not.toHaveBeenCalled();
	});

	it("sends a viewer who cannot manage the export's organization back to settings", async () => {
		mocks.resolveArrival.mockResolvedValue({ status: "unavailable" });

		await expect(renderPageFor("org-export")).rejects.toThrow("redirect:/settings");
		expect(mocks.requireOrgAdminSettingsAccess).not.toHaveBeenCalled();
	});

	it("never shows the active organization's history under another organization's link", async () => {
		mocks.resolveArrival.mockResolvedValue({ status: "active" });
		mocks.requireOrgAdminSettingsAccess.mockResolvedValue({ organizationId: "org-other" });

		await expect(renderPageFor("org-active")).rejects.toThrow("redirect:/settings");
		expect(screen.queryByText(/export history of/)).toBeNull();
	});
});
