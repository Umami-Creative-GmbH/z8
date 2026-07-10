"use client";

import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { WEBHOOK_DELIVERY_LOGS_PAGE_SIZE } from "./use-webhook-delivery-logs";

interface DeliveryLogsPaginationProps {
	deliveriesCount: number;
	total: number;
	offset: number;
	isLoading: boolean;
	onOffsetChange: (update: (currentOffset: number) => number) => void;
}

export function DeliveryLogsPagination({
	deliveriesCount,
	total,
	offset,
	isLoading,
	onOffsetChange,
}: DeliveryLogsPaginationProps) {
	const { t } = useTranslate();

	if (total <= WEBHOOK_DELIVERY_LOGS_PAGE_SIZE) {
		return null;
	}

	return (
		<div className="flex items-center justify-between pt-4 border-t">
			<p className="text-sm text-muted-foreground">
				{t("webhooks:webhooks.logs.showing", "Showing {{start}}-{{end}} of {{total}}", {
					start: offset + 1,
					end: Math.min(offset + deliveriesCount, total),
					total,
				})}
			</p>
			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						onOffsetChange((currentOffset) =>
							Math.max(0, currentOffset - WEBHOOK_DELIVERY_LOGS_PAGE_SIZE),
						)
					}
					disabled={offset === 0 || isLoading}
				>
					{t("common.previous", "Previous")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() =>
						onOffsetChange((currentOffset) => currentOffset + WEBHOOK_DELIVERY_LOGS_PAGE_SIZE)
					}
					disabled={offset + WEBHOOK_DELIVERY_LOGS_PAGE_SIZE >= total || isLoading}
				>
					{t("common.next", "Next")}
				</Button>
			</div>
		</div>
	);
}
