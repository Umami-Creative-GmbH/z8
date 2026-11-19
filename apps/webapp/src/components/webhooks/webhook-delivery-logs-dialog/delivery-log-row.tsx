"use client";

import { IconChevronRight } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { useId } from "react";
import { Temporal } from "temporal-polyfill";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { WebhookDelivery } from "@/lib/webhooks/types";
import { useOrganizationTimezone } from "@/stores/organization-settings-store";
import { DeliveryStatusBadge } from "./delivery-status-badge";

interface DeliveryLogRowProps {
	delivery: WebhookDelivery;
	open: boolean;
	onOpenChange: () => void;
}

/** Delivery time in the organization's zone; `createdAt` is a UTC instant from the database boundary. */
export function formatDeliveryTime(createdAt: Date, timeZone: string, locale: string) {
	return Temporal.Instant.fromEpochMilliseconds(createdAt.getTime()).toLocaleString(locale, {
		timeZone,
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23",
	});
}

export function DeliveryLogRow({ delivery, open, onOpenChange }: DeliveryLogRowProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const timezone = useOrganizationTimezone();
	const detailsId = useId();
	const time = formatDeliveryTime(delivery.createdAt, timezone, locale);

	return (
		<>
			<TableRow className="hover:bg-muted/50">
				<TableCell className="font-mono text-xs">
					<button
						type="button"
						aria-expanded={open}
						aria-controls={detailsId}
						aria-label={t("webhooks:webhooks.logs.toggle-details", "Details for {event} at {time}", {
							event: delivery.eventType,
							time,
						})}
						onClick={onOpenChange}
						className="-mx-1 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-left tabular-nums hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<IconChevronRight
							className={cn("size-3.5 shrink-0 transition-transform motion-reduce:transition-none", open && "rotate-90")}
							aria-hidden="true"
						/>
						{time}
					</button>
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
									? "tabular-nums text-success"
									: "tabular-nums text-destructive"
							}
						>
							{delivery.httpStatus}
						</span>
					) : (
						"-"
					)}
				</TableCell>
				<TableCell className="tabular-nums">
					{delivery.durationMs ? `${delivery.durationMs}ms` : "-"}
				</TableCell>
				<TableCell className="tabular-nums">
					{delivery.attemptNumber}/{delivery.maxAttempts}
				</TableCell>
			</TableRow>
			<TableRow id={detailsId} hidden={!open} className="bg-muted/30">
				{open ? (
					<TableCell colSpan={6} className="p-4">
						<div className="space-y-3">
							{delivery.errorMessage && (
								<div>
									<span className="text-sm font-medium text-destructive">
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
				) : null}
			</TableRow>
		</>
	);
}
