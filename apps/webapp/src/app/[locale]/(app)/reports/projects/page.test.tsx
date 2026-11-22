/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCurrentEmployeeProjectReportAccessMock, redirectWithLocaleMock } = vi.hoisted(() => ({
	getCurrentEmployeeProjectReportAccessMock: vi.fn(),
	redirectWithLocaleMock: vi.fn(() => null),
}));

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		Suspense: ({ children }: { children: ReactNode }) => children,
	};
});

vi.mock("@/tolgee/server", () => ({
	getTranslate: async () => (_key: string, defaultValue: string) => defaultValue,
}));

vi.mock("@/lib/navigation/locale-redirect", () => ({
	redirectWithLocale: redirectWithLocaleMock,
}));

vi.mock("./actions", () => ({
	getCurrentEmployeeProjectReportAccess: getCurrentEmployeeProjectReportAccessMock,
}));

vi.mock("@/components/reports/projects/project-reports-container", () => ({
	ProjectReportsContainer: () => <div data-testid="project-reports-container" />,
}));

vi.mock("@/components/errors/no-employee-error", () => ({
	NoEmployeeError: ({ feature }: { feature: string }) => (
		<div data-testid="no-employee-error">{feature}</div>
	),
}));

import ProjectReportsPage from "./page";

async function renderProjectReportsPage() {
	const element = ProjectReportsPage();
	const content = await element.props.children.props.children.type();
	return render(<>{content}</>);
}

describe("ProjectReportsPage route gating (#1954)", () => {
	beforeEach(() => {
		getCurrentEmployeeProjectReportAccessMock.mockReset();
		redirectWithLocaleMock.mockClear();
	});

	it("redirects direct visits to /reports when projectsEnabled is false", async () => {
		getCurrentEmployeeProjectReportAccessMock.mockResolvedValue({
			employee: { id: "emp-1", role: "admin" },
			projectsEnabled: false,
			canViewProjectReports: false,
		});

		await renderProjectReportsPage();

		expect(redirectWithLocaleMock).toHaveBeenCalledWith("/reports");
		expect(screen.queryByTestId("project-reports-container")).toBeNull();
	});

	it("redirects employee-less org admins when projectsEnabled is false", async () => {
		getCurrentEmployeeProjectReportAccessMock.mockResolvedValue({
			employee: null,
			projectsEnabled: false,
			canViewProjectReports: false,
		});

		await renderProjectReportsPage();

		expect(redirectWithLocaleMock).toHaveBeenCalledWith("/reports");
		expect(screen.queryByTestId("no-employee-error")).toBeNull();
	});

	it("renders ProjectReportsContainer for an authorized project manager below manager tier when enabled", async () => {
		getCurrentEmployeeProjectReportAccessMock.mockResolvedValue({
			employee: { id: "emp-1", role: "employee" },
			projectsEnabled: true,
			canViewProjectReports: true,
		});

		await renderProjectReportsPage();

		expect(redirectWithLocaleMock).not.toHaveBeenCalled();
		expect(screen.getByTestId("project-reports-container")).toBeTruthy();
	});

	it("shows Access Denied for a plain employee without project-report permission when enabled", async () => {
		getCurrentEmployeeProjectReportAccessMock.mockResolvedValue({
			employee: { id: "emp-1", role: "employee" },
			projectsEnabled: true,
			canViewProjectReports: false,
		});

		await renderProjectReportsPage();

		expect(redirectWithLocaleMock).not.toHaveBeenCalled();
		expect(screen.getByText("Access Denied")).toBeTruthy();
		expect(screen.queryByTestId("project-reports-container")).toBeNull();
	});

	it("shows NoEmployeeError when projects are enabled and viewer has no employee record", async () => {
		getCurrentEmployeeProjectReportAccessMock.mockResolvedValue({
			employee: null,
			projectsEnabled: true,
			canViewProjectReports: false,
		});

		await renderProjectReportsPage();

		expect(redirectWithLocaleMock).not.toHaveBeenCalled();
		expect(screen.getByTestId("no-employee-error")).toBeTruthy();
	});
});
