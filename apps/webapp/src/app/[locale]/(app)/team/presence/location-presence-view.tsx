"use client";

import { useTranslate } from "@tolgee/react";
import { type ReactNode, useTransition } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { useSession } from "@/lib/auth-client";
import { useRouter } from "@/navigation";
import { usePresenceViewArrival } from "./use-presence-view-arrival";

export interface LocationPresenceViewScope {
	userId: string;
	organizationId: string;
}

/** Retires retained presentation; each fresh server read still owns admission. */
export function LocationPresenceView({
	view,
	children,
}: {
	view: LocationPresenceViewScope;
	children: ReactNode;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const session = useSession();
	const organization = useOrganization();
	const [pending, startTransition] = useTransition();
	const identity = JSON.stringify([
		session.isPending,
		session.data?.user.id,
		session.data?.session.activeOrganizationId,
		session.data?.session.id,
		organization.userId,
		organization.activeOrganizationId,
		organization.employeeId,
		organization.role,
	]);
	const matches =
		!session.isPending &&
		session.data?.user.id === view.userId &&
		session.data?.session.activeOrganizationId === view.organizationId &&
		(organization.userId === null || organization.userId === view.userId) &&
		(organization.activeOrganizationId === null ||
			organization.activeOrganizationId === view.organizationId);
	const current = usePresenceViewArrival(view, identity, matches);
	if (current) {
		return children;
	}
	return (
		<div className="mx-auto flex w-full min-w-0 max-w-6xl flex-1 flex-col gap-6 px-4 py-6 lg:px-6">
			<PageHeader title={t("team.presence.title", "Who is in")} />
			<div className="space-y-3 rounded-lg border bg-card p-6 text-sm">
				<p role="status">
					{t(
						"team.presence.scopeChanged",
						"Presence needs a fresh read for the current account or organization.",
					)}
				</p>
				<Button
					variant="outline"
					disabled={pending}
					onClick={() => startTransition(() => router.refresh())}
				>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		</div>
	);
}
