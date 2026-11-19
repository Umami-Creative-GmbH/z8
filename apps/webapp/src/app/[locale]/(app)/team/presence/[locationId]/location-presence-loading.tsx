"use client";

import { useTranslate } from "@tolgee/react";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { AllLocationsLink } from "./all-locations-link";

export function LocationPresenceLoading() {
	const { t } = useTranslate();
	return (
		<div className="page-frame flex min-w-0 flex-1 flex-col gap-6">
			<PageHeader title={t("team.presence.title", "Who is in")} scope={<AllLocationsLink />} />
			<div
				role="status"
				aria-label={t("team.presence.loading", "Loading location presence…")}
				aria-busy="true"
			>
				<Skeleton className="h-64 w-full" />
				<span className="sr-only">{t("team.presence.loading", "Loading location presence…")}</span>
			</div>
		</div>
	);
}
