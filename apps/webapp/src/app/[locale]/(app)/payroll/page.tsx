import { DateTime } from "luxon";
import { connection } from "next/server";
import { Suspense } from "react";
import { PayrollWorkspace } from "@/components/payroll/payroll-workspace";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslate } from "@/tolgee/server";
import {
	getConfiguredPayrollExportFormatsAction,
	getPayrollWorkspaceSummaryAction,
} from "./actions";
import { PayrollFailureState } from "./payroll-failure-state";

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

	const [t, summaryResult, formatsResult] = await Promise.all([
		getTranslate(),
		getPayrollWorkspaceSummaryAction(initialRequest),
		getConfiguredPayrollExportFormatsAction(),
	]);

	if (!summaryResult.success) {
		return <PayrollFailureState code={summaryResult.code} t={t} />;
	}

	return (
		<PayrollWorkspace
			initialSummary={summaryResult.data}
			exportFormats={formatsResult.success ? formatsResult.data : []}
		/>
	);
}

function PayrollPageLoading() {
	return (
		<div
			className="@container/main flex flex-1 flex-col gap-6 p-4 md:p-6"
			role="status"
			aria-label="Loading payroll workspace"
		>
			<div className="space-y-2">
				<Skeleton aria-hidden="true" className="h-8 w-56" />
				<Skeleton aria-hidden="true" className="h-4 w-96 max-w-full" />
			</div>
			<div className="grid gap-4 md:grid-cols-3">
				<Skeleton aria-hidden="true" className="h-28 w-full" />
				<Skeleton aria-hidden="true" className="h-28 w-full" />
				<Skeleton aria-hidden="true" className="h-28 w-full" />
			</div>
			<Skeleton aria-hidden="true" className="h-80 w-full" />
		</div>
	);
}

export default function PayrollPage() {
	return (
		<Suspense fallback={<PayrollPageLoading />}>
			<PayrollPageContent />
		</Suspense>
	);
}
