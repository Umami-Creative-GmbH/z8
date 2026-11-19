"use client";

import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/navigation";

export function AnalyticsReadFailure({ retry }: { retry?: () => void } = {}) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<div
			className="space-y-3 rounded-lg border border-destructive/30 p-5"
			role="alert"
			aria-busy={pending}
		>
			<p className="font-medium">
				{t("common:common.refreshDataFailed", "Could not refresh data. Please try again.")}
			</p>
			<Button
				variant="outline"
				disabled={pending}
				onClick={() => startTransition(() => (retry ? retry() : router.refresh()))}
			>
				{pending ? t("common:common.loading", "Loading...") : t("common:common.retry", "Retry")}
			</Button>
		</div>
	);
}
