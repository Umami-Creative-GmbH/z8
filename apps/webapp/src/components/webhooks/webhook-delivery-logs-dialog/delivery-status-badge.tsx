"use client";

import { IconCheck, IconLoader2, IconRefresh, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";

export function DeliveryStatusBadge({ status }: { status: string }) {
	const { t } = useTranslate();

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
}
