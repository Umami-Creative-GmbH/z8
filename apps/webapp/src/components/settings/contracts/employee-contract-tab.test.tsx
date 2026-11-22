/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectiveContractOnDay } from "@/lib/contracts/types";

const mocks = vi.hoisted(() => ({
	getEmployeeEffectiveContractAction: vi.fn(),
	listEmployeeTermAgreementsAction: vi.fn(),
	previewEmployeeContractChangeAction: vi.fn(),
	commitEmployeeContractChangeAction: vi.fn(),
	adoptEmployeeContractDefaultAction: vi.fn(),
	resetEmployeeContractDivergencesAction: vi.fn(),
	createInitialEmploymentAgreementAction: vi.fn(),
	recordFixedTermExtensionAction: vi.fn(),
	assignEmployeeWorkPolicyAction: vi.fn(),
}));

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			Object.entries(params ?? {}).reduce(
				(text, [k, v]) => text.replaceAll(`{${k}}`, String(v)),
				fallback,
			),
	}),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/app/[locale]/(app)/settings/contracts/actions", () => ({
	getEmployeeEffectiveContractAction: mocks.getEmployeeEffectiveContractAction,
	listEmployeeTermAgreementsAction: mocks.listEmployeeTermAgreementsAction,
	previewEmployeeContractChangeAction: mocks.previewEmployeeContractChangeAction,
	commitEmployeeContractChangeAction: mocks.commitEmployeeContractChangeAction,
	adoptEmployeeContractDefaultAction: mocks.adoptEmployeeContractDefaultAction,
	resetEmployeeContractDivergencesAction: mocks.resetEmployeeContractDivergencesAction,
	createInitialEmploymentAgreementAction: mocks.createInitialEmploymentAgreementAction,
	recordFixedTermExtensionAction: mocks.recordFixedTermExtensionAction,
	assignEmployeeWorkPolicyAction: mocks.assignEmployeeWorkPolicyAction,
}));

import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { EmployeeContractTab } from "./employee-contract-tab";
import { ScopedManagerPolicyCard } from "./scoped-manager-policy-card";

const sampleEffectiveContract: EffectiveContractOnDay = {
	date: "2026-07-01",
	dayOfWeek: "wednesday",
	calendarTimezone: "Europe/Berlin",
	employeeId: "emp-1",
	employmentPeriodId: "period-1",
	isEmployedOnDay: true,
	primaryTeamId: "team-1",
	employmentHistoryId: "hist-1",
	contractDefaultId: "def-1",
	contractDefaultScope: "team",
	workPolicy: {
		policyId: "pol-1",
		policyName: "Germany Standard 40h",
		policyVersionId: "pv-1",
		versionNumber: 1,
		effectiveFromDate: "2026-01-01",
		scheduleEnabled: true,
		regulationEnabled: true,
		presenceEnabled: true,
		schedule: null,
		regulation: null,
		presence: null,
		assignmentType: "organization",
		assignmentId: "asgn-1",
		assignedVia: "org",
	},
	workPolicySource: "org_default",
	weeklyContractMinutes: 2100,
	weeklyContractMinutesSource: "employee_override",
	scheduleMode: "policy",
	scheduleModeSource: "team_default",
	workModel: "remote",
	workModelSource: "employee_override",
	presenceOverride: "exempt",
	presenceOverrideSource: "employee_override",
	presenceStatus: "exempt",
	effectivePresence: null,
	balanceMode: "trust_based",
	balanceModeSource: "team_default",
	scheduleSource: "on_call",
	scheduleSourceSource: "employee_override",
	isWorkDay: true,
	requiredMinutes: 420,
	contributesZeroBalanceDelta: true,
	latestClockIn: null,
	weeklyScheduleDays: [],
	mismatchWarning: null,
	contractType: "hourly",
	hourlyRate: 24.5,
	currency: "EUR",
	employmentProfile: "working_student",
	arbzgScope: "standard",
	onCallTerms: {
		hoursKind: "minimum",
		weeklyMinutes: 900,
		statutoryFallbackWeeklyMinutes: null,
		callInMinBandMinutes: 900,
		callInMaxBandMinutes: 1125,
		dailyMinutes: null,
		statutoryMinDailyMinutes: 180,
	},
	migratedLegacyTerms: true,
};

function renderWithQuery(ui: React.ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("EmployeeContractTab & ScopedManagerPolicyCard (#1930)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getEmployeeEffectiveContractAction.mockResolvedValue({
			success: true,
			data: sampleEffectiveContract,
		});
		mocks.listEmployeeTermAgreementsAction.mockResolvedValue({
			success: true,
			data: {
				agreements: [
					{
						id: "agr-1",
						sequenceNumber: 1,
						kind: "fixed_term",
						startsOn: "2026-01-01",
						endsOn: "2026-12-31",
						reason: "Project grant",
					},
				],
				pendingScheduledDeparture: {
					id: "dep-1",
					employmentPeriodId: "period-1",
					lastWorkingDay: "2026-12-31",
					status: "pending",
					revision: 1,
				},
			},
		});
		mocks.previewEmployeeContractChangeAction.mockResolvedValue({
			success: true,
			data: {
				validFromDate: "2026-07-01",
				employeeId: "emp-1",
				currentContract: sampleEffectiveContract,
				remoteExemptDefaultApplied: true,
				resolvedPresenceOverride: "exempt",
				onCallPreview: {
					isOnCall: true,
					hoursKind: "minimum",
					effectiveWeeklyMinutes: 900,
					callInMinBandMinutes: 900,
					callInMaxBandMinutes: 1125,
					dailyMinutes: null,
					dailyDurationPreview:
						"At least three consecutive hours per call-in (§ 12 Abs. 1 Satz 4 TzBfG)",
				},
				divergenceFields: ["weeklyContractMinutes", "workModel"],
				inheritedFields: ["workPolicy"],
				customDaysTotalMinutes: null,
			},
		});
		mocks.adoptEmployeeContractDefaultAction.mockResolvedValue({
			success: true,
			data: { employmentHistory: { validFromDate: "2026-07-01" } },
		});
		mocks.assignEmployeeWorkPolicyAction.mockResolvedValue({
			success: true,
			data: { effectiveFromDate: "2026-07-01" },
		});
	});

	it("renders Term/Value/Source table, statutory § 12 TzBfG copy, 1-click adopt, and retains stale preview on edits", async () => {
		renderWithQuery(
			<EmployeeContractTab
				organizationId="org-1"
				organizationTimezone="Europe/Berlin"
				employeeId="emp-1"
				workPolicies={[{ id: "pol-1", name: "Germany Standard 40h" }]}
				employmentHistory={[]}
			/>,
		);

		// Term / Value / Source provenance badges
		expect(await screen.findByText("Germany Standard 40h")).toBeTruthy();
		expect(screen.getByText("Org Default")).toBeTruthy();
		expect(screen.getAllByText("Primary Team Default").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Employee Override").length).toBeGreaterThan(0);
		expect(screen.getAllByText("Employee Term").length).toBeGreaterThan(0);

		// Exact statutory § 12(1) TzBfG copy when dailyMinutes is null
		expect(
			screen.getByText(
				"No per-call duration agreed — at least three consecutive hours per call-in applies under § 12(1) TzBfG",
			),
		).toBeTruthy();

		// 1-click Adopt Org/Team default for migratedLegacyTerms = true
		fireEvent.click(screen.getByRole("button", { name: "Adopt Org/Team default" }));
		await waitFor(() =>
			expect(mocks.adoptEmployeeContractDefaultAction).toHaveBeenCalledWith(
				expect.objectContaining({ employeeId: "emp-1" }),
			),
		);

		// Open Change panel, preview change, then mutate input -> stale preview retained with indicator
		fireEvent.click(screen.getByRole("button", { name: "Change contract" }));
		expect(
			await screen.findByText("Remote work model defaults on-site presence to exempt"),
		).toBeTruthy();
		expect(screen.getByText("On-call weekly hours agreement (§ 12 TzBfG)")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Preview change" }));
		expect(await screen.findByTestId("contract-change-preview")).toBeTruthy();
		expect(screen.queryByTestId("stale-preview-badge")).toBeNull();

		// Change weekly hours override -> preview stays visible and shows stale badge
		const hoursInput = screen.getByLabelText("Weekly hours override (blank to inherit)");
		fireEvent.change(hoursInput, { target: { value: "32" } });
		expect(screen.getByTestId("contract-change-preview")).toBeTruthy();
		expect(screen.getByTestId("stale-preview-badge").textContent).toMatch(/Preview out of date/);
	});

	it("opens Fixed-Term Extension panel with departure-sync choices", async () => {
		renderWithQuery(
			<EmployeeContractTab
				organizationId="org-1"
				organizationTimezone="Europe/Berlin"
				employeeId="emp-1"
				workPolicies={[]}
				employmentHistory={[]}
			/>,
		);

		fireEvent.click(await screen.findByRole("button", { name: "Record extension" }));
		expect(await screen.findByText("Pending scheduled departure handling")).toBeTruthy();
		expect(screen.getByText("Update pending leaving date to match the new end date")).toBeTruthy();
		expect(screen.getByText("Cancel pending scheduled departure")).toBeTruthy();
		expect(screen.getByText("Leave pending departure unchanged (flags for review)")).toBeTruthy();
	});

	it("renders wage-free A1 policy assignment card for scoped managers without wages or defaults", async () => {
		renderWithQuery(
			<ScopedManagerPolicyCard
				employeeId="emp-1"
				organizationTimezone="Pacific/Kiritimati"
				workPolicies={[{ id: "pol-1", name: "Germany Standard 40h" }]}
			/>,
		);

		expect(screen.getByText("Work Policy Assignment")).toBeTruthy();
		expect(screen.queryByText(/Hourly rate/i)).toBeNull();
		expect(screen.queryByText(/Adopt Org\/Team default/i)).toBeNull();

		const expectedOrgToday = plainDateAt(systemClock.nowInstant(), "Pacific/Kiritimati").toString();
		const dateInput = screen.getByLabelText("Effective from") as HTMLInputElement;
		expect(dateInput.value).toBe(expectedOrgToday);
		expect(dateInput.min).toBe(expectedOrgToday);

		fireEvent.click(screen.getByRole("button", { name: "Assign work policy" }));
		await waitFor(() =>
			expect(mocks.assignEmployeeWorkPolicyAction).toHaveBeenCalledWith(
				expect.objectContaining({
					employeeId: "emp-1",
					policyId: "pol-1",
					effectiveFromDate: expectedOrgToday,
				}),
			),
		);
	});
});
