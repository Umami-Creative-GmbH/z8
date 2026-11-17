"use client";

import { useTranslate } from "@tolgee/react";
import { Activity } from "react";
import { ApiKeyPageClient } from "@/components/enterprise/api-key-page-client";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { WebhooksPageClient } from "@/components/webhooks/webhooks-page-client";
import { useSession } from "@/lib/auth-client";
import type { SettingsAccess } from "@/lib/organization-action/settings-access-level";
import type { ApiKeyResponse } from "@/lib/validations/api-key";
import type { PublicWebhookEndpoint } from "@/lib/webhooks/types";
import { useDeveloperSnapshotArrivals } from "./use-developer-server-snapshot";

export interface DeveloperAccessProps {
	organizationId: string;
	currentUserId: string;
	settingsAccess: SettingsAccess;
	initialApiKeys: ApiKeyResponse[];
	initialKeysError: boolean;
	initialWebhooks: PublicWebhookEndpoint[];
	initialWebhooksError: boolean;
}

export function DeveloperAccessClient(props: DeveloperAccessProps) {
	useDeveloperSnapshotArrivals({
		organizationId: props.organizationId,
		userId: props.currentUserId,
		apiKeys: props.initialApiKeys,
		webhooks: props.initialWebhooks,
	});
	const { t } = useTranslate();
	const context = useOrganization();
	const session = useSession();
	const title = t("settings.navigation.developerAccess.title", "Developer Access");
	const sameSession =
		session.data?.user.id === props.currentUserId &&
		session.data.session.activeOrganizationId === props.organizationId;
	const sameContext =
		context.userId === props.currentUserId && context.activeOrganizationId === props.organizationId;
	const ready =
		sameSession && sameContext && !session.isPending && !context.error && !context.isLoading;

	return (
		<>
			{!ready ? (
				<div className="space-y-6 p-4 md:p-6">
					<PageHeader title={title} />
					{context.error ? (
						<Alert>
							<AlertTitle>
								{t("settings.apiKeys.contextUnavailable", "Organization context unavailable")}
							</AlertTitle>
							<AlertDescription>
								{t(
									"settings.apiKeys.contextRetry",
									"Refresh your organization context to continue.",
								)}
								<Button variant="outline" onClick={() => void context.refetch()}>
									{t("common.retry", "Retry")}
								</Button>
							</AlertDescription>
						</Alert>
					) : (
						<LoadingRegion
							label={{ labelKey: "settings.loading", labelDefault: "Loading settings" }}
						/>
					)}
				</div>
			) : null}
			<Activity mode={ready ? "visible" : "hidden"}>
				{sameSession && sameContext ? (
					<SettingsTabbedPage
						key={JSON.stringify([
							props.currentUserId,
							props.organizationId,
							context.employeeId,
							context.role,
							props.settingsAccess,
						])}
						title={title}
						defaultTab="keys"
						tabs={[
							{
								value: "keys",
								label: t("settings.apiKeys.title", "API Keys"),
								description: t(
									"settings.apiKeys.description",
									"Create and manage API keys for programmatic access to your organization data.",
								),
								panel: (
									<ApiKeyPageClient
										organizationId={props.organizationId}
										currentUserId={props.currentUserId}
										initialApiKeys={props.initialApiKeys}
										initialError={props.initialKeysError}
									/>
								),
							},
							{
								value: "webhooks",
								label: t("settings.webhooks.title", "Webhooks"),
								description: t(
									"settings.webhooks.description",
									"Configure webhook endpoints to receive real-time event notifications",
								),
								panel: (
									<WebhooksPageClient
										webhooks={props.initialWebhooks}
										initialError={props.initialWebhooksError}
										organizationId={props.organizationId}
										currentUserId={props.currentUserId}
									/>
								),
							},
						]}
					/>
				) : null}
			</Activity>
		</>
	);
}
