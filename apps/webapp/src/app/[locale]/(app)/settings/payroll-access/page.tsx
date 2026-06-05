import { connection } from "next/server";
import { PayrollAccessForm } from "@/components/settings/payroll-access/payroll-access-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPayrollAccessAdminDataAction } from "./actions";

export default async function PayrollAccessSettingsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const result = await getPayrollAccessAdminDataAction();

	if (!result.success) {
		return (
			<div className="space-y-6">
				<Card>
					<CardHeader>
						<CardTitle>Admin access required</CardTitle>
						<CardDescription>
							Only organization admins can manage payroll access grants.
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
				<h1 className="text-3xl font-semibold tracking-tight">Payroll access</h1>
				<p className="text-muted-foreground">
					Control which employees and teams payroll users can work with inside payroll workflows.
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
