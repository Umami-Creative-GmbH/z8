import { WebhooksPageClient } from "@/components/webhooks/webhooks-page-client";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { getWebhookEndpointsByOrganization } from "@/lib/webhooks";

export default async function WebhooksSettingsPage() {
	const { organizationId } = await requireOrgAdminSettingsAccess();

	// Fetch webhooks for the organization
	const webhooks = await getWebhookEndpointsByOrganization(organizationId);

	return <WebhooksPageClient organizationId={organizationId} webhooks={webhooks} />;
}
