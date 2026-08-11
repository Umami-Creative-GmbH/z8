import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ReportsContainer } from "@/components/reports/reports-container";
import { Skeleton } from "@/components/ui/skeleton";
import { getTranslate } from "@/tolgee/server";
import { getCurrentEmployee } from "./actions";

async function ReportsPageContent() {
	// Auth is checked in layout
	const [t, employee] = await Promise.all([
		getTranslate(),
		getCurrentEmployee(),
	]);

	if (!employee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("reports.feature", "generate reports")} />
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Page Header */}
			<div className="px-4 lg:px-6">
				<h1 className="text-3xl font-bold tracking-tight">
					{t("reports.title", "Employee Reports")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"reports.description",
						"Generate comprehensive work hour and absence reports with tax-relevant home office data",
					)}
				</p>
			</div>

			{/* Reports Container */}
			<ReportsContainer currentEmployeeId={employee.id} />
		</div>
	);
}

function ReportsPageLoading() {
	return (
		<div
			aria-label="Loading employee reports"
			className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6"
			role="status"
		>
			<div className="space-y-3 px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-9 w-64" />
				<Skeleton aria-hidden="true" className="h-5 w-full max-w-3xl" />
			</div>
			<div className="px-4 lg:px-6">
				<Skeleton aria-hidden="true" className="h-96 w-full" />
			</div>
		</div>
	);
}

export default function ReportsPage() {
	return (
		<Suspense fallback={<ReportsPageLoading />}>
			<ReportsPageContent />
		</Suspense>
	);
}
