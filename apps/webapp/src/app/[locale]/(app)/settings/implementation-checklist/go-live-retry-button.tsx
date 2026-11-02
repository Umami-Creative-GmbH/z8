"use client";

import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { type ReactNode, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/navigation";

/** Works the go-live checks out again: the page is computed live, so a refresh retries. */
export function GoLiveRetryButton({ children }: { children: ReactNode }) {
	const router = useRouter();
	const [isRetrying, startRetry] = useTransition();

	return (
		<Button
			disabled={isRetrying}
			onClick={() => startRetry(() => router.refresh())}
			size="sm"
			type="button"
			variant="outline"
		>
			{isRetrying ? (
				<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
			) : (
				<IconRefresh aria-hidden="true" className="size-4" />
			)}
			{children}
		</Button>
	);
}
