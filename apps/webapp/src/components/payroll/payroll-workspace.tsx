"use client";

import { IconScale } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import Link from "next/link";
import { useReducer, useRef, useTransition } from "react";
import { toast } from "sonner";
import type { PayrollExportFormatOption } from "@/app/[locale]/(app)/payroll/actions";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import type { PayrollWorkspaceSummary } from "@/lib/payroll-workspace/types";
import { monthsOfDateRange } from "@/lib/time-tracking/closed-months/month-label";
import { PayrollAbsencesTab } from "./workspace/payroll-absences-tab";
import { PayrollDaysTab } from "./workspace/payroll-days-tab";
import { PayrollExportTab } from "./workspace/payroll-export-tab";
import { PayrollOverviewTab } from "./workspace/payroll-overview-tab";
import { PayrollPeriodBar } from "./workspace/payroll-period-bar";
import { PayrollSettlementFigures } from "./workspace/payroll-settlement-figures";
import { PayrollStatusStrip } from "./workspace/payroll-status-strip";
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
import {
	payrollPeriodActions,
	useMountedRef,
	usePayrollSummaryLoader,
} from "./workspace/use-payroll-summary";

interface PayrollWorkspaceProps {
	initialSummary: PayrollWorkspaceSummary;
	exportFormats: PayrollExportFormatOption[];
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
 * Days, Absences and Export tabs. The period, scope and format state is shared by all tabs.
 */
function PayrollWorkspaceContent({ initialSummary, exportFormats }: PayrollWorkspaceProps) {
	const { t } = useTranslate();
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
	useViewRefresh(() =>
		refreshLatestSummary({
			preserveDraft: true,
			onError: (error) =>
				toast.error(error ?? t("payroll.errors.actionFailed", "Payroll workspace action failed")),
		}),
	);
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
		<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-4">
			<PayrollHeader organizationName={summary.organizationName} t={t} />
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
					absences: <PayrollAbsencesTab t={t} />,
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
							refreshedAt={summary.generatedAt}
							request={request}
							t={t}
						/>
					),
				}}
			/>
		</div>
	);
}

function PayrollHeader({ organizationName, t }: { organizationName: string; t: PayrollTranslate }) {
	return (
		<PageHeader
			scope={organizationName}
			title={t("payroll.title", "Payroll")}
			description={t(
				"payroll.description",
				"Review payroll totals, readiness, and exports for the selected period.",
			)}
			actions={
				<Button asChild variant="outline">
					<Link href="/payroll/work-balances">
						<IconScale aria-hidden="true" className="size-4" />
						{t("payroll.workBalances.open", "Work balances")}
					</Link>
				</Button>
			}
		/>
	);
}
