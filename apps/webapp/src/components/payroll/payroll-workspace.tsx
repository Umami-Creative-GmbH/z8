"use client";

import { IconAlertTriangle, IconScale, IconSettings } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useReducer, useRef, useTransition } from "react";
import { toast } from "sonner";
import type { PayrollExportFormatOption } from "@/app/[locale]/(app)/payroll/actions";
import type { ClosedMonthsOverview } from "@/app/[locale]/(app)/settings/closed-months/actions";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { ClosedMonthsSettings } from "@/components/settings/closed-months/closed-months-settings";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { PayrollReadinessResult } from "@/lib/payroll-readiness/get-payroll-readiness";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import { monthsOfDateRange } from "@/lib/time-tracking/closed-months/month-label";
import { Link } from "@/navigation";
import { PayrollAbsencesTab } from "./workspace/payroll-absences-tab";
import { PayrollDaysTab } from "./workspace/payroll-days-tab";
import { PayrollExportTab } from "./workspace/payroll-export-tab";
import { PayrollOverviewTab } from "./workspace/payroll-overview-tab";
import { PayrollPeriodBar } from "./workspace/payroll-period-bar";
import { PayrollSettlementFigures } from "./workspace/payroll-settlement-figures";
import { PayrollSettlementTab } from "./workspace/payroll-settlement-tab";
import { PayrollStatusStrip } from "./workspace/payroll-status-strip";
import { OnCallReferencePayrollCard } from "./on-call-reference-payroll-card";
import { PayrollWorkspaceTabs } from "./workspace/payroll-workspace-tabs";
import {
	basePeriodRequest,
	getFilteredEmployeeIds,
	getTeamOptions,
	type PayrollPeriodRequest,
	type PayrollTranslate,
	payrollWorkspaceReducer,
} from "./workspace/state";
import { usePayrollBlockerClearing } from "./workspace/use-payroll-blocker-clearing";
import { usePayrollExportActions } from "./workspace/use-payroll-export-actions";
import { PayrollSettlementRefreshProvider } from "./workspace/use-payroll-settlement-changed";
import {
	payrollPeriodActions,
	useMountedRef,
	usePayrollSummaryLoader,
} from "./workspace/use-payroll-summary";

interface PayrollWorkspaceProps {
	initialSummary: PayrollWorkspaceSummary;
	exportFormats: PayrollExportFormatOption[];
	/** Organization administrators see org-level readiness and the contextual `/settings/payroll-export` link (#1957). */
	isOrgAdmin?: boolean;
	/** Initial organization-level payroll readiness snapshot for org admins (#1957). */
	initialReadiness?: PayrollReadinessResult | null;
	/** Present when the actor is authorized to close or reopen months (#1957). */
	closedMonthsOverview?: ClosedMonthsOverview | null;
	/** Present when the actor may manage closed months but loading the overview failed (#1957). */
	closedMonthsError?: string | null;
}

export function PayrollWorkspace(props: PayrollWorkspaceProps) {
	// A newly authorized organization, actor or covered roster owns a fresh UI
	// lifetime. Ordinary same-scope server refreshes preserve the operator's drafts.
	const scopeKey = JSON.stringify([
		props.initialSummary.organizationId,
		props.initialSummary.generatedBy.id,
		props.initialSummary.employees.map((employee) => employee.id).toSorted(),
	]);
	return <PayrollWorkspaceContent key={scopeKey} {...props} />;
}

/**
 * The payroll workspace: a period and scope bar, a status strip, and the Overview,
 * Days, Absences, Settlement, Export, and (when permitted) Closed Months tabs.
 * The period, scope and format state is shared by all tabs.
 */
function PayrollWorkspaceContent({
	initialSummary,
	exportFormats,
	isOrgAdmin = false,
	initialReadiness = null,
	closedMonthsOverview = null,
	closedMonthsError = null,
}: PayrollWorkspaceProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const [state, dispatch] = useReducer(payrollWorkspaceReducer, {
		summary: initialSummary,
		dateMode: "month",
		startDate: initialSummary.period.start,
		endDate: initialSummary.period.end,
		selectedEmployeeIds: [],
		selectedTeamNames: [],
		formatId: exportFormats[0]?.id ?? "",
	});
	const {
		summary,
		dateMode,
		startDate,
		endDate,
		selectedEmployeeIds,
		selectedTeamNames,
		formatId,
	} = state;
	const [isPending, startTransition] = useTransition();
	const isMountedRef = useMountedRef();
	const blockersSummaryRef = useRef<HTMLDivElement | null>(null);

	const scopedEmployees = initialSummary.employees;
	const filteredEmployeeIds = getFilteredEmployeeIds(
		scopedEmployees,
		selectedEmployeeIds,
		selectedTeamNames,
	);
	const filtersHaveNoMatches = filteredEmployeeIds?.length === 0;
	const displayedEmployees = filtersHaveNoMatches ? [] : summary.employees;
	const displayedBlockers = filtersHaveNoMatches ? [] : summary.blockers;
	const displayedTotals = filtersHaveNoMatches
		? { employeeCount: 0, totalWorkedHours: 0, blockerCount: 0 }
		: summary.totals;
	const readyEmployeeCount = displayedEmployees.filter((employee) => !employee.hasBlockers).length;
	const request = {
		startDate: summary.period.start,
		endDate: summary.period.end,
		label: summary.period.label,
		employeeIds: filteredEmployeeIds,
	};
	// The period's months and the selection, for the closed-month status (#762).
	const periodMonths = monthsOfDateRange(summary.period.start, summary.period.end);
	const closureEmployeeIds = filteredEmployeeIds ?? scopedEmployees.map((employee) => employee.id);
	const { loadSummary, refreshLatestSummary } = usePayrollSummaryLoader({
		dispatch,
		initialRequest: request,
		isMountedRef,
	});
	const refreshWorkspaceSummary = () =>
		refreshLatestSummary({
			preserveDraft: true,
			onError: (error) =>
				toast.error(error ?? t("payroll.errors.actionFailed", "Payroll workspace action failed")),
		});
	useViewRefresh(refreshWorkspaceSummary);
	const { clearingBlockerKeys, clearPayrollBlocker, focusRequest } = usePayrollBlockerClearing({
		blockers: displayedBlockers,
		clickRequest: request,
		isMountedRef,
		refreshLatestSummary,
		t,
	});

	function refreshSummary(
		nextRequest: PayrollPeriodRequest,
		employeeIds = filteredEmployeeIds,
		onSuccess?: () => void,
	) {
		if (employeeIds?.length === 0) {
			toast.error(
				t(
					"payroll.filters.noMatchingEmployees",
					"No employees match the selected payroll filters.",
				),
			);
			return;
		}

		startTransition(async () => {
			await loadSummary(
				{ ...nextRequest, employeeIds },
				{
					onError: (error) =>
						toast.error(
							error ?? t("payroll.errors.actionFailed", "Payroll workspace action failed"),
						),
					onSuccess,
				},
			);
		});
	}

	function applyScopeFilter(
		nextEmployeeIds: string[],
		nextTeamNames: string[],
		commit: () => void,
		onSuccess?: () => void,
	) {
		const nextFilteredEmployeeIds = getFilteredEmployeeIds(
			scopedEmployees,
			nextEmployeeIds,
			nextTeamNames,
		);

		if (nextFilteredEmployeeIds?.length === 0) {
			commit();
			refreshSummary(basePeriodRequest(summary), nextFilteredEmployeeIds);
			onSuccess?.();
			return;
		}

		refreshSummary(basePeriodRequest(summary), nextFilteredEmployeeIds, () => {
			commit();
			onSuccess?.();
		});
	}

	function applyEmployeeFilter(nextEmployeeIds: string[], onSuccess?: () => void) {
		applyScopeFilter(
			nextEmployeeIds,
			selectedTeamNames,
			() => dispatch({ type: "employeeFilterChanged", employeeIds: nextEmployeeIds }),
			onSuccess,
		);
	}

	function applyTeamFilter(nextTeamNames: string[], onSuccess?: () => void) {
		applyScopeFilter(
			selectedEmployeeIds,
			nextTeamNames,
			() => dispatch({ type: "teamFilterChanged", teamNames: nextTeamNames }),
			onSuccess,
		);
	}

	const { applyCustomRange, applyDateMode, navigatePeriod, returnToCurrentPeriod } =
		payrollPeriodActions({
			dateMode,
			dispatch,
			endDate,
			filteredEmployeeIds,
			locale,
			refreshSummary,
			startDate,
			summary,
		});
	const { downloadPdf, triggerExport } = usePayrollExportActions({
		filtersHaveNoMatches,
		formatId,
		request,
		startTransition,
		t,
	});

	return (
		<PayrollSettlementRefreshProvider refreshSummary={refreshWorkspaceSummary}>
			<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-4">
				<PayrollHeader
					organizationName={summary.organizationName}
					isOrgAdmin={isOrgAdmin}
					t={t}
				/>
				<PayrollPeriodBar
					dateMode={dateMode}
					dispatch={dispatch}
					employeeCount={displayedTotals.employeeCount}
					endDate={endDate}
					filtersHaveNoMatches={filtersHaveNoMatches}
					isPending={isPending}
					onApplyCustomRange={applyCustomRange}
					onApplyDateMode={applyDateMode}
					onApplyEmployees={applyEmployeeFilter}
					onApplyTeams={applyTeamFilter}
					onNavigatePeriod={navigatePeriod}
					onReturnToCurrentPeriod={returnToCurrentPeriod}
					scopedEmployees={scopedEmployees}
					selectedEmployeeIds={selectedEmployeeIds}
					selectedTeamNames={selectedTeamNames}
					startDate={startDate}
					summary={summary}
					teamOptions={getTeamOptions(scopedEmployees)}
					t={t}
				/>
				<PayrollStatusStrip
					blockersSummaryRef={blockersSummaryRef}
					displayedTotals={displayedTotals}
					readyEmployeeCount={readyEmployeeCount}
					t={t}
				>
					<PayrollSettlementFigures
						filtersHaveNoMatches={filtersHaveNoMatches}
						refreshedAt={summary.generatedAt}
						request={request}
						t={t}
					/>
				</PayrollStatusStrip>
				<PayrollWorkspaceTabs
					t={t}
					panels={{
						overview: (
							<PayrollOverviewTab
								blockers={displayedBlockers}
								blockersSummaryRef={blockersSummaryRef}
								clearingBlockerKeys={clearingBlockerKeys}
								closureEmployeeIds={closureEmployeeIds}
								employees={displayedEmployees}
								filtersHaveNoMatches={filtersHaveNoMatches}
								focusRequest={focusRequest}
								formatId={formatId}
								initialPeriod={{
									startDate: initialSummary.period.start,
									endDate: initialSummary.period.end,
								}}
								initialReadiness={initialReadiness}
								isOrgAdmin={isOrgAdmin}
								onClearBlocker={clearPayrollBlocker}
								periodMonths={periodMonths}
								request={request}
								t={t}
							/>
						),
						days: (
							<PayrollDaysTab
								filtersHaveNoMatches={filtersHaveNoMatches}
								refreshedAt={summary.generatedAt}
								request={request}
								t={t}
							/>
						),
						absences: (
							<>
								<PayrollAbsencesTab
									filtersHaveNoMatches={filtersHaveNoMatches}
									refreshedAt={summary.generatedAt}
									request={request}
									t={t}
								/>
								{/* § 12 TzBfG reference hours for on-call sick leave and holidays (#1992). */}
								{isOrgAdmin ? (
									<OnCallReferencePayrollCard
										organizationId={summary.organizationId}
										startDate={request.startDate}
										endDate={request.endDate}
									/>
								) : null}
							</>
						),
						settlement: (
							<PayrollSettlementTab
								filtersHaveNoMatches={filtersHaveNoMatches}
								refreshedAt={summary.generatedAt}
								request={request}
								t={t}
							/>
						),
						export: (
							<PayrollExportTab
								dispatch={dispatch}
								exportFormats={exportFormats}
								filteredEmployeeIds={filteredEmployeeIds}
								filtersHaveNoMatches={filtersHaveNoMatches}
								formatId={formatId}
								isPending={isPending}
								onDownloadPdf={downloadPdf}
								onTriggerExport={triggerExport}
								period={summary.period}
								t={t}
							/>
						),
						...(closedMonthsOverview
							? {
									"closed-months": <ClosedMonthsSettings overview={closedMonthsOverview} />,
								}
							: closedMonthsError
								? {
										"closed-months": (
											<Alert variant="destructive">
												<IconAlertTriangle aria-hidden="true" />
												<AlertTitle>
													{t(
														"settings.closedMonths.loadErrorTitle",
														"Closed months could not be loaded",
													)}
												</AlertTitle>
												<AlertDescription>{closedMonthsError}</AlertDescription>
											</Alert>
										),
									}
								: {}),
					}}
				/>
			</div>
		</PayrollSettlementRefreshProvider>
	);
}

function PayrollHeader({
	organizationName,
	isOrgAdmin,
	t,
}: {
	organizationName: string;
	isOrgAdmin: boolean;
	t: PayrollTranslate;
}) {
	return (
		<PageHeader
			scope={organizationName}
			title={t("payroll.title", "Payroll")}
			description={t(
				"payroll.description",
				"Review payroll totals, readiness, and exports for the selected period.",
			)}
			actions={
				<div className="flex flex-wrap items-center gap-2">
					{isOrgAdmin ? (
						<Button asChild variant="outline">
							<Link href="/settings/payroll-export">
								<IconSettings aria-hidden="true" className="size-4" />
								{t(
									"settings.payrollExport.connectorsTitle",
									"Payroll Connectors & Wage Types",
								)}
							</Link>
						</Button>
					) : null}
					<Button asChild variant="outline">
						<Link href="/payroll/work-balances">
							<IconScale aria-hidden="true" className="size-4" />
							{t("payroll.workBalances.open", "Work balances")}
						</Link>
					</Button>
				</div>
			}
		/>
	);
}
