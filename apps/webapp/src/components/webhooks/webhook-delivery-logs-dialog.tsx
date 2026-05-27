"use client";

import { IconCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { getWebhookDeliveryLogs } from "@/app/[locale]/(app)/settings/webhooks/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import type { WebhookDelivery } from "@/lib/webhooks/types";

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
	const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
	const [total, setTotal] = useState(0);
	const [isLoading, setIsLoading] = useState(false);
	const [offset, setOffset] = useState(0);
	const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
	const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);

	const limit = 20;
	const requestKey = `${webhookId}:${offset}`;
	const shouldShowInitialLoading =
		open && deliveries.length === 0 && loadedRequestKey !== requestKey;

	const loadDeliveries = async (showLoading = true) => {
		if (showLoading) {
			setIsLoading(true);
		}
		try {
			const result = await getWebhookDeliveryLogs(webhookId, { limit, offset });
			if (result.success && result.data) {
				setDeliveries(result.data.deliveries);
				setTotal(result.data.total);
			}
		} catch (error) {
			setLoadedRequestKey(requestKey);
			setIsLoading(false);
			throw error;
		}

		setLoadedRequestKey(requestKey);
		setIsLoading(false);
	};

	useEffect(() => {
		if (open) {
			void Promise.resolve().then(() => loadDeliveries());
		}
	}, [open, loadDeliveries]);

	const toggleRow = (id: string) => {
		setExpandedRows((prev) => {
			const next = new Set(prev);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return next;
		});
	};

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "success":
				return (
					<Badge variant="default" className="bg-green-600">
						<IconCheck className="mr-1 size-3" aria-hidden="true" />
						{t("webhooks:webhooks.logs.success", "Success")}
					</Badge>
				);
			case "failed":
				return (
					<Badge variant="destructive">
						<IconX className="mr-1 size-3" aria-hidden="true" />
						{t("webhooks:webhooks.logs.failed", "Failed")}
					</Badge>
				);
			case "retrying":
				return (
					<Badge variant="outline" className="border-yellow-500 text-yellow-600">
						<IconRefresh className="mr-1 size-3" aria-hidden="true" />
						{t("webhooks:webhooks.logs.retrying", "Retrying")}
					</Badge>
				);
			default:
				return (
					<Badge variant="secondary">
						<IconLoader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
						{t("webhooks:webhooks.logs.pending", "Pending")}
					</Badge>
				);
		}
	};

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
					{(isLoading || shouldShowInitialLoading) && deliveries.length === 0 ? (
						<div className="flex items-center justify-center py-12">
							<IconLoader2
								className="size-8 animate-spin text-muted-foreground"
								aria-hidden="true"
							/>
							<span className="sr-only">{t("common.loading", "Loading...")}</span>
						</div>
					) : deliveries.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<p className="text-muted-foreground">
								{t("webhooks:webhooks.logs.empty", "No delivery logs yet")}
							</p>
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-[140px]">
										{t("webhooks:webhooks.logs.time", "Time")}
									</TableHead>
									<TableHead className="w-[180px]">
										{t("webhooks:webhooks.logs.event", "Event")}
									</TableHead>
									<TableHead className="w-[100px]">
										{t("webhooks:webhooks.logs.status", "Status")}
									</TableHead>
									<TableHead className="w-[80px]">
										{t("webhooks:webhooks.logs.http", "HTTP")}
									</TableHead>
									<TableHead className="w-[80px]">
										{t("webhooks:webhooks.logs.duration", "Duration")}
									</TableHead>
									<TableHead className="w-[80px]">
										{t("webhooks:webhooks.logs.attempt", "Attempt")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{deliveries.map((delivery) => (
									<Collapsible
										key={delivery.id}
										open={expandedRows.has(delivery.id)}
										onOpenChange={() => toggleRow(delivery.id)}
										asChild
									>
										<>
											<CollapsibleTrigger asChild>
												<TableRow className="cursor-pointer hover:bg-muted/50">
													<TableCell className="font-mono text-xs">
														{DateTime.fromJSDate(delivery.createdAt).toFormat("MMM d, HH:mm:ss")}
													</TableCell>
													<TableCell className="font-mono text-xs">{delivery.eventType}</TableCell>
													<TableCell>{getStatusBadge(delivery.status)}</TableCell>
													<TableCell>
														{delivery.httpStatus ? (
															<span
																className={
																	delivery.httpStatus >= 200 && delivery.httpStatus < 300
																		? "text-green-600"
																		: "text-red-600"
																}
															>
																{delivery.httpStatus}
															</span>
														) : (
															"-"
														)}
													</TableCell>
													<TableCell>
														{delivery.durationMs ? delivery.durationMs + "ms" : "-"}
													</TableCell>
													<TableCell>
														{delivery.attemptNumber}/{delivery.maxAttempts}
													</TableCell>
												</TableRow>
											</CollapsibleTrigger>
											<CollapsibleContent asChild>
												<TableRow className="bg-muted/30">
													<TableCell colSpan={6} className="p-4">
														<div className="space-y-3">
															{delivery.errorMessage && (
																<div>
																	<span className="text-sm font-medium text-red-600">
																		{t("webhooks:webhooks.logs.error", "Error")}:
																	</span>
																	<p className="text-sm text-muted-foreground">
																		{delivery.errorMessage}
																	</p>
																</div>
															)}
															<div>
																<span className="text-sm font-medium">
																	{t("webhooks:webhooks.logs.payload", "Payload")}:
																</span>
																<pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto max-h-40">
																	{JSON.stringify(delivery.payload, null, 2)}
																</pre>
															</div>
															{delivery.responseBody && (
																<div>
																	<span className="text-sm font-medium">
																		{t("webhooks:webhooks.logs.response", "Response")}:
																	</span>
																	<pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto max-h-40">
																		{delivery.responseBody}
																	</pre>
																</div>
															)}
														</div>
													</TableCell>
												</TableRow>
											</CollapsibleContent>
										</>
									</Collapsible>
								))}
							</TableBody>
						</Table>
					)}
				</ActionPanelBody>

				{/* Pagination */}
				{total > limit && (
					<div className="flex items-center justify-between pt-4 border-t">
						<p className="text-sm text-muted-foreground">
							{t("webhooks:webhooks.logs.showing", "Showing {{start}}-{{end}} of {{total}}", {
								start: offset + 1,
								end: Math.min(offset + deliveries.length, total),
								total,
							})}
						</p>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								onClick={() => setOffset((currentOffset) => Math.max(0, currentOffset - limit))}
								disabled={offset === 0 || isLoading}
							>
								{t("common.previous", "Previous")}
							</Button>
							<Button
								variant="outline"
								size="sm"
								onClick={() => setOffset((currentOffset) => currentOffset + limit)}
								disabled={offset + limit >= total || isLoading}
							>
								{t("common.next", "Next")}
							</Button>
						</div>
					</div>
				)}
			</ActionPanelContent>
		</ActionPanel>
	);
}
