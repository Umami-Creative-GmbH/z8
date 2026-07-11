"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { DeliveryLogsPagination } from "./delivery-logs-pagination";
import { DeliveryLogsTable } from "./delivery-logs-table";
import { useWebhookDeliveryLogs } from "./use-webhook-delivery-logs";

interface WebhookDeliveryLogsDialogProps {
	webhookId: string;
	webhookName: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function WebhookDeliveryLogsDialog({
	webhookId,
	webhookName,
	open,
	onOpenChange,
}: WebhookDeliveryLogsDialogProps) {
	const { t } = useTranslate();
	const logs = useWebhookDeliveryLogs(webhookId, open);
	const errorMessage =
		logs.errorMessage || t("webhooks:webhooks.logs.loadError", "Failed to load delivery logs");

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("webhooks:webhooks.logs.title", "Delivery Logs")} - {webhookName}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"webhooks:webhooks.logs.description",
							"Recent webhook delivery attempts and their results.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody>
					{(logs.isLoading || logs.shouldShowInitialLoading) && logs.deliveries.length === 0 ? (
						<div className="flex items-center justify-center py-12">
							<IconLoader2
								className="size-8 animate-spin text-muted-foreground"
								aria-hidden="true"
							/>
							<span className="sr-only">{t("common.loading", "Loading...")}</span>
						</div>
					) : logs.hasRequestError ? (
						<div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
							<p className="text-destructive">{errorMessage}</p>
							<Button variant="outline" size="sm" onClick={logs.retry}>
								{t("common.retry", "Retry")}
							</Button>
						</div>
					) : logs.deliveries.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<p className="text-muted-foreground">
								{t("webhooks:webhooks.logs.empty", "No delivery logs yet")}
							</p>
						</div>
					) : (
						<DeliveryLogsTable
							deliveries={logs.deliveries}
							expandedRows={logs.expandedRows}
							onToggleRow={logs.toggleRow}
						/>
					)}
				</ActionPanelBody>

				<DeliveryLogsPagination
					deliveriesCount={logs.deliveries.length}
					total={logs.total}
					offset={logs.offset}
					isLoading={logs.isLoading}
					onOffsetChange={logs.setOffset}
				/>
			</ActionPanelContent>
		</ActionPanel>
	);
}
