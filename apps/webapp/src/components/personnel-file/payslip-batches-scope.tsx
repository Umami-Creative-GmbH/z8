"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/navigation";

/** RSC records and the start form belong to the displayed account and organization. */
export function PayslipBatchesScope({
	userId,
	organizationId,
	children,
}: {
	userId: string;
	organizationId: string;
	children: ReactNode;
}) {
	const current = useOrganization();
	if (
		current.isLoading ||
		current.error ||
		current.userId !== userId ||
		current.activeOrganizationId !== organizationId
	)
		return null;
	return children;
}

export function PayslipBatchesRetry() {
	const { t } = useTranslate();
	const router = useRouter();
	return (
		<Button type="button" variant="outline" onClick={() => router.refresh()}>
			{t("common.retry", "Retry")}
		</Button>
	);
}
