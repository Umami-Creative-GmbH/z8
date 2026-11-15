"use client";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function MyDocumentsRetry() {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<Alert>
			<AlertDescription className="space-y-3">
				<p>
					{t(
						"settings.personnelFiles.myDocuments.loadFailed",
						"Your documents or requests could not be loaded. Try again.",
					)}
				</p>
				<Button
					variant="outline"
					disabled={pending}
					aria-busy={pending}
					onClick={() => startTransition(() => router.refresh())}
				>
					{t("common.retry", "Retry")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}
