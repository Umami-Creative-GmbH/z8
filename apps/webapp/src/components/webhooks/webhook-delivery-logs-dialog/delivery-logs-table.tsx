"use client";

import { useTranslate } from "@tolgee/react";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { WebhookDelivery } from "@/lib/webhooks/types";
import { DeliveryLogRow } from "./delivery-log-row";

interface DeliveryLogsTableProps {
	deliveries: WebhookDelivery[];
	expandedRows: Set<string>;
	onToggleRow: (id: string) => void;
}

export function DeliveryLogsTable({
	deliveries,
	expandedRows,
	onToggleRow,
}: DeliveryLogsTableProps) {
	const { t } = useTranslate();

	return (
		<Table>
			<TableHeader>
				<TableRow>
					<TableHead className="w-[140px]">{t("webhooks:webhooks.logs.time", "Time")}</TableHead>
					<TableHead className="w-[180px]">{t("webhooks:webhooks.logs.event", "Event")}</TableHead>
					<TableHead className="w-[100px]">
						{t("webhooks:webhooks.logs.status", "Status")}
					</TableHead>
					<TableHead className="w-[80px]">{t("webhooks:webhooks.logs.http", "HTTP")}</TableHead>
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
					<DeliveryLogRow
						key={delivery.id}
						delivery={delivery}
						open={expandedRows.has(delivery.id)}
						onOpenChange={() => onToggleRow(delivery.id)}
					/>
				))}
			</TableBody>
		</Table>
	);
}
