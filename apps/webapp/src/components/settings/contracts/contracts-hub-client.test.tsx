/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	searchParams: new URLSearchParams(),
	getContractDefaultsAction: vi.fn(),
	previewContractDefaultChangeAction: vi.fn(),
	scheduleContractDefaultAction: vi.fn(),
	listContractTemplatesAction: vi.fn(),
	listContractsReviewQueueAction: vi.fn(),
	resolveContractMigrationConflictAction: vi.fn(),
	previewBulkContractActionAction: vi.fn(),
	submitBulkContractActionAction: vi.fn(),
	listContractChangeBatchesAction: vi.fn(),
	resolveDepartureReviewAction: vi.fn(),
	getWorkPolicies: vi.fn(),
	listTeams: vi.fn(),
}));

vi.mock("next/navigation", () => ({
	useSearchParams: () => mocks.searchParams,
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

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: React.ReactNode }) => (
		<a href={href}>{children}</a>
	),
}));

vi.mock("@/app/[locale]/(app)/settings/contracts/actions", () => ({
	getContractDefaultsAction: mocks.getContractDefaultsAction,
	previewContractDefaultChangeAction: mocks.previewContractDefaultChangeAction,
	scheduleContractDefaultAction: mocks.scheduleContractDefaultAction,
	listContractTemplatesAction: mocks.listContractTemplatesAction,
	createContractTemplateAction: vi.fn(),
	publishContractTemplateVersionAction: vi.fn(),
	archiveContractTemplateAction: vi.fn(),
	listContractsReviewQueueAction: mocks.listContractsReviewQueueAction,
	resolveContractMigrationConflictAction: mocks.resolveContractMigrationConflictAction,
}));

vi.mock("@/app/[locale]/(app)/settings/contracts/bulk-actions", () => ({
	previewBulkContractActionAction: mocks.previewBulkContractActionAction,
	submitBulkContractActionAction: mocks.submitBulkContractActionAction,
	listContractChangeBatchesAction: mocks.listContractChangeBatchesAction,
	getContractChangeBatchAction: vi.fn(),
	previewCsvContractImportAction: vi.fn(),
	previewCsvLeavingDateImportAction: vi.fn(),
	commitCsvImportBatchAction: vi.fn(),
}));

vi.mock("@/app/[locale]/(app)/settings/employees/employee-offboarding.actions", () => ({
	resolveDepartureReviewAction: mocks.resolveDepartureReviewAction,
}));

vi.mock("./working-student-reviews-section", () => ({
	WorkingStudentReviewsSection: () => null,
}));

vi.mock("@/app/[locale]/(app)/settings/work-policies/actions", () => ({
	getWorkPolicies: mocks.getWorkPolicies,
}));

vi.mock("@/app/[locale]/(app)/settings/teams/actions", () => ({
	listTeams: mocks.listTeams,
}));

vi.mock("@/components/settings/work-policy/work-policy-management", () => ({
	WorkPolicyManagement: ({
		workPolicyVersioningEnabled,
	}: {
		workPolicyVersioningEnabled?: boolean;
	}) => (
		<div data-testid="work-policy-management">
			versioning:{String(Boolean(workPolicyVersioningEnabled))}
		</div>
	),
}));

import { ContractsHubClient } from "./contracts-hub-client";

function renderHub(workPolicyVersioningEnabled = true) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<ContractsHubClient
				organizationId="org-1"
				organizationTimezone="Europe/Berlin"
				workPolicyVersioningEnabled={workPolicyVersioningEnabled}
			/>
		</QueryClientProvider>,
	);
}

describe("ContractsHubClient (#1930)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.searchParams = new URLSearchParams();
		mocks.getContractDefaultsAction.mockResolvedValue({ success: true, data: [] });
		mocks.getWorkPolicies.mockResolvedValue({
			success: true,
			data: [{ id: "pol-1", name: "Standard DE 40h", isActive: true }],
		});
		mocks.listTeams.mockResolvedValue({
			success: true,
			data: [{ id: "team-1", name: "Retail" }],
		});
		mocks.listContractTemplatesAction.mockResolvedValue({ success: true, data: [] });
		mocks.listContractChangeBatchesAction.mockResolvedValue({ success: true, data: [] });
		mocks.listContractsReviewQueueAction.mockResolvedValue({
			success: true,
			data: {
				migratedLegacyTermsCount: 4,
				migrationConflicts: [
					{
						id: "conf-1",
						employeeId: "emp-1",
						employeeName: "Ada Lovelace",
						employeeNumber: "E-01",
						employmentHistoryId: "hist-1",
						workPolicyId: "pol-1",
						conflictKind: "weekly_hours_policy_day_sum_mismatch",
						status: "open",
						details: {},
						resolutionNote: null,
						createdAt: new Date("2026-06-01T00:00:00Z"),
						resolvedAt: null,
					},
				],
				departureReviews: [
					{
						id: "rev-1",
						employeeId: "emp-2",
						employeeName: "Grace Hopper",
						employeeNumber: "E-02",
						departureId: "dep-1",
						lastWorkingDay: "2026-05-15",
						kind: "payroll_reconciliation",
						status: "open",
						reason: "closed_or_settled_payroll_overlap",
						resolution: null,
						createdAt: new Date("2026-06-01T00:00:00Z"),
						resolvedAt: null,
					},
				],
			},
		});
		mocks.previewContractDefaultChangeAction.mockResolvedValue({
			success: true,
			data: {
				scope: "organization",
				teamId: null,
				effectiveFromDate: "2026-07-01",
				remoteExemptDefaultApplied: false,
				totalEvaluated: 5,
				inheritingCount: 4,
				divergedCount: 1,
				unchangedCount: 0,
				mismatchWarningCount: 0,
				inheritingEmployees: [
					{
						employeeId: "emp-1",
						firstName: "Ada",
						lastName: "Lovelace",
						primaryTeamId: null,
						status: "inheriting",
						changes: [
							{
								field: "weeklyContractMinutes",
								before: 2400,
								after: 2280,
								beforeSource: "org_default",
								afterSource: "org_default",
							},
						],
						preservedDivergenceFields: [],
						mismatchWarning: null,
					},
				],
				divergedEmployees: [
					{
						employeeId: "emp-2",
						firstName: "Grace",
						lastName: "Hopper",
						primaryTeamId: null,
						status: "diverged",
						changes: [],
						preservedDivergenceFields: ["weeklyContractMinutes"],
						mismatchWarning: null,
					},
				],
				unchangedEmployees: [],
				mismatchWarnings: [],
			},
		});
		mocks.previewBulkContractActionAction.mockResolvedValue({
			success: true,
			data: {
				actionKind: "adopt_default",
				effectiveFromDate: "2026-06-01",
				confirmationFingerprint: "a".repeat(64),
				canSubmit: true,
				totalMatched: 4,
				wouldApplyCount: 4,
				wouldSkipCount: 0,
				wouldFailCount: 0,
				mismatchWarningCount: 0,
				employees: [],
			},
		});
		mocks.submitBulkContractActionAction.mockResolvedValue({
			success: true,
			data: {
				batch: {
					id: "batch-1",
					totalItems: 4,
				},
				executionMode: "inline",
				replayed: false,
				recoveryNudged: false,
			},
		});
	});

	it("renders all 5 tabs and supports affected-employee preview on the Defaults tab", async () => {
		renderHub();

		expect(screen.getByRole("tab", { name: "Defaults" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Templates" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Work Policies" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Bulk & CSV" })).toBeTruthy();
		expect(screen.getByRole("tab", { name: "Reviews & Conflicts" })).toBeTruthy();

		// 1-step 5-person quick setup card is visible when no org default exists
		expect(await screen.findByText("1-Step Organization Default Setup")).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Preview affected employees" }));
		expect(await screen.findByText("4 inheriting changes")).toBeTruthy();
		expect(screen.getByText("1 keeping personal divergences")).toBeTruthy();
	});

	it("shows migrated legacy terms banner with 1-click bulk adopt and conflict/departure review queues", async () => {
		mocks.searchParams = new URLSearchParams("tab=reviews");
		renderHub();

		expect(
			await screen.findByText(/migrated_legacy_terms|pre-migration legacy terms/i),
		).toBeTruthy();
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("Grace Hopper")).toBeTruthy();
		expect(screen.getByText("contract_migration_conflict")).toBeTruthy();
		expect(screen.getByText("payroll_reconciliation")).toBeTruthy();

		const adoptButton = screen.getByRole("button", {
			name: "Adopt Org/Team default for all",
		}) as HTMLButtonElement;
		expect(adoptButton.disabled).toBe(true);

		fireEvent.click(screen.getByRole("button", { name: "Preview adoption" }));
		await waitFor(() => expect(adoptButton.disabled).toBe(false));

		fireEvent.click(adoptButton);
		await waitFor(() =>
			expect(mocks.submitBulkContractActionAction).toHaveBeenCalledWith(
				expect.objectContaining({
					actionKind: "adopt_default",
					target: { onlyLegacyTerms: true },
					confirmationFingerprint: "a".repeat(64),
				}),
			),
		);
	});
});
