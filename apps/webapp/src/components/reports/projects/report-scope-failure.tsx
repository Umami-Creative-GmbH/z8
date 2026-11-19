"use client";

import { useTranslate } from "@tolgee/react";
import { useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function ReportScopeFailure({
	message,
	onRetry,
	className,
}: {
	message: string;
	onRetry: () => Promise<void>;
	className?: string;
}) {
	const { t } = useTranslate();
	const [pending, startTransition] = useTransition();
	return (
		<Alert variant="destructive" className={className}>
			<AlertDescription className="space-y-3">
				<p>{message}</p>
				<Button
					variant="outline"
					disabled={pending}
					aria-busy={pending}
					onClick={() =>
						startTransition(async () => {
							try {
								await onRetry();
							} catch {
								// The requesting scope keeps the recoverable error visible.
							}
						})
					}
				>
					{t("common.retry", "Retry")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}
