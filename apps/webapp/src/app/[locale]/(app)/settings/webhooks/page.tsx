import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import * as authSchema from "@/db/auth-schema";
import { requireUser } from "@/lib/auth-helpers";
import { getWebhookEndpointsByOrganization } from "@/lib/webhooks";
import { WebhooksPageClient } from "@/components/webhooks/webhooks-page-client";

export default async function WebhooksSettingsPage() {
	const authContext = await requireUser();

	const organizationId = authContext.session.activeOrganizationId;
	if (!organizationId) {
		redirect("/");
	}

	// Get member record to check role
	const memberRecord = await db.query.member.findFirst({
		where: and(
			eq(authSchema.member.userId, authContext.user.id),
			eq(authSchema.member.organizationId, organizationId),
		),
	});

	// Only owners can access webhooks
	if (memberRecord?.role !== "owner") {
		redirect("/settings");
	}

	// Fetch webhooks for the organization
	const webhooks = await getWebhookEndpointsByOrganization(organizationId);

	return <WebhooksPageClient organizationId={organizationId} webhooks={webhooks} />;
}
