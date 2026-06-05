import { connection } from "next/server";
import { PayrollAccessForm } from "@/components/settings/payroll-access/payroll-access-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getTranslate } from "@/tolgee/server";
import { getPayrollAccessAdminDataAction } from "./actions";

export default async function PayrollAccessSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const t = await getTranslate();
	const result = await getPayrollAccessAdminDataAction();

	if (!result.success) {
		return (
			<div className="space-y-6">
				<Card>
					<CardHeader>
						<CardTitle>
							{t(
								"settings.payrollAccess.deniedTitle",
								"Payroll officer settings access required",
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.payrollAccess.deniedDescription",
								"Only authorized organization admins can manage payroll officers.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<p className="text-sm text-muted-foreground">{result.error}</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<h1 className="text-3xl font-semibold tracking-tight">
					{t("settings.payrollAccess.title", "Payroll Officers")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"settings.payrollAccess.description",
						"Activate payroll officers and assign the teams or employees they can include in payroll workflows.",
					)}
				</p>
			</div>
			<PayrollAccessForm
				employees={result.data.employees}
				teams={result.data.teams}
				initialGrants={result.data.grants}
			/>
		</div>
	);
}
