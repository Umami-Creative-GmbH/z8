import { Suspense } from "react";
import { AllowanceOverridesSettingsCard } from "@/components/settings/travel-expense/allowance-overrides-settings";
import { ExpenseOfficerSettingsCard } from "@/components/settings/travel-expense/expense-officer-settings";
import { ForeignExpenseConversionsCard } from "@/components/settings/travel-expense/foreign-expense-conversions";
import { MileagePolicySettingsCard } from "@/components/settings/travel-expense/mileage-policy-settings";
import { PerDiemPolicySettingsCard } from "@/components/settings/travel-expense/per-diem-policy-settings";
import { ReferenceRateSettingsCard } from "@/components/settings/travel-expense/reference-rate-settings";
import { ReimbursementChannelSettingsCard } from "@/components/settings/travel-expense/reimbursement-channel-settings";
import { ReimbursementCurrencySettingsCard } from "@/components/settings/travel-expense/reimbursement-currency-settings";
import { TravelExpenseApproverSettingsCard } from "@/components/settings/travel-expense/travel-expense-approver-settings";
import { TravelExpensePolicyManagement } from "@/components/settings/travel-expense/travel-expense-policy-management";
import { TravelExpenseProjectExceptionsCard } from "@/components/settings/travel-expense/travel-expense-project-exceptions";
import { TravelExpenseReceiptExceptionSettingsCard } from "@/components/settings/travel-expense/travel-expense-receipt-exception-settings";
import { TravelExpenseSettingsTabs } from "@/components/settings/travel-expense/travel-expense-settings-tabs";
import { OfficerCoverageGapNotice } from "@/components/travel-expenses/finance/officer-coverage-gap";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

async function TravelExpenseSettingsPageContent() {
	const [, t] = await Promise.all([requireOrgAdminSettingsAccess(), getTranslate()]);

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.travelExpenses.title", "Travel Expense Policies")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.travelExpenses.pageDescription",
						"Choose who reviews expense reports, how missing receipts and foreign currencies are handled, which mileage and per diem rates apply, and which exceptions are authorized.",
					)}
				</p>
			</div>
			<TravelExpenseSettingsTabs
				review={
					<>
						<TravelExpenseApproverSettingsCard />
						<TravelExpenseReceiptExceptionSettingsCard />
					</>
				}
				currencies={
					<>
						<ReimbursementChannelSettingsCard />
						<ReimbursementCurrencySettingsCard />
						<ReferenceRateSettingsCard />
					</>
				}
				rates={
					<>
						<MileagePolicySettingsCard />
						<PerDiemPolicySettingsCard />
						<TravelExpensePolicyManagement />
					</>
				}
				exceptions={
					<>
						<ForeignExpenseConversionsCard />
						<TravelExpenseProjectExceptionsCard />
						<AllowanceOverridesSettingsCard />
					</>
				}
				access={
					<>
						<OfficerCoverageGapNotice />
						<ExpenseOfficerSettingsCard />
					</>
				}
			/>
		</div>
	);
}

function TravelExpenseSettingsPageLoading() {
	return (
		<LoadingRegion
			className="flex flex-1 flex-col gap-4 p-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.travelExpenseSettings",
				labelDefault: "Loading travel expense settings",
			}}
		>
			<Skeleton className="h-8 w-48" aria-hidden="true" />
			<Skeleton className="h-64 w-full" aria-hidden="true" />
		</LoadingRegion>
	);
}

export default function TravelExpenseSettingsPage() {
	return (
		<Suspense fallback={<TravelExpenseSettingsPageLoading />}>
			<TravelExpenseSettingsPageContent />
		</Suspense>
	);
}
