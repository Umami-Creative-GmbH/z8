"use client";

import { IconEye, IconLinkOff, IconLoader2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	listReportShareLinks,
	listReportShareLinkViews,
	revokeReportShareLink,
} from "@/app/[locale]/(app)/reports/projects/share-actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDisplayContext } from "@/hooks/use-display-context";
import { useOrganization } from "@/hooks/use-organization";
import { formatInstant, formatPlainDateRange } from "@/lib/datetime/temporal-format";
import type {
	ShareLinkStatus,
	ShareLinkSummary,
	ShareTarget,
} from "@/lib/projects/report-share/report-share-links";
import { queryKeys } from "@/lib/query/keys";
import { runWithCleanup } from "@/lib/run-with-cleanup";
import { ReportScopeFailure } from "./report-scope-failure";

function targetKey(target: ShareTarget | undefined) {
	if (!target) return null;
	return {
		kind: target.kind,
		id: target.kind === "project" ? target.projectId : target.customerId,
	};
}

interface ReportShareLinkListProps {
	/** One report's links; the organization's links without it. */
	target?: ShareTarget;
	/** Show which project or customer each link shares (organization list). */
	showReport?: boolean;
}

/**
 * Report share links with their status, options, expiry and views (#806).
 * The server lists every link for owners and admins and the reader's own
 * otherwise; revoking stops a link at once and deletes its snapshot.
 */
type ShareReadScope = {
	userId: string;
	organizationId: string;
	arrival: string;
};

function useOwnedShareKey(prefix: readonly unknown[], scope: ShareReadScope) {
	const client = useQueryClient();
	const hash = JSON.stringify([...prefix, scope]);
	useLayoutEffect(
		() => () => {
			const queryKey: readonly unknown[] = JSON.parse(hash);
			void client.cancelQueries({ queryKey, exact: true });
			client.removeQueries({ queryKey, exact: true });
		},
		[client, hash],
	);
	return JSON.parse(hash) as readonly unknown[];
}

export function ReportShareLinkList(props: ReportShareLinkListProps) {
	const scope = useOrganization();
	const { t } = useTranslate();
	if (scope.isLoading)
		return (
			<p role="status">
				{t("reports.share.list.scopeLoading", "Loading the current share-link scope\u2026")}
			</p>
		);
	if (scope.error || !scope.userId || !scope.activeOrganizationId)
		return (
			<ReportScopeFailure
				message={t(
					"reports.share.list.scopeUnavailable",
					"The current share-link scope could not be loaded.",
				)}
				onRetry={scope.refetch}
			/>
		);
	return (
		<ReportShareLinkArrival
			key={JSON.stringify([scope.userId, scope.activeOrganizationId, targetKey(props.target)])}
			{...props}
			userId={scope.userId}
			organizationId={scope.activeOrganizationId}
		/>
	);
}

function ReportShareLinkArrival({
	target,
	showReport = false,
	userId,
	organizationId,
}: ReportShareLinkListProps & { userId: string; organizationId: string }) {
	const arrival = useId();
	const scope = { userId, organizationId, arrival };
	const queryKey = useOwnedShareKey(queryKeys.reportShareLinks.list(targetKey(target)), scope);
	const { t } = useTranslate();
	const query = useQuery({
		queryKey,
		retry: false,
		queryFn: async ({ signal }) => {
			const result = await listReportShareLinks(target);
			signal.throwIfAborted();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	if (query.isPending) {
		return (
			<p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
				<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
				{t("reports.share.list.loading", "Loading share links…")}
			</p>
		);
	}
	if (query.isError) {
		return (
			<div className="space-y-2 text-sm text-destructive" role="alert">
				{t("reports.share.list.failed", "Share links could not be loaded.")}
				<Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}
	if (query.data.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("reports.share.list.empty", "No share links yet.")}
			</p>
		);
	}
	return (
		<ul className="divide-y rounded-lg border">
			{query.data.map((link) => (
				<ReportShareLinkRow key={link.id} link={link} showReport={showReport} scope={scope} />
			))}
		</ul>
	);
}

function StatusBadge({ status }: { status: ShareLinkStatus }) {
	const { t } = useTranslate();
	if (status === "active") {
		return <Badge>{t("reports.share.status.active", "Active")}</Badge>;
	}
	if (status === "expired") {
		return <Badge variant="secondary">{t("reports.share.status.expired", "Expired")}</Badge>;
	}
	return <Badge variant="outline">{t("reports.share.status.revoked", "Revoked")}</Badge>;
}

function ReportShareLinkRow({
	link,
	showReport,
	scope,
}: {
	link: ShareLinkSummary;
	showReport: boolean;
	scope: ShareReadScope;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const display = useDisplayContext();
	const [showViews, setShowViews] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [revoking, setRevoking] = useState(false);
	/** A failed revocation, with the server's explanation when it gave one. */
	const [revokeError, setRevokeError] = useState<{ detail: string | null } | null>(null);
	const lifetime = useRef<object | null>(null);
	const pending = useRef<object | null>(null);
	useLayoutEffect(() => {
		lifetime.current = { linkId: link.id };
		pending.current = null;
		return () => {
			if (pending.current) setRevoking(false);
			lifetime.current = null;
			pending.current = null;
		};
	}, [link.id]);
	const at = (instant: string) =>
		formatInstant(Temporal.Instant.from(instant), display, "dateTimeMedium");
	const period = formatPlainDateRange(
		Temporal.PlainDate.from(link.fromDay),
		Temporal.PlainDate.from(link.toDay),
		display.locale,
		"dateMedium",
	);

	async function revoke() {
		const generation = lifetime.current;
		if (!generation || pending.current || !link.canRevoke || link.status !== "active") return;
		pending.current = generation;
		setRevoking(true);
		setRevokeError(null);
		await runWithCleanup(
			async () => {
				try {
					const result = await revokeReportShareLink(link.id);
					if (lifetime.current !== generation) return;
					setRevoking(false);
					if (!result.success) {
						// The dialog stays open so the failure is read next to the link it concerns.
						setRevokeError({ detail: result.error || null });
						return;
					}
					setConfirming(false);
					toast.success(t("reports.share.revoke.done", "Link revoked"));
					await queryClient.invalidateQueries({
						queryKey: queryKeys.reportShareLinks.all,
					});
				} catch {
					if (lifetime.current === generation) setRevokeError({ detail: null });
				}
			},
			() => {
				if (pending.current === generation) {
					pending.current = null;
					setRevoking(false);
				}
			},
		);
	}

	return (
		<li className="space-y-2 p-3 text-sm">
			<ReportShareSummary link={link} showReport={showReport} period={period} />
			<div className="flex flex-wrap items-center gap-2">
				<Button
					variant="ghost"
					size="sm"
					onClick={() => setShowViews((value) => !value)}
					aria-expanded={showViews}
				>
					<IconEye aria-hidden="true" className="size-4" />
					{t("reports.share.list.views", "{count, plural, one {# view} other {# views}}", {
						count: link.viewCount,
					})}
					{link.lastViewedAt &&
						` · ${t("reports.share.list.lastViewed", "last {date}", { date: at(link.lastViewedAt) })}`}
				</Button>
				{link.status === "active" && link.canRevoke && (
					<Button
						variant="outline"
						size="sm"
						onClick={() => {
							setRevokeError(null);
							setConfirming(true);
						}}
					>
						<IconLinkOff aria-hidden="true" className="size-4" />
						{t("reports.share.revoke.action", "Revoke")}
					</Button>
				)}
			</div>
			{showViews && <ReportShareLinkViews linkId={link.id} scope={scope} />}
			<AlertDialog
				open={confirming}
				onOpenChange={(next) => {
					// Escape or an outside press must not hide a revocation that is still running.
					if (!next && revoking) return;
					setConfirming(next);
				}}
			>
				<AlertDialogContent aria-busy={revoking}>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{link.reportName
								? t(
										"reports.share.revoke.titleNamed",
										"Revoke the share link for {report}, {period}?",
										{ report: link.reportName, period },
									)
								: t(
										"reports.share.revoke.titleDeletedReport",
										"Revoke the share link for a deleted report, {period}?",
										{ period },
									)}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"reports.share.revoke.description",
								"The link stops working at once and its snapshot is deleted. Its record and view log are kept.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					{revokeError && (
						<div role="alert" className="space-y-1 text-sm text-destructive">
							<p>{t("reports.share.revoke.failed", "The link could not be revoked")}</p>
							{revokeError.detail && <p className="text-muted-foreground">{revokeError.detail}</p>}
						</div>
					)}
					<AlertDialogFooter>
						<AlertDialogCancel disabled={revoking}>
							{t("reports.share.revoke.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={revoking || !link.canRevoke || link.status !== "active"}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
							onClick={(event) => {
								// Keep the dialog open so the pending state and any failure stay visible.
								event.preventDefault();
								(
									event as unknown as { preventBaseUIHandler?: () => void }
								).preventBaseUIHandler?.();
								void revoke();
							}}
						>
							{revoking && (
								<IconLoader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
							)}
							{t("reports.share.revoke.confirm", "Revoke link")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</li>
	);
}

function ReportShareLinkViews({ linkId, scope }: { linkId: string; scope: ShareReadScope }) {
	const queryKey = useOwnedShareKey(queryKeys.reportShareLinks.views(linkId), scope);
	const { t } = useTranslate();
	const display = useDisplayContext();
	const query = useQuery({
		queryKey,
		retry: false,
		queryFn: async ({ signal }) => {
			const result = await listReportShareLinkViews(linkId);
			signal.throwIfAborted();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	if (query.isPending) {
		return (
			<p className="text-muted-foreground" role="status">
				{t("reports.share.views.loading", "Loading views…")}
			</p>
		);
	}
	if (query.isError || query.data.length === 0) {
		return (
			<p className="text-muted-foreground">
				{query.isError
					? t("reports.share.views.failed", "Views could not be loaded.")
					: t("reports.share.views.empty", "Nobody has opened this link yet.")}
			</p>
		);
	}
	return (
		<ul className="space-y-1 rounded-md bg-muted/40 p-2 text-xs">
			{query.data.map((view) => (
				<li
					key={`${view.viewedAt}-${view.ipAddress}`}
					className="grid gap-x-3 sm:grid-cols-[auto_auto_1fr]"
				>
					<span className="tabular-nums">
						{formatInstant(Temporal.Instant.from(view.viewedAt), display, "dateTimeMedium")}
					</span>
					<span className="tabular-nums text-muted-foreground">
						{view.ipAddress ?? t("reports.share.views.unknownIp", "Unknown IP address")}
					</span>
					<span className="truncate text-muted-foreground" title={view.userAgent ?? undefined}>
						{view.userAgent ?? t("reports.share.views.unknownAgent", "Unknown browser")}
					</span>
				</li>
			))}
		</ul>
	);
}

function ReportShareSummary({
	link,
	showReport,
	period,
}: {
	link: ShareLinkSummary;
	showReport: boolean;
	period: string;
}) {
	const { t } = useTranslate();
	const display = useDisplayContext();
	const at = (instant: string) =>
		formatInstant(Temporal.Instant.from(instant), display, "dateTimeMedium");

	function statusLine(): string {
		if (link.status === "active") {
			return t("reports.share.list.expires", "Expires {date}", {
				date: at(link.expiresAt),
			});
		}
		const date = at(link.revokedAt ?? link.expiresAt);
		if (link.status === "expired") {
			return t("reports.share.list.expired", "Expired {date}", { date });
		}
		if (link.revokeReason === "creator_lost_access") {
			return t(
				"reports.share.list.revokedAutomatically",
				"Revoked automatically on {date}: the creator no longer sees every project in it",
				{ date },
			);
		}
		return t("reports.share.list.revokedBy", "Revoked by {name} on {date}", {
			name: link.revokedByName ?? t("reports.share.list.someone", "someone"),
			date,
		});
	}

	return (
		<>
			<div className="flex flex-wrap items-center gap-2">
				<StatusBadge status={link.status} />
				{showReport && (
					<span className="font-medium">
						{link.reportName ?? t("reports.share.list.deletedReport", "Deleted")}
						{" · "}
						{link.kind === "project"
							? t("reports.share.kind.project", "Project report")
							: t("reports.share.kind.customer", "Customer report")}
					</span>
				)}
				<span className="text-muted-foreground">{period}</span>
			</div>
			<p className="text-muted-foreground">
				{link.figures === "revenue"
					? t("reports.share.figures.revenue", "Hours + revenue")
					: t("reports.share.figures.hours", "Hours only")}
				{link.kind === "project" &&
					` · ${
						link.includeEmployees
							? t("reports.share.list.withEmployees", "With employee breakdown")
							: t("reports.share.list.withoutEmployees", "Without employee breakdown")
					}`}
			</p>
			<p className="text-muted-foreground">
				{t("reports.share.list.createdBy", "Created by {name} on {date}", {
					name: link.createdBy.name,
					date: at(link.createdAt),
				})}
				{" · "}
				{statusLine()}
			</p>
		</>
	);
}
