"use client";

import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/navigation";

export function TeamDirectoryLoading() {
	const { t } = useTranslate();
	return (
		<div data-testid="team-shell" className="@container/main page-frame flex flex-1 flex-col gap-6">
			<PageHeader title={t("team.title", "Your Team")} />
			<LoadingRegion
				label={{ labelKey: "team.directory.loading", labelDefault: "Loading team members" }}
			>
				<Skeleton className="h-12 w-full" />
				<Skeleton className="mt-4 h-48 w-full" />
			</LoadingRegion>
		</div>
	);
}

export function TeamDirectoryRetry() {
	const { t } = useTranslate();
	const organization = useOrganization();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<Button
			variant="outline"
			disabled={pending}
			onClick={() =>
				startTransition(async () => {
					await organization.refetch();
					await router.refresh();
				})
			}
		>
			{pending ? t("team.directory.retrying", "Retrying…") : t("team.directory.retry", "Retry")}
		</Button>
	);
}
