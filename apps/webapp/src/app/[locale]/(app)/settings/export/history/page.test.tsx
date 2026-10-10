/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	isExportS3Configured: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: async () => ({ organizationId: "org_1" }),
}));
vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));
vi.mock("@/lib/storage/export-s3-client", () => ({
	isExportS3Configured: mocks.isExportS3Configured,
}));
vi.mock("@/app/[locale]/(app)/settings/export/actions", () => ({
	getExportHistoryAction: async () => ({ success: true, data: [] }),
	getStorageConfigAction: async () => ({ success: true, data: null }),
}));
vi.mock("@/components/settings/export/export-form", () => ({
	ExportForm: () => <div>export form</div>,
}));
vi.mock("@/components/settings/export/export-history", () => ({
	ExportHistory: () => <div>export history list</div>,
}));
vi.mock("@/components/settings/export/storage-settings-form", () => ({
	StorageSettingsForm: () => <div>storage settings form</div>,
}));
vi.mock("@/components/settings/settings-skeletons", () => ({
	SettingsPageSkeleton: () => <div>loading</div>,
}));

const { default: ExportHistorySettingsPage } = await import("./page");
const { default: ExportSettingsPage } = await import("../page");

type BoundaryPage = ReactElement<{ children: ReactElement }>;

async function renderPageContent(page: BoundaryPage) {
	const content = page.props.children;
	render(await (content.type as () => Promise<ReactElement>)());
}

describe("data export settings routes", () => {
	beforeEach(() => {
		mocks.isExportS3Configured.mockReset();
	});

	it("opens the export history tab from the export-ready email link", async () => {
		mocks.isExportS3Configured.mockResolvedValue(false);

		await renderPageContent(ExportHistorySettingsPage() as BoundaryPage);

		expect(
			screen.getByRole("tab", { name: "Export History" }).getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByText("export history list")).toBeTruthy();
	});

	it("keeps opening the main export settings on the new export tab", async () => {
		mocks.isExportS3Configured.mockResolvedValue(true);

		await renderPageContent(ExportSettingsPage() as BoundaryPage);

		expect(
			screen.getByRole("tab", { name: "New Export" }).getAttribute("aria-selected"),
		).toBe("true");
	});
});
