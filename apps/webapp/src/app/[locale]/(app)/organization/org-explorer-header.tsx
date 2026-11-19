"use client";

import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";

export function OrgExplorerHeader() {
	const { t } = useTranslate();
	return (
		<PageHeader
			title={t("organization.title", "Org Explorer")}
			description={t(
				"organization.description",
				"Explore direct managers, teams, and reporting relationships in your organization.",
			)}
		/>
	);
}

export function OrgExplorerRetry() {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<Button
			type="button"
			variant="outline"
			disabled={pending}
			aria-busy={pending}
			onClick={() => startTransition(() => router.refresh())}
		>
			{t("common.retry", "Retry")}
		</Button>
	);
}
