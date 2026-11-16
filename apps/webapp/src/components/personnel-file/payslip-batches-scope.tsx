"use client";

import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/navigation";
import { PayslipBatchesHeading } from "./payslip-batches-heading";

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
	const { t } = useTranslate();
	if (
		current.isLoading ||
		current.error ||
		current.userId !== userId ||
		current.activeOrganizationId !== organizationId
	)
		return (
			<div className="@container/main mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-4 md:p-6">
				<PayslipBatchesHeading />
				{current.error ? (
					<div role="alert" className="space-y-3 text-sm">
						<p>
							{t(
								"settings.personnelFiles.batch.scopeUnavailable",
								"Your current organization could not be confirmed. Retry before opening payslip batches.",
							)}
						</p>
						<Button type="button" variant="outline" onClick={() => void current.refetch()}>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				) : (
					<LoadingRegion
						label={{
							labelKey: "settings.personnelFiles.batch.loading",
							labelDefault: "Loading payslip batches",
						}}
					>
						<Skeleton aria-hidden="true" className="h-64 w-full" />
					</LoadingRegion>
				)}
			</div>
		);
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
