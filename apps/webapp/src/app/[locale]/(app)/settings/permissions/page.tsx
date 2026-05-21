import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";
import { PermissionsPageClient } from "./permissions-page-client";

async function PermissionsPageContent() {
	await connection();

	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (!settingsRouteContext || settingsRouteContext.accessTier === "member") {
		redirect("/settings");
	}

	const organizationId = settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return (
		<PermissionsPageClient
			organizationId={organizationId}
			isOrgAdmin={settingsRouteContext.accessTier === "orgAdmin"}
		/>
	);
}

function PermissionsPageLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-56" />
				<Skeleton className="h-5 w-72" />
				<Skeleton className="h-[420px] w-full" />
			</div>
		</div>
	);
}

export default function PermissionsPage() {
	return (
		<Suspense fallback={<PermissionsPageLoading />}>
			<PermissionsPageContent />
		</Suspense>
	);
}
