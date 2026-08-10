import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

import { ImplementationChecklistClient } from "./implementation-checklist-client";
import { loadImplementationChecklistForContext } from "./queries";

export const metadata = {
	title: "Implementation Checklist",
	description:
		"Track customer implementation readiness before inviting the full team.",
};

async function ImplementationChecklistPageContent() {
	const accessContext = await requireOrgAdminSettingsAccess();

	const result = await loadImplementationChecklistForContext(accessContext);

	if (!result.success) {
		throw new Error(result.error);
	}

	return (
		<div className="flex-1 p-6">
			<div className="mx-auto max-w-4xl">
				<ImplementationChecklistClient checklist={result.data} />
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
