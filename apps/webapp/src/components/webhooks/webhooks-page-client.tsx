"use client";

import { IconPlus, IconWebhook } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
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
	const query = useQuery<ServerActionResult<PublicWebhookEndpoint[]>>({
		queryKey,
		initialData: initialError ? undefined : { success: true, data: initialWebhooks },
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
	const refused = !!query.data && !query.data.success;
	const failed = query.isError || refused;
	const webhooks = query.data?.success ? query.data.data : [];
	const setWebhooks = (update: (previous: PublicWebhookEndpoint[]) => PublicWebhookEndpoint[]) =>
		client.setQueryData<ServerActionResult<PublicWebhookEndpoint[]>>(queryKey, (previous) => ({
			success: true,
			data: update(previous?.success ? previous.data : []),
		}));
	useEffect(() => {
		if (!initialError)
			client.setQueryData(["developerWebhooks", organizationId, currentUserId], {
				success: true,
				data: initialWebhooks,
			});
	}, [client, initialWebhooks, initialError, organizationId, currentUserId]);

	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

	const handleWebhookCreated = (webhook: WebhookEndpoint) => {
		const { secret: _secret, ...publicWebhook } = webhook;
		setWebhooks((prev) => [publicWebhook, ...prev]);
	};

	const handleWebhookUpdated = (webhook: WebhookEndpoint) => {
		const { secret: _secret, ...publicWebhook } = webhook;
		setWebhooks((prev) => prev.map((w) => (w.id === webhook.id ? publicWebhook : w)));
	};

	const handleWebhookDeleted = (webhookId: string) => {
		setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
	};

	return (
		<div className="min-w-0">
			<div className="mx-auto max-w-7xl">
				<div className="mb-6 flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-lg font-semibold">{t("webhooks:webhooks.title", "Webhooks")}</h2>
						<p className="text-muted-foreground">
							{t(
								"webhooks:webhooks.description",
								"Configure webhook endpoints to receive real-time notifications when events occur in your organization.",
							)}
						</p>
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
							<div className="flex flex-col items-center justify-center py-12 text-center">
								<IconWebhook className="size-12 text-muted-foreground/50" aria-hidden="true" />
								<h3 className="mt-4 text-lg font-semibold">
									{t("webhooks:webhooks.empty.title", "No webhooks configured")}
								</h3>
								<p className="mt-2 text-sm text-muted-foreground">
									{t(
										"webhooks:webhooks.empty.description",
										"Create your first webhook to start receiving event notifications.",
									)}
								</p>
								<Button className="mt-4" onClick={() => setIsCreateDialogOpen(true)}>
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
				onOpenChange={setIsCreateDialogOpen}
				onSuccess={handleWebhookCreated}
			/>
		</div>
	);
}
