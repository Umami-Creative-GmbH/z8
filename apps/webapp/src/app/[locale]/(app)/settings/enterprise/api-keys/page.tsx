import { Suspense } from "react";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getWebhookEndpointsByOrganization } from "@/lib/webhooks/webhook-service";
import { listApiKeys } from "./actions";
import { DeveloperAccessLoading } from "./loading-content";
import { DeveloperAccessClient } from "./page-client";

async function DeveloperSettingsContent() {
	const [{ authContext, organizationId, settingsAccess }] = await Promise.all([
		requireOrgAdminSettingsAccess(),
	]);

	// Fetch API keys for the organization
	const [keys, endpoints] = await Promise.allSettled([
		listApiKeys(),
		getWebhookEndpointsByOrganization(organizationId),
	]);
	const result = keys.status === "fulfilled" ? keys.value : null;
	return (
		<DeveloperAccessClient
			organizationId={organizationId}
			currentUserId={authContext.user.id}
			settingsAccess={settingsAccess}
			initialKeysError={!result?.success}
			initialApiKeys={result?.success ? result.data : []}
			initialWebhooks={endpoints.status === "fulfilled" ? endpoints.value : []}
			initialWebhooksError={endpoints.status === "rejected"}
		/>
	);
}
export default function DeveloperSettingsPage() {
	return (
		<Suspense fallback={<DeveloperAccessLoading />}>
			<DeveloperSettingsContent />
		</Suspense>
	);
}
