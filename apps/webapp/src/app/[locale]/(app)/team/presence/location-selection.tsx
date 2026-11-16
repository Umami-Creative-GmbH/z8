"use client";

import { IconArrowRight, IconMapPin } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth-client";
import { Link } from "@/navigation";
import { type PresenceSelectionScope, readPresenceLocations } from "./selection-actions";

export function LocationSelection() {
	const { data: session, isPending } = useSession();
	const userId = session?.user.id;
	const organizationId = session?.session.activeOrganizationId;
	return (
		<SelectionLayout>
			{isPending ? (
				<SelectionLoading />
			) : userId && organizationId ? (
				<SelectionArrival
					key={JSON.stringify([userId, organizationId, session?.session.id])}
					userId={userId}
					organizationId={organizationId}
				/>
			) : (
				<SelectionUnavailable />
			)}
		</SelectionLayout>
	);
}

export function LocationSelectionLoading() {
	return (
		<SelectionLayout>
			<SelectionLoading />
		</SelectionLayout>
	);
}

function SelectionLayout({ children }: { children: ReactNode }) {
	const { t } = useTranslate();
	return (
		<div className="@container/main flex flex-1 flex-col px-4 py-6 lg:px-6">
			<div className="w-full max-w-4xl space-y-6">
				<PageHeader
					title={t("team.presence.title", "Who is in")}
					description={t(
						"team.presence.description",
						"Choose a location to see who is clocked in or on a break there.",
					)}
				/>
				{children}
			</div>
		</div>
	);
}

function SelectionLoading() {
	const { t } = useTranslate();
	return (
		<div aria-busy="true" className="space-y-3">
			<p role="status" className="text-sm text-muted-foreground">
				{t("team.presence.loadingLocations", "Loading locations for the current organization…")}
			</p>
			<Skeleton className="h-40 w-full" />
		</div>
	);
}

function SelectionUnavailable() {
	const { t } = useTranslate();
	return (
		<div className="space-y-3 rounded-lg border bg-card p-6 text-sm">
			<p role="status">
				{t(
					"team.presence.unavailable",
					"Presence is unavailable for the current account or organization.",
				)}
			</p>
			<Link href="/" className="text-primary underline underline-offset-4">
				{t("common.backToDashboard", "Back to dashboard")}
			</Link>
		</div>
	);
}

type SelectionState = {
	locations?: { id: string; name: string }[];
	pending: boolean;
	failure?: "error" | "changed" | "forbidden";
};

function SelectionArrival({ userId, organizationId }: PresenceSelectionScope) {
	const { t } = useTranslate();
	const lifetime = useRef<object | null>(null);
	const pending = useRef<{ owner: object; promise: Promise<void> } | null>(null);
	const [state, setState] = useState<SelectionState>({ pending: true });

	const load = useCallback(
		async (reset = false) => {
			const owner = lifetime.current;
			if (!owner) return;
			if (pending.current?.owner === owner) return pending.current.promise;
			setState((previous) => (reset ? { pending: true } : { ...previous, pending: true }));
			const promise = (async () => {
				const result = await readPresenceLocations({ userId, organizationId }).catch(() => ({
					status: "error" as const,
				}));
				if (lifetime.current !== owner) return;
				pending.current = null;
				if (
					result.status === "ok" &&
					result.userId === userId &&
					result.organizationId === organizationId
				) {
					setState({ pending: false, locations: result.locations });
					return;
				}
				const failure = result.status === "ok" ? "changed" : result.status;
				setState((previous) => ({
					pending: false,
					failure,
					locations: failure === "error" ? previous.locations : undefined,
				}));
				throw new Error("Presence locations could not be refreshed.");
			})();
			pending.current = { owner, promise };
			return promise;
		},
		[userId, organizationId],
	);

	useLayoutEffect(() => {
		lifetime.current = {};
		void load(true).catch(() => {});
		return () => {
			lifetime.current = null;
			pending.current = null;
		};
	}, [load]);
	useViewRefresh(load);

	if (state.failure === "forbidden") return <SelectionUnavailable />;
	return (
		<section
			aria-labelledby="presence-locations-title"
			aria-busy={state.pending}
			className="space-y-4"
		>
			<h2 id="presence-locations-title" className="text-base font-semibold">
				{t("team.presence.chooseLocation", "Choose a location")}
			</h2>
			{state.failure ? (
				<div className="space-y-3 rounded-lg border bg-card p-4 text-sm">
					<p role="alert">
						{state.locations
							? t(
									"team.presence.refreshFailed",
									"Locations could not be refreshed. Showing the last loaded locations.",
								)
							: t(
									"team.presence.loadFailed",
									"Locations could not be loaded for the current organization.",
								)}
					</p>
					<Button
						variant="outline"
						disabled={state.pending}
						onClick={() => void load().catch(() => {})}
					>
						{t("common.retry", "Retry")}
					</Button>
				</div>
			) : null}
			{state.pending ? (
				state.locations ? (
					<p role="status" className="text-sm text-muted-foreground">
						{t("team.presence.refreshingLocations", "Refreshing locations…")}
					</p>
				) : (
					<SelectionLoading />
				)
			) : null}
			{state.locations ? (
				state.locations.length === 0 ? (
					<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
						{t("team.presence.noLocations", "Your organization has no active locations yet.")}
					</div>
				) : (
					<ul className="divide-y overflow-hidden rounded-lg border bg-card">
						{state.locations.map((location) => (
							<li key={location.id}>
								<Link
									href={`/team/presence/${location.id}`}
									className="flex min-h-16 items-center gap-3 px-4 py-4 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:gap-4"
								>
									<IconMapPin
										className="size-5 shrink-0 text-muted-foreground"
										aria-hidden="true"
									/>
									<span className="min-w-0 flex-1 break-words font-medium">{location.name}</span>
									<span className="flex shrink-0 items-center gap-2 text-sm text-foreground">
										<span className="hidden sm:inline">
											{t("team.presence.viewPresence", "View presence")}
										</span>
										<IconArrowRight className="size-4" aria-hidden="true" />
									</span>
								</Link>
							</li>
						))}
					</ul>
				)
			) : null}
		</section>
	);
}
