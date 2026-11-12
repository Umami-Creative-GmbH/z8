import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

import { GoLiveRehearsalProvider } from "./go-live-rehearsal";
import { ImplementationChecklistClient } from "./implementation-checklist-client";
import { loadImplementationChecklistForContext } from "./queries";

export const metadata = {
	title: "Implementation Checklist",
	description: "Track customer implementation readiness before inviting the full team.",
};

async function ImplementationChecklistPageContent() {
	const { authContext, organizationId } = await requireOrgAdminSettingsAccess();

	const checklist = await loadImplementationChecklistForContext({
		organizationId,
		userId: authContext.user.id,
	});

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl">
				<GoLiveRehearsalProvider candidates={checklist.goLive.rehearsalCandidates}>
					<ImplementationChecklistClient checklist={checklist} />
				</GoLiveRehearsalProvider>
			</div>
		</div>
	);
}

function ImplementationChecklistPageLoading() {
	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl space-y-4">
				<Skeleton className="h-8 w-64" />
				<Skeleton className="h-64 w-full" />
			</div>
		</div>
	);
}

export default function ImplementationChecklistPage() {
	return (
		<Suspense fallback={<ImplementationChecklistPageLoading />}>
			<ImplementationChecklistPageContent />
		</Suspense>
	);
}
