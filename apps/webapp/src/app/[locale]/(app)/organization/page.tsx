import { connection } from "next/server";
import { Suspense } from "react";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsAccessTier } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { getOrgExplorerData } from "./actions";
import { OrgExplorerClient } from "./org-explorer-client";
import { OrgExplorerHeader, OrgExplorerRetry } from "./org-explorer-header";

async function OrganizationPageContent() {
	// The Effect runtime must execute per request outside the prerendered shell.
	await connection();
	const [t, result, accessTier] = await Promise.all([
		getTranslate(),
		getOrgExplorerData(),
		getCurrentSettingsAccessTier(),
	]);
	if (!result.success) {
		if (result.code === "NotFoundError") {
			return (
				<NoEmployeeError
					feature={t("organization.feature", "explore your organization")}
				/>
			);
		}
		return (
			<Alert variant="destructive" className="max-w-xl">
				<AlertTitle>
					{t("organization.error.title", "Unable to load organization")}
				</AlertTitle>
				<AlertDescription className="space-y-3">
					<p>
						{t(
							"organization.error.description",
							"The organization chart could not be loaded. Please try again.",
						)}
					</p>
					<OrgExplorerRetry />
				</AlertDescription>
			</Alert>
		);
	}
	return (
		<OrgExplorerClient
			key={result.data.viewerEmployeeId}
			canManage={accessTier === "orgAdmin"}
			initialData={result.data}
		/>
	);
}

export default function OrganizationPage() {
	return (
		<div className="@container/main page-frame-full flex min-w-0 flex-1 flex-col gap-6">
			<OrgExplorerHeader />
			<Suspense
				fallback={
					<div role="status" aria-busy="true" className="space-y-4">
						<Skeleton className="h-12 w-full" />
						<Skeleton className="h-[60dvh] w-full" />
					</div>
				}
			>
				<OrganizationPageContent />
			</Suspense>
		</div>
	);
}
