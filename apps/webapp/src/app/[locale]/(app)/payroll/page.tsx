import { DateTime } from "luxon";
import { connection } from "next/server";
import { PayrollWorkspace } from "@/components/payroll/payroll-workspace";
import { getTranslate } from "@/tolgee/server";
import {
	getConfiguredPayrollExportFormatsAction,
	getPayrollWorkspaceSummaryAction,
} from "./actions";
import { PayrollFailureState } from "./payroll-failure-state";

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
		return <PayrollFailureState code={summaryResult.code} t={t} />;
	}

	return (
		<PayrollWorkspace
			initialSummary={summaryResult.data}
			exportFormats={formatsResult.success ? formatsResult.data : []}
		/>
	);
}
