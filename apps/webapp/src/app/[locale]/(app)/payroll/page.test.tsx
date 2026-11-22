/* @vitest-environment jsdom */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClosedMonthsOverview } from "@/app/[locale]/(app)/settings/closed-months/actions";
import type { PayrollReadinessResult } from "@/lib/payroll-readiness/get-payroll-readiness";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";

const mockState = vi.hoisted(() => ({
	authContext: null as {
		user: { id: string; email: string; name: string };
		session: { activeOrganizationId: string | null };
		employee: { id: string; organizationId: string; role: "admin" | "manager" | "employee" } | null;
	} | null,
	settingsCaller: null as {
		organizationId: string;
		settingsAccess: { tier: "member" | "manager" | "orgAdmin" };
	} | null,
	canClose: false,
	canReopen: false,
	hasGrant: false,
	summaryAction: vi.fn(),
	formatsAction: vi.fn(),
	getPayrollReadiness: vi.fn(),
	getClosedMonthsOverview: vi.fn(),
	loadPayrollWorkBalanceEmployees: vi.fn(),
	workspaceSpy: vi.fn(),
	closedMonthsWorkspaceSpy: vi.fn(),
}));

vi.mock("next/server", () => ({
	connection: vi.fn(async () => undefined),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/tolgee/server", () => ({
	getTranslate: vi.fn(async () => (_key: string, fallback: string) => fallback),
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAuthContext: vi.fn(async () => mockState.authContext),
	getCurrentSettingsAccess: vi.fn(async () => mockState.settingsCaller),
	getAbility: vi.fn(async () => ({
		can: (action: string, subject: string) => {
			if (subject !== "PayrollPeriod") return false;
			if (action === "close") return mockState.canClose;
			if (action === "reopen") return mockState.canReopen;
			return false;
		},
	})),
}));

vi.mock("@/lib/organization-action/settings-access", () => ({
	meetsSettingsAccess: (
		access: { tier: "member" | "manager" | "orgAdmin" },
		required: "member" | "manager" | "orgAdmin",
	) => {
		const rank = { member: 0, manager: 1, orgAdmin: 2 };
		return rank[access.tier] >= rank[required];
	},
}));

vi.mock("@/lib/payroll-access/permissions", () => ({
	hasActivePayrollAccessGrant: vi.fn(async () => mockState.hasGrant),
}));

vi.mock("@/lib/payroll-readiness/get-payroll-readiness", () => ({
	getPayrollReadiness: mockState.getPayrollReadiness,
}));

vi.mock("@/app/[locale]/(app)/settings/closed-months/actions", () => ({
	getClosedMonthsOverview: mockState.getClosedMonthsOverview,
}));

vi.mock("./actions", () => ({
	getPayrollWorkspaceSummaryAction: mockState.summaryAction,
	getConfiguredPayrollExportFormatsAction: mockState.formatsAction,
}));

vi.mock("./work-balances/coverage", () => ({
	loadPayrollWorkBalanceEmployees: mockState.loadPayrollWorkBalanceEmployees,
}));

vi.mock("@/components/payroll/payroll-workspace", () => ({
	PayrollWorkspace: (props: Record<string, unknown>) => {
		mockState.workspaceSpy(props);
		return <div data-testid="payroll-workspace" />;
	},
}));

vi.mock("@/components/payroll/payroll-closed-months-workspace", () => ({
	PayrollClosedMonthsWorkspace: (props: Record<string, unknown>) => {
		mockState.closedMonthsWorkspaceSpy(props);
		return <div data-testid="payroll-closed-months-workspace" />;
	},
}));

vi.mock("@/components/payroll/former-employees-export-card", () => ({
	FormerEmployeesExportCard: () => <div data-testid="former-employees-export-card" />,
}));

const { default: PayrollPage } = await import("./page");

const sampleSummary: PayrollWorkspaceSummary = {
	organizationId: "org-1",
	organizationName: "Acme GmbH",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	generatedAt: "2026-06-30T12:00:00.000Z",
	generatedBy: { id: "user-1", name: "User One" },
	totals: { employeeCount: 1, totalWorkedHours: 8, blockerCount: 0 },
	employees: [],
	absenceDetails: [],
	blockers: [],
};

const sampleReadiness: PayrollReadinessResult = {
	status: "ready",
	period: { start: "2026-06-01", end: "2026-06-30", label: "June 2026" },
	summary: {
		blockerCount: 0,
		warningCount: 0,
		affectedEmployeeCount: 0,
		configuredExportTargetCount: 1,
	},
	groups: [],
};

const sampleClosedMonths: ClosedMonthsOverview = {
	canClose: true,
	canReopen: false,
	timezone: "Europe/Berlin",
	months: [],
	history: [],
	teams: [],
	locations: [],
	employees: [],
	settings: { autoCloseEnabled: false, autoCloseAfterDays: 5 },
};

async function renderPayrollPageContent() {
	const page = PayrollPage();
	const contentEl = page.props.children;
	const resolved = await contentEl.type(contentEl.props);
	return render(resolved);
}

describe("PayrollPage actor paths (#1957)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.authContext = null;
		mockState.settingsCaller = null;
		mockState.canClose = false;
		mockState.canReopen = false;
		mockState.hasGrant = false;
		mockState.summaryAction.mockResolvedValue({ success: true, data: sampleSummary });
		mockState.formatsAction.mockResolvedValue({ success: true, data: [] });
		mockState.getPayrollReadiness.mockResolvedValue(sampleReadiness);
		mockState.getClosedMonthsOverview.mockResolvedValue({
			success: true,
			data: sampleClosedMonths,
		});
		mockState.loadPayrollWorkBalanceEmployees.mockResolvedValue(null);
	});

	it("renders full workspace with org readiness and closed months for an employee-less org admin", async () => {
		mockState.authContext = {
			user: { id: "user-owner", email: "owner@example.com", name: "Owner" },
			session: { activeOrganizationId: "org-1" },
			employee: null,
		};
		mockState.settingsCaller = {
			organizationId: "org-1",
			settingsAccess: { tier: "orgAdmin" },
		};
		mockState.canClose = true;

		await renderPayrollPageContent();

		expect(screen.getByTestId("payroll-workspace")).toBeTruthy();
		expect(mockState.getPayrollReadiness).toHaveBeenCalledTimes(1);
		expect(mockState.getClosedMonthsOverview).toHaveBeenCalledTimes(1);
		expect(mockState.workspaceSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				isOrgAdmin: true,
				initialReadiness: sampleReadiness,
				closedMonthsOverview: sampleClosedMonths,
			}),
		);
	});

	it("renders scoped workspace without org readiness or closed months for a delegated payroll officer", async () => {
		mockState.authContext = {
			user: { id: "user-officer", email: "officer@example.com", name: "Officer" },
			session: { activeOrganizationId: "org-1" },
			employee: { id: "emp-officer", organizationId: "org-1", role: "employee" },
		};
		mockState.settingsCaller = {
			organizationId: "org-1",
			settingsAccess: { tier: "member" },
		};
		mockState.hasGrant = true;

		await renderPayrollPageContent();

		expect(screen.getByTestId("payroll-workspace")).toBeTruthy();
		expect(mockState.getPayrollReadiness).not.toHaveBeenCalled();
		expect(mockState.getClosedMonthsOverview).not.toHaveBeenCalled();
		expect(mockState.workspaceSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				isOrgAdmin: false,
				initialReadiness: null,
				closedMonthsOverview: null,
			}),
		);
	});

	it("lands a close-month-only custom-role holder directly on Closed Months without loading restricted payroll data", async () => {
		mockState.authContext = {
			user: { id: "user-closer", email: "closer@example.com", name: "Month Closer" },
			session: { activeOrganizationId: "org-1" },
			employee: { id: "emp-closer", organizationId: "org-1", role: "employee" },
		};
		mockState.settingsCaller = {
			organizationId: "org-1",
			settingsAccess: { tier: "member" },
		};
		mockState.hasGrant = false;
		mockState.canClose = true;

		await renderPayrollPageContent();

		expect(screen.getByTestId("payroll-closed-months-workspace")).toBeTruthy();
		expect(screen.queryByTestId("payroll-workspace")).toBeNull();
		expect(mockState.summaryAction).not.toHaveBeenCalled();
		expect(mockState.formatsAction).not.toHaveBeenCalled();
		expect(mockState.getPayrollReadiness).not.toHaveBeenCalled();
		expect(mockState.getClosedMonthsOverview).toHaveBeenCalledTimes(1);
		expect(mockState.closedMonthsWorkspaceSpy).toHaveBeenCalledWith({
			overview: sampleClosedMonths,
		});
	});

	it("shows access denied for a member with neither payroll access nor close/reopen permission", async () => {
		mockState.authContext = {
			user: { id: "user-plain", email: "plain@example.com", name: "Plain Employee" },
			session: { activeOrganizationId: "org-1" },
			employee: { id: "emp-plain", organizationId: "org-1", role: "employee" },
		};
		mockState.settingsCaller = {
			organizationId: "org-1",
			settingsAccess: { tier: "member" },
		};

		await renderPayrollPageContent();

		expect(screen.getByText("No payroll access")).toBeTruthy();
		expect(mockState.summaryAction).not.toHaveBeenCalled();
		expect(mockState.getClosedMonthsOverview).not.toHaveBeenCalled();
	});
});
