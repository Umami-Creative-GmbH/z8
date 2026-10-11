"use client";

import { IconEye, IconLinkOff, IconLoader2 } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
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
import { formatInstant, formatPlainDateRange } from "@/lib/datetime/temporal-format";
import type {
	ShareLinkStatus,
	ShareLinkSummary,
	ShareTarget,
} from "@/lib/projects/report-share/report-share-links";
import { queryKeys } from "@/lib/query/keys";

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
export function ReportShareLinkList({ target, showReport = false }: ReportShareLinkListProps) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: queryKeys.reportShareLinks.list(targetKey(target)),
		queryFn: async () => {
			const result = await listReportShareLinks(target);
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
			<p className="text-sm text-destructive" role="alert">
				{t("reports.share.list.failed", "Share links could not be loaded.")}
			</p>
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
				<ReportShareLinkRow key={link.id} link={link} showReport={showReport} />
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

function ReportShareLinkRow({ link, showReport }: { link: ShareLinkSummary; showReport: boolean }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const display = useDisplayContext();
	const [showViews, setShowViews] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [revoking, setRevoking] = useState(false);
	const at = (instant: string) =>
		formatInstant(Temporal.Instant.from(instant), display, "dateTimeMedium");
	const period = formatPlainDateRange(
		Temporal.PlainDate.from(link.fromDay),
		Temporal.PlainDate.from(link.toDay),
		display.locale,
		"dateMedium",
	);

	async function revoke() {
		setRevoking(true);
		const result = await revokeReportShareLink(link.id);
		setRevoking(false);
		setConfirming(false);
		if (!result.success) {
			toast.error(t("reports.share.revoke.failed", "The link could not be revoked"), {
				description: result.error,
			});
			return;
		}
		toast.success(t("reports.share.revoke.done", "Link revoked"));
		await queryClient.invalidateQueries({ queryKey: queryKeys.reportShareLinks.all });
	}

	return (
		<li className="space-y-2 p-3 text-sm">
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
				{link.status === "active"
					? t("reports.share.list.expires", "Expires {date}", { date: at(link.expiresAt) })
					: link.status === "expired"
						? t("reports.share.list.expired", "Expired {date}", {
								date: at(link.revokedAt ?? link.expiresAt),
							})
						: link.revokeReason === "creator_lost_access"
							? t(
									"reports.share.list.revokedAutomatically",
									"Revoked automatically on {date}: the creator no longer sees every project in it",
									{ date: at(link.revokedAt ?? link.expiresAt) },
								)
							: t("reports.share.list.revokedBy", "Revoked by {name} on {date}", {
									name: link.revokedByName ?? "—",
									date: at(link.revokedAt ?? link.expiresAt),
								})}
			</p>
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
					<Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
						<IconLinkOff aria-hidden="true" className="size-4" />
						{t("reports.share.revoke.action", "Revoke")}
					</Button>
				)}
			</div>
			{showViews && <ReportShareLinkViews linkId={link.id} />}
			<AlertDialog open={confirming} onOpenChange={setConfirming}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("reports.share.revoke.title", "Revoke this link?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"reports.share.revoke.description",
								"The link stops working at once and its snapshot is deleted. Its record and view log are kept.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={revoking}>
							{t("reports.share.revoke.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							disabled={revoking}
							onClick={(event) => {
								event.preventDefault();
								void revoke();
							}}
						>
							{revoking && <IconLoader2 aria-hidden="true" className="size-4 animate-spin" />}
							{t("reports.share.revoke.confirm", "Revoke link")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</li>
	);
}

function ReportShareLinkViews({ linkId }: { linkId: string }) {
	const { t } = useTranslate();
	const display = useDisplayContext();
	const query = useQuery({
		queryKey: queryKeys.reportShareLinks.views(linkId),
		queryFn: async () => {
			const result = await listReportShareLinkViews(linkId);
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
				<li key={`${view.viewedAt}-${view.ipAddress}`} className="grid gap-x-3 sm:grid-cols-[auto_auto_1fr]">
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
