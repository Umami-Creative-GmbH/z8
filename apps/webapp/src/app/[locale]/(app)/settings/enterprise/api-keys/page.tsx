import { ApiKeyPageClient } from "@/components/enterprise/api-key-page-client";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getTranslate } from "@/tolgee/server";
import { listApiKeys } from "./actions";

export default async function ApiKeysPage() {
	const [{ authContext, organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);
	void t;

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
