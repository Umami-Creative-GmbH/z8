"use client";

import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useRouter } from "@/navigation";

function RegionLoading({ height }: { height: string }) {
	const { t } = useTranslate();
	return (
		<div
			role="status"
			aria-label={t("common.loading", "Loading...")}
			className="px-4 lg:px-6"
		>
			<Skeleton className={`${height} w-full`} />
		</div>
	);
}

export function ClockLoading() {
	return <RegionLoading height="h-40" />;
}
export function TimelineLoading() {
	return <RegionLoading height="h-64" />;
}
export function HistoryLoading() {
	return <RegionLoading height="h-80" />;
}

export function SummaryLoading() {
	const { t } = useTranslate();
	return (
		<div
			role="status"
			aria-label={t("common.loading", "Loading...")}
			className="grid gap-4 px-4 md:grid-cols-2 lg:px-6 xl:grid-cols-4"
		>
			{["week", "hours", "breaks", "balance"].map((key) => (
				<Skeleton key={key} className="h-28 w-full" />
			))}
		</div>
	);
}

export function RegionLoadError({ label }: { label: string }) {
	const { t } = useTranslate();
	const router = useRouter();
	return (
		<div
			role="alert"
			className="flex min-h-40 flex-col items-start justify-center gap-3 rounded-lg border p-6"
		>
			<p className="font-medium">{label}</p>
			<p className="text-sm text-muted-foreground">
				{t("common.error-occurred", "An error occurred")}
			</p>
			<Button variant="outline" onClick={() => router.refresh()}>
				{t("common.retry", "Retry")}
			</Button>
		</div>
	);
}
