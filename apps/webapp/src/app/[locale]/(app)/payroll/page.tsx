import { DateTime } from "luxon";
import { connection } from "next/server";
import { PayrollWorkspace } from "@/components/payroll/payroll-workspace";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslate } from "@/tolgee/server";
import {
	getConfiguredPayrollExportFormatsAction,
	getPayrollWorkspaceSummaryAction,
} from "./actions";

export default async function PayrollPage() {
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
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<Card className="max-w-md text-center">
					<CardHeader>
						<CardTitle>{t("payroll.accessDenied.title", "No payroll access")}</CardTitle>
						<CardDescription>
							{t(
								"payroll.accessDenied.description",
								"You do not have access to payroll data for the active organization.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="text-muted-foreground text-sm">
						{t(
							"payroll.accessDenied.help",
							"Ask an organization administrator to assign payroll access if you need this workspace.",
						)}
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<PayrollWorkspace
			initialSummary={summaryResult.data}
			exportFormats={formatsResult.success ? formatsResult.data : []}
		/>
	);
}
