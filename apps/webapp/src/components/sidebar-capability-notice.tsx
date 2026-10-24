"use client";

import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export function SidebarCapabilityNotice() {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<div
			className="px-2 py-1 text-xs text-muted-foreground"
			role="status"
			aria-atomic="true"
		>
			<p>
				{t("common.navigation.unavailable", "Some navigation is unavailable")}
			</p>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={pending}
				aria-busy={pending}
				onClick={() => startTransition(() => router.refresh())}
			>
				{t("common.navigation.retry", "Retry navigation")}
			</Button>
		</div>
	);
}
