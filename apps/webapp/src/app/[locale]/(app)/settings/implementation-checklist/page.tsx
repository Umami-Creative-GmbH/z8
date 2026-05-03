import { connection } from "next/server";

import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";

import { loadImplementationChecklistForContext } from "./actions";
import { ImplementationChecklistClient } from "./implementation-checklist-client";

export const metadata = {
	title: "Implementation Checklist",
	description: "Track customer implementation readiness before inviting the full team.",
};

export default async function ImplementationChecklistPage() {
	await connection();
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
