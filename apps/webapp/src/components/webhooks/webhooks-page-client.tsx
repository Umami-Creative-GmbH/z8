"use client";

import { IconPlus, IconWebhook } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { useDeveloperServerSnapshot } from "@/app/[locale]/(app)/settings/enterprise/api-keys/use-developer-server-snapshot";
import { readWebhooksForView } from "@/app/[locale]/(app)/settings/enterprise/api-keys/view-actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LoadingRegion } from "@/components/ui/loading-region";
import type { ServerActionResult } from "@/lib/effect/result";
import type { PublicWebhookEndpoint, WebhookEndpoint } from "@/lib/webhooks/types";
import { WebhookEndpointCard } from "./webhook-endpoint-card";
import { WebhookFormDialog } from "./webhook-form-dialog";

interface WebhooksPageClientProps {
	webhooks: PublicWebhookEndpoint[];
	organizationId: string;
	currentUserId: string;
	initialError?: boolean;
}

export function WebhooksPageClient({
	webhooks: initialWebhooks,
	organizationId,
	currentUserId,
	initialError,
}: WebhooksPageClientProps) {
	const { t } = useTranslate();
	const client = useQueryClient();
	const queryKey = ["developerWebhooks", organizationId, currentUserId];
	const initialData = useDeveloperServerSnapshot({
		queryKey: ["developerWebhooks", organizationId, currentUserId],
		snapshot: initialWebhooks,
		initialError,
	});
	const query = useQuery<ServerActionResult<PublicWebhookEndpoint[]>>({
		queryKey,
		initialData,
		retry: false,
		queryFn: async () => {
			const result = await readWebhooksForView({ organizationId, userId: currentUserId });
			if (
				!result.success &&
				result.code !== "AuthorizationError" &&
				result.code !== "AuthenticationError"
			)
				throw new Error("Webhooks unavailable");
			return result;
		},
	});
	const canComplete = () =>
		client.getQueryData<ServerActionResult<PublicWebhookEndpoint[]>>(queryKey)?.success === true;
	const refused = !!query.data && !query.data.success;
	const failed = query.isError || refused;
	const webhooks = query.data?.success ? query.data.data : [];
	const setWebhooks = (update: (previous: PublicWebhookEndpoint[]) => PublicWebhookEndpoint[]) => {
		let accepted = false;
		client.setQueryData<ServerActionResult<PublicWebhookEndpoint[]>>(queryKey, (previous) => {
			if (!previous?.success) return previous;
			accepted = true;
			return { success: true, data: update(previous.data) };
		});
		return accepted;
	};

	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

	const handleWebhookCreated = (webhook: WebhookEndpoint) => {
		const { secret: _secret, ...publicWebhook } = webhook;
		return setWebhooks((prev) => [publicWebhook, ...prev]);
	};

	const handleWebhookUpdated = (webhook: WebhookEndpoint) => {
		const { secret: _secret, ...publicWebhook } = webhook;
		return setWebhooks((prev) => prev.map((w) => (w.id === webhook.id ? publicWebhook : w)));
	};

	const handleWebhookDeleted = (webhookId: string) => {
		setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
	};

	return (
		<div className="min-w-0">
			<div>
				{/* The page heading already describes this tab; this row names the section, as on the API keys tab. */}
				<div className="mb-6 flex flex-wrap items-end justify-between gap-4">
					<div className="min-w-0">
						<h2 className="text-lg font-semibold">{t("webhooks:webhooks.title", "Webhooks")}</h2>
					</div>
					<Button disabled={failed || query.isPending} onClick={() => setIsCreateDialogOpen(true)}>
						<IconPlus className="mr-2 size-4" aria-hidden="true" />
						{t("webhooks:webhooks.create", "Add Webhook")}
					</Button>
				</div>
				<Card>
					<CardContent className="space-y-4 pt-6">
						{failed ? (
							<Alert variant="destructive">
								<AlertTitle>
									{t("webhooks:webhooks.unavailable", "Webhooks unavailable")}
								</AlertTitle>
								<AlertDescription>
									{t(
										"webhooks:webhooks.retry-help",
										"Refresh this list to confirm the current endpoints. Previously loaded records are retained.",
									)}
									<Button
										variant="outline"
										disabled={query.isFetching}
										onClick={() => void query.refetch()}
									>
										{t("common.retry", "Retry")}
									</Button>
								</AlertDescription>
							</Alert>
						) : null}
						{query.isPending ? (
							<LoadingRegion
								label={{ labelKey: "settings.loading", labelDefault: "Loading settings" }}
							/>
						) : failed && webhooks.length === 0 ? null : webhooks.length === 0 ? (
							<div className="flex flex-col items-start gap-3 py-2">
								<div className="flex items-center gap-2">
									<IconWebhook className="size-5 text-muted-foreground" aria-hidden="true" />
									<h3 className="font-medium">
										{t("webhooks:webhooks.empty.title", "No webhooks configured")}
									</h3>
								</div>
								<p className="text-sm text-muted-foreground">
									{t(
										"webhooks:webhooks.empty.description",
										"Create your first webhook to start receiving event notifications.",
									)}
								</p>
								<Button onClick={() => setIsCreateDialogOpen(true)}>
									<IconPlus className="mr-2 size-4" aria-hidden="true" />
									{t("webhooks:webhooks.create", "Add Webhook")}
								</Button>
							</div>
						) : (
							<div className="space-y-4">
								{webhooks.map((webhook) => (
									<WebhookEndpointCard
										key={webhook.id}
										webhook={webhook}
										canComplete={canComplete}
										onUpdated={handleWebhookUpdated}
										onDeleted={handleWebhookDeleted}
									/>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</div>

			<WebhookFormDialog
				open={isCreateDialogOpen && !refused}
				canComplete={canComplete}
				actionAvailable={!refused}
				onOpenChange={setIsCreateDialogOpen}
				onSuccess={handleWebhookCreated}
			/>
		</div>
	);
}
