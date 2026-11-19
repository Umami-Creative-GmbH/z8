"use client";

import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useTransition } from "react";
import {
	type PlatformReadIdentity,
	usePlatformReadStatus,
} from "@/components/platform-admin/use-platform-read-status";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";

export function OverviewHeading() {
	const { t } = useTranslate();
	return (
		<PageHeader
			title={t("admin:admin.overview.platformTitle", "Platform overview")}
			description={t(
				"admin:admin.overview.platformDescription",
				"Review platform-wide accounts, workspaces and activity, then open an administration workspace.",
			)}
		/>
	);
}

export function OverviewReadFailure({ children }: { children: ReactNode }) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	return (
		<Alert role="alert">
			<AlertDescription className="space-y-3">
				<p>{children}</p>
				<Button
					type="button"
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

export function OverviewSnapshot({
	children,
	...identity
}: PlatformReadIdentity & { children: ReactNode }) {
	const { t } = useTranslate();
	const status = usePlatformReadStatus(identity);
	if (status === "available") return children;
	return (
		<div className="space-y-6">
			<OverviewHeading />
			{status === "pending" ? (
				<LoadingRegion
					label={{
						labelKey: "admin:admin.overview.confirmingAccess",
						labelDefault: "Confirming platform access",
					}}
				/>
			) : (
				<OverviewReadFailure>
					{t(
						"admin:admin.overview.refreshAccess",
						"Refresh the overview to confirm platform access before continuing.",
					)}
				</OverviewReadFailure>
			)}
		</div>
	);
}
