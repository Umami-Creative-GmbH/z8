/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	requireOrgAdminSettingsAccess: vi.fn(),
	dbRead: vi.fn(),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mockState.requireOrgAdminSettingsAccess,
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, fallback: string) => fallback,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: { findFirst: mockState.dbRead },
		},
	},
}));

vi.mock("@/components/settings/import/import-hub", () => ({
	ImportHub: () => <div data-testid="import-hub" />,
}));

const { default: ImportPage } = await import("./page");

describe("ImportPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.requireOrgAdminSettingsAccess.mockResolvedValue({
			organizationId: "org-1",
			authContext: { user: { id: "user-1" } },
		});
	});

	it("renders the import hub after org-admin access, without a further member lookup", async () => {
		const page = ImportPage();
		const content = page.props.children;

		render(await content.type(content.props));

		expect(mockState.requireOrgAdminSettingsAccess).toHaveBeenCalledOnce();
		expect(mockState.dbRead).not.toHaveBeenCalled();
		expect(screen.getByRole("heading", { name: "Import Data" })).toBeTruthy();
		expect(screen.getByTestId("import-hub")).toBeTruthy();
	});

	it("stops at the access check when it refuses", async () => {
		mockState.requireOrgAdminSettingsAccess.mockRejectedValue(new Error("NEXT_REDIRECT"));
		const page = ImportPage();
		const content = page.props.children;

		await expect(content.type(content.props)).rejects.toThrow("NEXT_REDIRECT");
	});
});
