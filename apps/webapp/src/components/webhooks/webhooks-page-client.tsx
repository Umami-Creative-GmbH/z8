"use client";

import { IconPlus, IconWebhook } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WebhookEndpoint } from "@/lib/webhooks/types";
import { WebhookEndpointCard } from "./webhook-endpoint-card";
import { WebhookFormDialog } from "./webhook-form-dialog";

interface WebhooksPageClientProps {
	organizationId: string;
	webhooks: WebhookEndpoint[];
}

export function WebhooksPageClient({
	organizationId,
	webhooks: initialWebhooks,
}: WebhooksPageClientProps) {
	const { t } = useTranslate();
	const [webhooks, setWebhooks] = useState(initialWebhooks);
	const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

	const handleWebhookCreated = (webhook: WebhookEndpoint) => {
		setWebhooks((prev) => [webhook, ...prev]);
	};

	const handleWebhookUpdated = (webhook: WebhookEndpoint) => {
		setWebhooks((prev) => prev.map((w) => (w.id === webhook.id ? webhook : w)));
	};

	const handleWebhookDeleted = (webhookId: string) => {
		setWebhooks((prev) => prev.filter((w) => w.id !== webhookId));
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
					<div className="space-y-1">
						<CardTitle className="flex items-center gap-2">
							<IconWebhook className="h-5 w-5" />
							{t("webhooks.title", "Webhooks")}
						</CardTitle>
						<CardDescription>
							{t(
								"webhooks.description",
								"Configure webhook endpoints to receive real-time notifications when events occur in your organization.",
							)}
						</CardDescription>
					</div>
					<Button onClick={() => setIsCreateDialogOpen(true)}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("webhooks.create", "Add Webhook")}
					</Button>
				</CardHeader>
				<CardContent>
					{webhooks.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<IconWebhook className="h-12 w-12 text-muted-foreground/50" />
							<h3 className="mt-4 text-lg font-semibold">
								{t("webhooks.empty.title", "No webhooks configured")}
							</h3>
							<p className="mt-2 text-sm text-muted-foreground">
								{t(
									"webhooks.empty.description",
									"Create your first webhook to start receiving event notifications.",
								)}
							</p>
							<Button className="mt-4" onClick={() => setIsCreateDialogOpen(true)}>
								<IconPlus className="mr-2 h-4 w-4" />
								{t("webhooks.create", "Add Webhook")}
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

			<WebhookFormDialog
				organizationId={organizationId}
				open={isCreateDialogOpen}
				onOpenChange={setIsCreateDialogOpen}
				onSuccess={handleWebhookCreated}
			/>
		</div>
	);
}
