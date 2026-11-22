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

async function TravelExpenseSettingsPageContent() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	return (
		<TravelExpenseSettingsTabs
			key={organizationId}
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
	);
}

function TravelExpenseSettingsPageLoading() {
	return (
		<LoadingRegion
			className="page-frame flex flex-1 flex-col gap-4"
			role="status"
			label={{
				labelKey: "common.loadingRegions.travelExpenseSettings",
				labelDefault: "Loading travel expense settings",
			}}
		>
			<div className="page-measure space-y-6">
				<div className="space-y-2">
					<Skeleton className="h-8 w-56" aria-hidden="true" />
					<Skeleton className="h-4 w-full max-w-xl" aria-hidden="true" />
				</div>
				<Skeleton className="h-9 w-full max-w-md" aria-hidden="true" />
				<Skeleton className="h-64 w-full" aria-hidden="true" />
			</div>
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
