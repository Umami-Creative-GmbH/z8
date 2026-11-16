"use client";

import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/navigation";

export function TeamDirectoryLoading() {
	const { t } = useTranslate();
	return (
		<div className="@container/main flex flex-1 flex-col gap-6 p-4 lg:p-6">
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
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<Button
			variant="outline"
			disabled={pending}
			onClick={() => startTransition(() => router.refresh())}
		>
			{pending ? t("team.directory.retrying", "Retrying…") : t("team.directory.retry", "Retry")}
		</Button>
	);
}
