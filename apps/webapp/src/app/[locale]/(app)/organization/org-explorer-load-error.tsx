"use client";

import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function OrgExplorerLoadError({
	retry,
	pending,
}: {
	retry: () => Promise<void>;
	pending: boolean;
}) {
	const { t } = useTranslate();
	return (
		<Alert>
			<AlertDescription className="flex flex-wrap items-center justify-between gap-3">
				<span>
					{t("organization.explorer.loadFailed", "Could not load people.")}
				</span>
				<Button
					type="button"
					variant="outline"
					size="sm"
					disabled={pending}
					aria-busy={pending}
					onClick={() => void retry()}
				>
					{t("common.retry", "Retry")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}
