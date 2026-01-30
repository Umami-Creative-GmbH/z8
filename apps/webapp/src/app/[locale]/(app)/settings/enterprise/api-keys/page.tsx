import { redirect } from "next/navigation";
import { ApiKeyPageClient } from "@/components/enterprise/api-key-page-client";
import { requireUser } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { listApiKeys } from "./actions";

export default async function ApiKeysPage() {
	const [authContext, t] = await Promise.all([requireUser(), getTranslate()]);

	// Require admin role for this page
	if (authContext.employee?.role !== "admin") {
		redirect("/settings");
	}

	const organizationId = authContext.employee?.organizationId;

	if (!organizationId) {
		return (
			<div className="flex-1 p-6">
				<div className="mx-auto max-w-4xl">
					<h1 className="text-2xl font-semibold">
						{t("settings.apiKeys.noOrg.title", "No Organization")}
					</h1>
					<p className="text-muted-foreground mt-2">
						{t(
							"settings.apiKeys.noOrg.description",
							"You need to be part of an organization to manage API keys.",
						)}
					</p>
				</div>
			</div>
		);
	}

	// Fetch API keys for the organization
	const apiKeysResult = await listApiKeys(organizationId);
	const apiKeys = apiKeysResult.success ? apiKeysResult.data : [];

	return (
		<ApiKeyPageClient
			organizationId={organizationId}
			initialApiKeys={apiKeys}
			currentUserId={authContext.user.id}
		/>
	);
}
