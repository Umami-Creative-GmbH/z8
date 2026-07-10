"use client";

import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useLocale } from "next-intl";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TableCell, TableRow } from "@/components/ui/table";
import type { WebhookDelivery } from "@/lib/webhooks/types";
import { useOrganizationTimezone } from "@/stores/organization-settings-store";
import { DeliveryStatusBadge } from "./delivery-status-badge";

interface DeliveryLogRowProps {
	delivery: WebhookDelivery;
	open: boolean;
	onOpenChange: () => void;
}

export function DeliveryLogRow({ delivery, open, onOpenChange }: DeliveryLogRowProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const timezone = useOrganizationTimezone();

	return (
		<Collapsible open={open} onOpenChange={onOpenChange} asChild>
			<CollapsibleTrigger asChild>
				<TableRow className="cursor-pointer hover:bg-muted/50">
					<TableCell className="font-mono text-xs">
						{DateTime.fromJSDate(delivery.createdAt, { zone: "utc" })
							.setZone(timezone)
							.setLocale(locale)
							.toFormat("MMM d, HH:mm:ss")}
					</TableCell>
					<TableCell className="font-mono text-xs">{delivery.eventType}</TableCell>
					<TableCell>
						<DeliveryStatusBadge status={delivery.status} />
					</TableCell>
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
					<TableCell>{delivery.durationMs ? `${delivery.durationMs}ms` : "-"}</TableCell>
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
									<p className="text-sm text-muted-foreground">{delivery.errorMessage}</p>
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
		</Collapsible>
	);
}
