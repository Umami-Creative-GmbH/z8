import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getTranslate } from "@/tolgee/server";
import { getOrgChartInitialGraph } from "./actions";
import { OrgChartClient } from "./org-chart-client";

export default async function OrganizationPage() {
	await connection();

	const [t, result] = await Promise.all([getTranslate(), getOrgChartInitialGraph()]);

	if (!result.success) {
		if (result.code === "NotFoundError") {
			return (
				<div className="@container/main flex flex-1 items-center justify-center p-6">
					<NoEmployeeError feature={t("organization.feature", "explore your organization")} />
				</div>
			);
		}

		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<Alert variant="destructive" className="max-w-xl">
					<AlertTitle>{t("organization.error.title", "Unable to load organization")}</AlertTitle>
					<AlertDescription>
						{t(
							"organization.error.description",
							"The organization chart could not be loaded. Please try again.",
						)}
					</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="px-4 lg:px-6">
				<h1 className="text-3xl font-bold tracking-tight">
					{t("organization.title", "Org Explorer")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"organization.description",
						"Explore direct managers, teams, and reporting relationships in your organization.",
					)}
				</p>
			</div>

			<div className="min-h-[680px] px-4 lg:px-6">
				<OrgChartClient initialGraph={result.data} />
			</div>
		</div>
	);
}
