"use client";

import {
	IconDots,
	IconEdit,
	IconHistory,
	IconPlayerPlay,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	deleteWebhook,
	regenerateSecret,
	testWebhook,
	updateWebhook,
} from "@/app/[locale]/(app)/settings/webhooks/actions";
import {
	AlertDialog,
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
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { PublicWebhookEndpoint, WebhookEndpoint } from "@/lib/webhooks/types";
import { useRouter } from "@/navigation";
import { WebhookDeliveryLogsDialog } from "./webhook-delivery-logs-dialog";
import { webhookEndpointLabel } from "./webhook-endpoint-label";
import { WebhookFormDialog } from "./webhook-form-dialog";
import { WebhookSecretDialog } from "./webhook-secret-dialog";

interface WebhookEndpointCardProps {
	webhook: PublicWebhookEndpoint;
	/** Current list snapshot must still accept command completion. Server authorization is unchanged. */
	canComplete?: () => boolean;
	onUpdated: (webhook: WebhookEndpoint) => void;
	onDeleted: (webhookId: string) => void;
}

function useWebhookEndpointCard({
	webhook,
	onUpdated,
	onDeleted,
	canComplete,
}: WebhookEndpointCardProps) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [isRefreshing, startTransition] = useTransition();
	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [isLogsDialogOpen, setIsLogsDialogOpen] = useState(false);
	const [isSecretDialogOpen, setIsSecretDialogOpen] = useState(false);
	const [newSecret, setNewSecret] = useState<string | null>(null);

	const life = useRef<object | null>(null);
	const pending = useRef(false);
	const [commandPending, setCommandPending] = useState(false);
	const [commandError, setCommandError] = useState<string | null>(null);
	const isPending = commandPending || isRefreshing;
	useLayoutEffect(() => {
		life.current = {};
		return () => {
			life.current = null;
			// Retiring the owner (unmount or Activity hide) discards a one-time secret, so it never
			// reappears when the endpoint is shown again. Initial state already has no secret.
			setNewSecret(null);
			setIsSecretDialogOpen(false);
		};
	}, []);
	async function runCommand(run: (current: () => boolean) => Promise<void>) {
		if (pending.current || !life.current || (canComplete && !canComplete())) return;
		const owner = life.current;
		const current = () => life.current === owner && (canComplete?.() ?? true);
		pending.current = true;
		setCommandPending(true);
		setCommandError(null);
		return run(current)
			.catch(() => {
				if (current())
					setCommandError(
						t(
							"webhooks:webhooks.command-unknown",
							"Could not confirm the command. Refresh this endpoint before trying again.",
						),
					);
			})
			.finally(() => {
				// Retirement suppresses effects, but only settlement releases the dispatched command.
				pending.current = false;
				setCommandPending(false);
			});
	}

	// Format last delivery time
	const lastDeliveryTime = webhook.lastDeliveredAt
		? Temporal.Instant.fromEpochMilliseconds(webhook.lastDeliveredAt.getTime()).toLocaleString(
				undefined,
				{ timeZone: "UTC", dateStyle: "medium", timeStyle: "short" },
			)
		: null;

	// Get status badge
	const getStatusBadge = () => {
		if (!webhook.isActive) {
			return (
				<Badge variant="secondary">{t("webhooks:webhooks.status.inactive", "Inactive")}</Badge>
			);
		}
		if (webhook.consecutiveFailures >= 5) {
			return (
				<Badge variant="destructive">{t("webhooks:webhooks.status.failing", "Failing")}</Badge>
			);
		}
		if (webhook.consecutiveFailures > 0) {
			return (
				<Badge variant="warning">
					{t("webhooks:webhooks.status.degraded", "Degraded")}
				</Badge>
			);
		}
		if (webhook.totalDeliveries === 0)
			return (
				<Badge variant="outline">
					{t("webhooks:webhooks.status.untried", "No deliveries yet")}
				</Badge>
			);
		return (
			<Badge variant="success">
				{t("webhooks:webhooks.status.healthy", "Healthy")}
			</Badge>
		);
	};

	const handleToggleActive = (checked: boolean) =>
		runCommand(async (current) => {
			const result = await updateWebhook({ webhookId: webhook.id, isActive: checked });
			if (!current()) return;
			if (result.success) {
				onUpdated(result.data.endpoint);
				toast.success(
					checked
						? t("webhooks:webhooks.enabled", "Webhook enabled")
						: t("webhooks:webhooks.disabled", "Webhook disabled"),
				);
				startTransition(() => refresh());
			} else {
				setCommandError(actionErrorMessage(t, result));
			}
		});

	const handleDelete = () =>
		runCommand(async (current) => {
			const result = await deleteWebhook(webhook.id);
			if (!current()) return;
			if (result.success) {
				onDeleted(webhook.id);
				toast.success(t("webhooks:webhooks.deleted", "Webhook deleted"));
				setIsDeleteDialogOpen(false);
				startTransition(() => refresh());
			} else {
				setCommandError(actionErrorMessage(t, result));
			}
		});

	const handleTest = () =>
		runCommand(async (current) => {
			const result = await testWebhook(webhook.id);
			if (!current()) return;
			if (result.success) {
				toast.success(t("webhooks:webhooks.test-queued", "Test webhook queued"));
			} else {
				setCommandError(actionErrorMessage(t, result));
			}
		});

	const handleRegenerateSecret = () =>
		runCommand(async (current) => {
			const result = await regenerateSecret(webhook.id);
			if (!current()) return;
			if (result.success) {
				setNewSecret(result.data.secret);
				setIsSecretDialogOpen(true);
				toast.success(t("webhooks:webhooks.secret-regenerated", "Secret regenerated"));
			} else {
				setCommandError(actionErrorMessage(t, result));
			}
		});

	return {
		t,
		isPending,
		pending,
		commandError,
		getStatusBadge,
		handleToggleActive,
		handleDelete,
		handleTest,
		handleRegenerateSecret,
		isEditDialogOpen,
		setIsEditDialogOpen,
		isDeleteDialogOpen,
		setIsDeleteDialogOpen,
		isLogsDialogOpen,
		setIsLogsDialogOpen,
		isSecretDialogOpen,
		setIsSecretDialogOpen,
		newSecret,
		setNewSecret,
		lastDeliveryTime,
	};
}

export function WebhookEndpointCard(props: WebhookEndpointCardProps) {
	const { webhook, onUpdated } = props;
	const {
		t,
		isPending,
		pending,
		commandError,
		getStatusBadge,
		handleToggleActive,
		handleDelete,
		handleTest,
		handleRegenerateSecret,
		isEditDialogOpen,
		setIsEditDialogOpen,
		isDeleteDialogOpen,
		setIsDeleteDialogOpen,
		isLogsDialogOpen,
		setIsLogsDialogOpen,
		isSecretDialogOpen,
		setIsSecretDialogOpen,
		newSecret,
		setNewSecret,
		lastDeliveryTime,
	} = useWebhookEndpointCard(props);
	const endpointLabel = webhookEndpointLabel(webhook);

	return (
		<>
			<Card>
				<CardHeader className="flex flex-row items-start justify-between gap-y-0 pb-2">
					<div className="min-w-0 space-y-1">
						<div className="flex flex-wrap items-center gap-2">
							<CardTitle className="break-words text-base font-medium">{webhook.name}</CardTitle>
							{getStatusBadge()}
						</div>
						<CardDescription className="break-all font-mono text-xs">{webhook.url}</CardDescription>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Switch
							checked={webhook.isActive}
							onCheckedChange={handleToggleActive}
							disabled={isPending}
							aria-label={t("webhooks:webhooks.toggle-active-named", "Active: {endpoint}", {
								endpoint: endpointLabel,
							})}
						/>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" size="icon" disabled={isPending}>
									<IconDots className="size-4" aria-hidden="true" />
									<span className="sr-only">
										{t("webhooks:webhooks.actions-named", "Actions for {endpoint}", {
											endpoint: endpointLabel,
										})}
									</span>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem disabled={isPending} onClick={handleTest}>
									<IconPlayerPlay className="mr-2 size-4" aria-hidden="true" />
									{t("webhooks:webhooks.test", "Send Test")}
								</DropdownMenuItem>
								<DropdownMenuItem disabled={isPending} onClick={() => setIsLogsDialogOpen(true)}>
									<IconHistory className="mr-2 size-4" aria-hidden="true" />
									{t("webhooks:webhooks.view-logs", "View Logs")}
								</DropdownMenuItem>
								<DropdownMenuItem disabled={isPending} onClick={() => setIsEditDialogOpen(true)}>
									<IconEdit className="mr-2 size-4" aria-hidden="true" />
									{t("common.edit", "Edit")}
								</DropdownMenuItem>
								<DropdownMenuItem disabled={isPending} onClick={handleRegenerateSecret}>
									<IconRefresh className="mr-2 size-4" aria-hidden="true" />
									{t("webhooks:webhooks.regenerate-secret", "Regenerate Secret")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									className="text-destructive"
									onClick={() => setIsDeleteDialogOpen(true)}
								>
									<IconTrash className="mr-2 size-4" aria-hidden="true" />
									{t("common.delete", "Delete")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</CardHeader>
				<CardContent>
					{commandError && !isDeleteDialogOpen ? (
						<p role="alert" className="mb-3 text-sm text-destructive">
							{commandError}
						</p>
					) : null}
					<div className="flex flex-wrap gap-4 text-sm text-muted-foreground tabular-nums">
						<div>
							<span className="font-medium">{t("webhooks:webhooks.events", "Events")}:</span>{" "}
							{(webhook.subscribedEvents as string[]).length}
						</div>
						<div>
							<span className="font-medium">
								{t("webhooks:webhooks.deliveries", "Deliveries")}:
							</span>{" "}
							{webhook.totalDeliveries}
						</div>
						<div>
							<span className="font-medium">{t("webhooks:webhooks.success-rate", "Success")}:</span>{" "}
							{webhook.totalDeliveries > 0
								? `${Math.round((webhook.totalSuccesses / webhook.totalDeliveries) * 100)}%`
								: "-"}
						</div>
						{lastDeliveryTime && (
							<div>
								<span className="font-medium">{t("webhooks:webhooks.last-delivery", "Last")}:</span>{" "}
								{lastDeliveryTime}
							</div>
						)}
					</div>
				</CardContent>
			</Card>

			<WebhookFormDialog
				webhook={webhook}
				open={isEditDialogOpen}
				onOpenChange={setIsEditDialogOpen}
				onSuccess={onUpdated}
				canComplete={props.canComplete}
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

			<AlertDialog
				open={isDeleteDialogOpen}
				onOpenChange={(open) => {
					if (!pending.current) setIsDeleteDialogOpen(open);
				}}
			>
				<AlertDialogContent
					onEscapeKeyDown={(event) => {
						if (pending.current) event.preventDefault();
					}}
				>
					<AlertDialogHeader>
						<AlertDialogTitle className="break-words">
							{t("webhooks:webhooks.delete-confirm.title-named", "Delete webhook {name}?", {
								name: endpointLabel,
							})}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"webhooks:webhooks.delete-confirm.description",
								"This will permanently delete the webhook endpoint and all delivery history. This action cannot be undone.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					{commandError ? (
						<p role="alert" className="text-sm text-destructive">
							{commandError}
						</p>
					) : null}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isPending}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<Button variant="destructive" disabled={isPending} onClick={handleDelete}>
							{t("common.delete", "Delete")}
						</Button>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
