/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

const mockState = vi.hoisted(() => ({
	connection: vi.fn(async () => undefined),
	requireOrgAdminSettingsAccess: vi.fn(),
	getPayrollReadiness: vi.fn(),
	getTranslate: vi.fn(),
	translate: vi.fn((key: string, fallback: string) => {
		if (key === "settings.payrollReadiness.title") {
			return "Abrechnungsbereitschaft";
		}
		if (key === "settings.payrollReadiness.description") {
			return "Prüfen Sie die Bereitschaft für den Abrechnungszeitraum.";
		}
		return fallback;
	}),
}));

vi.mock("next/server", () => ({
	connection: mockState.connection,
}));

vi.mock("@/lib/auth-helpers", () => ({
	requireOrgAdminSettingsAccess: mockState.requireOrgAdminSettingsAccess,
}));

vi.mock("@/lib/payroll-readiness/get-payroll-readiness", () => ({
	getPayrollReadiness: mockState.getPayrollReadiness,
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: mockState.getTranslate,
}));

vi.mock(
	"@/components/settings/payroll-readiness/payroll-readiness-dashboard",
	() => ({
		PayrollReadinessDashboard: ({ data }: { data: unknown }) => (
			<div
				data-testid="payroll-readiness-dashboard"
				data-value={JSON.stringify(data)}
			/>
		),
	}),
);

const { default: PayrollReadinessPage } = await import("./page");

function getContentElement(page: ReturnType<typeof PayrollReadinessPage>) {
	const pageContent = page.props.children;
	const contentFrame = pageContent.type(pageContent.props);
	return contentFrame.props.children[1].props.children;
}

describe("PayrollReadinessPage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getTranslate.mockResolvedValue(mockState.translate);
		mockState.requireOrgAdminSettingsAccess.mockResolvedValue({
			organizationId: "org-1",
		});
		mockState.getPayrollReadiness.mockResolvedValue({ status: "ready" });
	});

	it.each([
		[
			"access",
			() =>
				mockState.requireOrgAdminSettingsAccess.mockReturnValue(
					new Promise(() => {}),
				),
		],
		["search params", () => undefined],
	])(
		"renders the stable shell while %s remain unresolved",
		(_name, arrange) => {
			arrange();
			mockState.getTranslate.mockReturnValue(new Promise(() => {}));
			const pendingSearchParams = new Promise<never>(() => {});
			const searchParams =
				_name === "search params" ? pendingSearchParams : Promise.resolve({});

			const page = PayrollReadinessPage({ searchParams });
			const pageContent = page.props.children;
			const contentFrame = pageContent.type(pageContent.props);

			expect(contentFrame.type).toBe("div");
			expect(contentFrame.props.children).toHaveLength(2);
			render(page);

			expect(
				screen.getByTestId("payroll-readiness-header-loading"),
			).toBeTruthy();
			expect(screen.queryByRole("heading")).toBeNull();
			expect(screen.getByLabelText("Loading settings")).toBeTruthy();
		},
	);

	it("renders the localized header after translation resolves", async () => {
		const page = PayrollReadinessPage({});
		const pageContent = page.props.children;
		const contentFrame = pageContent.type(pageContent.props);
		const headerElement = contentFrame.props.children[0].props.children;

		render(await headerElement.type());

		expect(
			screen.getByRole("heading", { name: "Abrechnungsbereitschaft" }),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Prüfen Sie die Bereitschaft für den Abrechnungszeitraum.",
			),
		).toBeTruthy();
		expect(screen.queryByText("Payroll Readiness")).toBeNull();
	});

	it("preserves the authorized organization and requested UTC period", async () => {
		const page = PayrollReadinessPage({
			searchParams: Promise.resolve({ start: "2026-07-01", end: "2026-07-31" }),
		});
		const contentElement = getContentElement(page);

		const dashboard = await contentElement.type(contentElement.props);

		expect(mockState.connection).toHaveBeenCalledOnce();
		expect(mockState.requireOrgAdminSettingsAccess).toHaveBeenCalledOnce();
		expect(mockState.getPayrollReadiness).toHaveBeenCalledWith({
			organizationId: "org-1",
			period: {
				start: expect.objectContaining({ zoneName: "UTC" }),
				end: expect.objectContaining({ zoneName: "UTC" }),
			},
		});
		const [{ period }] = mockState.getPayrollReadiness.mock.calls[0];
		expect(period.start.toISODate()).toBe("2026-07-01");
		expect(period.end.toISODate()).toBe("2026-07-31");
		expect(dashboard.props.data).toEqual({ status: "ready" });
		expect(dashboard.props.t).toBe(mockState.translate);
	});
});
