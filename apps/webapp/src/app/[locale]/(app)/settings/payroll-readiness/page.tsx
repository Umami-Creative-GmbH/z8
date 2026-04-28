import { connection } from "next/server";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";

export const metadata = {
	title: "Payroll Readiness",
	description: "Check whether a payroll period is ready before export",
};

export default async function PayrollReadinessPage() {
	await connection();
	await requireOrgAdminSettingsAccess();
	const t = await getTranslate();

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold">
					{t("settings.payrollReadiness.title", "Payroll Readiness")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.payrollReadiness.description",
						"Check whether a payroll period is ready before exporting time, absence, and payroll data.",
					)}
				</p>
			</div>
		</div>
	);
}
