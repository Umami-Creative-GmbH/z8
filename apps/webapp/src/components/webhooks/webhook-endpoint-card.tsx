"use client";

import {
	IconCheck,
	IconCopy,
	IconDots,
	IconEdit,
	IconHistory,
	IconPlayerPlay,
	IconRefresh,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
	deleteWebhook,
	regenerateSecret,
	testWebhook,
	updateWebhook,
} from "@/app/[locale]/(app)/settings/webhooks/actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import type { WebhookEndpoint } from "@/lib/webhooks/types";
import { useRouter } from "@/navigation";
import { WebhookDeliveryLogsDialog } from "./webhook-delivery-logs-dialog";
import { WebhookFormDialog } from "./webhook-form-dialog";
import { WebhookSecretDialog } from "./webhook-secret-dialog";

interface WebhookEndpointCardProps {
	webhook: WebhookEndpoint;
	onUpdated: (webhook: WebhookEndpoint) => void;
	onDeleted: (webhookId: string) => void;
}

export function WebhookEndpointCard({ webhook, onUpdated, onDeleted }: WebhookEndpointCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [isLogsDialogOpen, setIsLogsDialogOpen] = useState(false);
	const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);
	const [newSecret, setNewSecret] = useState<string | null>(null);

	// Mask URL for display
	const maskedUrl = webhook.url.length > 50 ? `${webhook.url.slice(0, 50)}...` : webhook.url;

	// Format last delivery time
	const lastDeliveryTime = webhook.lastDeliveredAt
		? DateTime.fromJSDate(webhook.lastDeliveredAt).toRelative()
		: null;

	// Get status badge
	const getStatusBadge = () => {
		if (!webhook.isActive) {
			return <Badge variant="secondary">{t("webhooks.status.inactive", "Inactive")}</Badge>;
		}
		if (webhook.consecutiveFailures >= 5) {
			return <Badge variant="destructive">{t("webhooks.status.failing", "Failing")}</Badge>;
		}
		if (webhook.consecutiveFailures > 0) {
			return (
				<Badge variant="outline" className="border-yellow-500 text-yellow-600">
					{t("webhooks.status.degraded", "Degraded")}
				</Badge>
			);
		}
		return (
			<Badge variant="default" className="bg-green-600">
				{t("webhooks.status.healthy", "Healthy")}
			</Badge>
		);
	};

	const handleToggleActive = async (checked: boolean) => {
		const result = await updateWebhook(webhook.id, { isActive: checked });
		if (result.success) {
			onUpdated(result.data.endpoint);
			toast.success(
				checked
					? t("webhooks.enabled", "Webhook enabled")
					: t("webhooks.disabled", "Webhook disabled"),
			);
			startTransition(() => router.refresh());
		} else {
			toast.error(result.error ?? t("webhooks.update-failed", "Failed to update webhook"));
		}
	};

	const handleDelete = async () => {
		const result = await deleteWebhook(webhook.id);
		if (result.success) {
			onDeleted(webhook.id);
			toast.success(t("webhooks.deleted", "Webhook deleted"));
			setIsDeleteDialogOpen(false);
			startTransition(() => router.refresh());
		} else {
			toast.error(result.error ?? t("webhooks.delete-failed", "Failed to delete webhook"));
		}
	};

	const handleTest = async () => {
		const result = await testWebhook(webhook.id);
		if (result.success) {
			toast.success(t("webhooks.test-sent", "Test webhook sent"));
		} else {
			toast.error(result.error ?? t("webhooks.test-failed", "Failed to send test webhook"));
		}
	};

	const handleRegenerateSecret = async () => {
		const result = await regenerateSecret(webhook.id);
		if (result.success) {
			setNewSecret(result.data.secret);
			setIsSecretDialogOpen(true);
			toast.success(t("webhooks.secret-regenerated", "Secret regenerated"));
		} else {
			toast.error(result.error ?? t("webhooks.regenerate-failed", "Failed to regenerate secret"));
		}
	};

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
					<div className="space-y-1">
						<div className="flex items-center gap-2">
							<CardTitle className="text-base font-medium">{webhook.name}</CardTitle>
							{getStatusBadge()}
						</div>
						<CardDescription className="font-mono text-xs">{maskedUrl}</CardDescription>
					</div>
					<div className="flex items-center gap-2">
						<Switch
							checked={webhook.isActive}
							onCheckedChange={handleToggleActive}
							disabled={isPending}
							aria-label={t("webhooks.toggle-active", "Toggle webhook active")}
						/>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon">
									<IconDots className="h-4 w-4" aria-hidden="true" />
									<span className="sr-only">{t("common.actions", "Actions")}</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem onClick={handleTest}>
									<IconPlayerPlay className="mr-2 h-4 w-4" aria-hidden="true" />
									{t("webhooks.test", "Send Test")}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => setIsLogsDialogOpen(true)}>
									<IconHistory className="mr-2 h-4 w-4" aria-hidden="true" />
									{t("webhooks.view-logs", "View Logs")}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={() => setIsEditDialogOpen(true)}>
									<IconEdit className="mr-2 h-4 w-4" aria-hidden="true" />
									{t("common.edit", "Edit")}
								</DropdownMenuItem>
								<DropdownMenuItem onClick={handleRegenerateSecret}>
									<IconRefresh className="mr-2 h-4 w-4" aria-hidden="true" />
									{t("webhooks.regenerate-secret", "Regenerate Secret")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive"
									onClick={() => setIsDeleteDialogOpen(true)}
								>
									<IconTrash className="mr-2 h-4 w-4" aria-hidden="true" />
									{t("common.delete", "Delete")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</CardHeader>
				<CardContent>
					<div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
						<div>
							<span className="font-medium">{t("webhooks.events", "Events")}:</span>{" "}
							{(webhook.subscribedEvents as string[]).length}
						</div>
						<div>
							<span className="font-medium">{t("webhooks.deliveries", "Deliveries")}:</span>{" "}
							{webhook.totalDeliveries}
						</div>
						<div>
							<span className="font-medium">{t("webhooks.success-rate", "Success")}:</span>{" "}
							{webhook.totalDeliveries > 0
								? `${Math.round((webhook.totalSuccesses / webhook.totalDeliveries) * 100)}%`
								: "-"}
						</div>
						{lastDeliveryTime && (
							<div>
								<span className="font-medium">{t("webhooks.last-delivery", "Last")}:</span>{" "}
								{lastDeliveryTime}
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			<WebhookFormDialog
				organizationId={webhook.organizationId}
				webhook={webhook}
				open={isEditDialogOpen}
				onOpenChange={setIsEditDialogOpen}
				onSuccess={(updated) => {
					onUpdated(updated);
					setIsEditDialogOpen(false);
				}}
			/>

			<WebhookDeliveryLogsDialog
				webhookId={webhook.id}
				webhookName={webhook.name}
				open={isLogsDialogOpen}
				onOpenChange={setIsLogsDialogOpen}
			/>

			<WebhookSecretDialog
				secret={newSecret}
				open={isSecretDialogOpen}
				onOpenChange={(open) => {
					setIsSecretDialogOpen(open);
					if (!open) setNewSecret(null);
				}}
			/>

			<AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("webhooks.delete-confirm.title", "Delete webhook?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"webhooks.delete-confirm.description",
								"This will permanently delete the webhook endpoint and all delivery history. This action cannot be undone.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
