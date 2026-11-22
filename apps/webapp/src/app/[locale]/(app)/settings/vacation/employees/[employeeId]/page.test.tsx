/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { use } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireOrgAdminSettingsAccessMock } = vi.hoisted(() => ({
	requireOrgAdminSettingsAccessMock: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: requireOrgAdminSettingsAccessMock,
}));

vi.mock("./employee-allowance-edit-page-client", () => ({
	EmployeeAllowanceEditPageClient: ({
		params,
	}: {
		params: Promise<{ employeeId: string }>;
	}) => {
		use(params);
		return <div>Employee allowance editor</div>;
	},
}));

const { default: EmployeeAllowanceEditPage } = await import("./page");

describe("EmployeeAllowanceEditPage route boundary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("renders the settings fallback while params remain unresolved", () => {
		requireOrgAdminSettingsAccessMock.mockReturnValue(new Promise<never>(() => {}));
		const page = EmployeeAllowanceEditPage({
			params: new Promise<never>(() => {}),
		});

		expect(page).not.toBeInstanceOf(Promise);
		render(page);

		expect(screen.getByLabelText("Loading settings")).toBeTruthy();
	});

	it("enforces org-admin settings access on the server before rendering the client editor", async () => {
		requireOrgAdminSettingsAccessMock.mockRejectedValue(new Error("REDIRECT:/settings"));

		const page = EmployeeAllowanceEditPage({
			params: Promise.resolve({ employeeId: "emp-1" }),
		});
		const guardedElement = page.props.children as {
			type: (props: { params: Promise<{ employeeId: string }> }) => Promise<unknown>;
			props: { params: Promise<{ employeeId: string }> };
		};

		await expect(guardedElement.type(guardedElement.props)).rejects.toThrow("REDIRECT:/settings");
		expect(requireOrgAdminSettingsAccessMock).toHaveBeenCalledOnce();
	});

	it("keeps params consumption in the client implementation", () => {
		const routeDirectory = resolve(
			process.cwd(),
			"src/app/[locale]/(app)/settings/vacation/employees/[employeeId]",
		);
		const pageSource = readFileSync(
			resolve(routeDirectory, "page.tsx"),
			"utf8",
		);
		const clientSource = readFileSync(
			resolve(routeDirectory, "employee-allowance-edit-page-client.tsx"),
			"utf8",
		);

		expect(pageSource).not.toMatch(/^\s*["']use client["'];/);
		expect(pageSource).toContain(
			"<Suspense fallback={<SettingsContentLoading />}>",
		);
		expect(pageSource).toContain("<EmployeeAllowanceEditPageClient");
		expect(pageSource).toContain("params={params}");
		expect(pageSource).not.toContain("use(params)");
		expect(clientSource).toMatch(/^\s*["']use client["'];/);
		expect(clientSource).toContain(
			"export function EmployeeAllowanceEditPageClient",
		);
		expect(clientSource).toContain("use(params)");
	});
});
