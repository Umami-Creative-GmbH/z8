"use client";

import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useTransition } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { LoadingRegion } from "@/components/ui/loading-region";
import { PageHeader } from "@/components/ui/page-header";
import { authClient, useSession } from "@/lib/auth-client";

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

function matchesPlatformSession(
	data: ReturnType<typeof useSession>["data"],
	userId: string,
	sessionId: string,
) {
	return data?.user.id === userId && data.user.role === "admin" && data.session?.id === sessionId;
}

/** Display lifetime only. The canonical platform owner admits every server read. */
export function OverviewSnapshot({
	userId,
	sessionId,
	readId,
	children,
}: {
	userId: string;
	sessionId: string;
	readId: string;
	children: ReactNode;
}) {
	const { t } = useTranslate();
	const session = useSession();
	const admitted = useRef(new Set<string>());
	const [retired, setRetired] = useState<ReadonlySet<string>>(() => new Set());
	const matches = matchesPlatformSession(session.data, userId, sessionId);
	const ready = matches && !session.isPending;
	useEffect(() => {
		const retire = () =>
			setRetired((previous) => (previous.has(readId) ? previous : new Set([...previous, readId])));
		if (ready) admitted.current.add(readId);
		if ((!session.isPending && !matches) || (session.isPending && admitted.current.has(readId)))
			retire();
		return authClient.$store.atoms.session.subscribe((value) => {
			const next = value.data;
			if (
				(next && !matchesPlatformSession(next, userId, sessionId)) ||
				(!next && !value.isPending) ||
				(value.isPending && admitted.current.has(readId))
			)
				retire();
		});
	}, [ready, matches, session.isPending, readId, userId, sessionId]);
	// Activity disconnects effects while hidden. Returning requires a new admitted read.
	useEffect(() => {
		return () => {
			if (admitted.current.has(readId)) setRetired((previous) => new Set([...previous, readId]));
		};
	}, [readId]);
	if (ready && !retired.has(readId)) return children;
	return (
		<div className="space-y-6">
			<OverviewHeading />
			{session.isPending ? (
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
