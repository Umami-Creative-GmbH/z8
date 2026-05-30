import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ApprovalPolicyManagement } from "@/components/settings/approval-policy/approval-policy-management";
import { Skeleton } from "@/components/ui/skeleton";
import { getCurrentSettingsRouteContext } from "@/lib/auth-helpers";

async function ApprovalPoliciesSettingsContent() {
	await connection();

	const settingsRouteContext = await getCurrentSettingsRouteContext();

	if (settingsRouteContext?.accessTier !== "orgAdmin") {
		redirect("/settings");
	}

	const organizationId =
		settingsRouteContext.authContext.session.activeOrganizationId;

	if (!organizationId) {
		redirect("/settings");
	}

	return <ApprovalPolicyManagement organizationId={organizationId} />;
}

function ApprovalPoliciesSettingsLoading() {
	return (
		<div className="p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-5 w-96" />
				<Skeleton className="h-[420px] w-full" />
			</div>
		</div>
	);
}

export default function ApprovalPoliciesSettingsPage() {
	return (
		<Suspense fallback={<ApprovalPoliciesSettingsLoading />}>
			<ApprovalPoliciesSettingsContent />
		</Suspense>
	);
}
