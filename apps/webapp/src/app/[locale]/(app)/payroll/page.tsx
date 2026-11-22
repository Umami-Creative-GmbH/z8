import { IconAlertTriangle } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { connection } from "next/server";
import { Suspense } from "react";
import { getClosedMonthsOverview } from "@/app/[locale]/(app)/settings/closed-months/actions";
import { FormerEmployeesExportCard } from "@/components/payroll/former-employees-export-card";
import { PayrollClosedMonthsWorkspace } from "@/components/payroll/payroll-closed-months-workspace";
import { PayrollWorkspace } from "@/components/payroll/payroll-workspace";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getAbility, getAuthContext } from "@/lib/auth-helpers";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { isOrgAdminForOrganization } from "@/lib/payroll-access/org-admin";
import { hasActivePayrollAccessGrant } from "@/lib/payroll-access/permissions";
import { getPayrollReadiness } from "@/lib/payroll-readiness/get-payroll-readiness";
import { canCloseMonths, canReopenMonths } from "@/lib/time-tracking/closed-months/permissions";
import { getTranslate } from "@/tolgee/server";
import {
	getConfiguredPayrollExportFormatsAction,
	getPayrollWorkspaceSummaryAction,
} from "./actions";
import { PayrollFailureState } from "./payroll-failure-state";
import { loadPayrollWorkBalanceEmployees } from "./work-balances/coverage";

async function PayrollPageContent() {
	// The current payroll period must be resolved per request.
	await connection();
	const now = DateTime.utc();
	const start = now.startOf("month");
	const end = now.endOf("month");
	const initialRequest = {
		startDate: start.toISODate() ?? "",
		endDate: end.toISODate() ?? "",
		label: start.toFormat("LLLL yyyy"),
	};

	const [t, authContext, ability] = await Promise.all([
		getTranslate(),
		getAuthContext(),
		getAbility(),
	]);

	const organizationId = authContext?.session.activeOrganizationId ?? null;
	if (!authContext || !organizationId) {
		return <PayrollFailureState code="AuthenticationError" t={t} />;
	}

	const isOrgAdmin = await isOrgAdminForOrganization(organizationId);
	const hasPayrollGrant =
		!isOrgAdmin &&
		Boolean(
			authContext.employee &&
				authContext.employee.organizationId === organizationId &&
				(await hasActivePayrollAccessGrant({
					organizationId,
					payrollEmployeeId: authContext.employee.id,
				})),
		);
	const canManageClosedMonths = Boolean(
		ability &&
			(canCloseMonths(ability, organizationId, organizationId) ||
				canReopenMonths(ability, organizationId, organizationId)),
	);

	// Close-month-only custom-role holders land directly on Closed Months without loading
	// restricted payroll totals, settlement, or export views (#1957).
	if (!isOrgAdmin && !hasPayrollGrant) {
		if (canManageClosedMonths) {
			const closedMonthsOverview = await getClosedMonthsOverview();
			if (closedMonthsOverview.success) {
				return <PayrollClosedMonthsWorkspace overview={closedMonthsOverview.data} />;
			}
			return (
				<div className="@container/main page-frame flex min-w-0 flex-1 flex-col gap-6">
					<PageHeader
						title={t("payroll.title", "Payroll")}
						description={t(
							"settings.closedMonths.description",
							"Close months after payroll so their work and absences can no longer change",
						)}
					/>
					<Alert variant="destructive">
						<IconAlertTriangle aria-hidden="true" />
						<AlertTitle>
							{t("settings.closedMonths.loadErrorTitle", "Closed months could not be loaded")}
						</AlertTitle>
						<AlertDescription>
							{actionErrorMessage(t, closedMonthsOverview, {}, [
								"settings.closedMonths.loadErrorDescription",
								"Reload the page to try again.",
							])}
						</AlertDescription>
					</Alert>
				</div>
			);
		}
		return <PayrollFailureState code="AuthorizationError" t={t} />;
	}

	const [summaryResult, formatsResult, initialReadiness, closedMonthsResult] = await Promise.all([
		getPayrollWorkspaceSummaryAction(initialRequest),
		getConfiguredPayrollExportFormatsAction(),
		isOrgAdmin
			? getPayrollReadiness({ organizationId, period: { start, end } }).catch(() => null)
			: Promise.resolve(null),
		canManageClosedMonths ? getClosedMonthsOverview() : Promise.resolve(null),
	]);

	if (!summaryResult.success) {
		// A grant whose active employees are gone still covers the employees who
		// have left for their overtime payouts (#995).
		const offerWorkBalances =
			summaryResult.code === "AuthorizationError" &&
			((await loadPayrollWorkBalanceEmployees())?.length ?? 0) > 0;
		return (
			<PayrollFailureState
				code={summaryResult.code}
				t={t}
				offerWorkBalances={offerWorkBalances}
				exportEntry={
					// Their last months can still be exported (#1001).
					<FormerEmployeesExportCard
						initialMonth={start.toFormat("yyyy-MM")}
						exportFormats={formatsResult.success ? formatsResult.data : []}
					/>
				}
			/>
		);
	}

	const closedMonthsError =
		canManageClosedMonths && closedMonthsResult && !closedMonthsResult.success
			? actionErrorMessage(t, closedMonthsResult, {}, [
					"settings.closedMonths.loadErrorDescription",
					"Reload the page to try again.",
				])
			: null;

	return (
		<PayrollWorkspace
			initialSummary={summaryResult.data}
			exportFormats={formatsResult.success ? formatsResult.data : []}
			isOrgAdmin={isOrgAdmin}
			initialReadiness={initialReadiness}
			closedMonthsOverview={closedMonthsResult?.success ? closedMonthsResult.data : null}
			closedMonthsError={closedMonthsError}
		/>
	);
}

async function PayrollPageLoading() {
	const t = await getTranslate();
	return (
		<LoadingRegion
			className="@container/main page-frame flex flex-1 flex-col gap-6"
			role="status"
			label={{
				labelKey: "common.loadingRegions.payrollWorkspace",
				labelDefault: "Loading payroll workspace",
			}}
		>
			<PageHeader title={t("payroll.title", "Payroll")} />
			<div className="grid gap-4 md:grid-cols-3">
				<Skeleton aria-hidden="true" className="h-28 w-full" />
				<Skeleton aria-hidden="true" className="h-28 w-full" />
				<Skeleton aria-hidden="true" className="h-28 w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-80 w-full" />
		</LoadingRegion>
	);
}

export default function PayrollPage() {
	return (
		<Suspense fallback={<PayrollPageLoading />}>
			<PayrollPageContent />
		</Suspense>
	);
}
