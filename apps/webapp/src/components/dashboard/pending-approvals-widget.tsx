"use client";

import { IconAlertCircle, IconArrowRight, IconClock, IconUserShare } from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useMemo } from "react";
import {
	getApprovalItemTypeLabels,
	getApprovalTypeLabels,
} from "@/app/[locale]/(app)/approvals/inbox/components/approval-type-labels";
import { getOwnRequestNote } from "@/app/[locale]/(app)/approvals/inbox/components/own-request-note";
import { useApprovalInboxSummaryText } from "@/components/approvals/use-approval-inbox-summary-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ApprovalInboxLocalizedText, ApprovalInboxType } from "@/lib/approvals/inbox/types";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import type {
	DashboardWidgetData,
	DashboardWidgetSnapshot,
	PendingApprovalPreviewItem,
	PendingApprovalsData,
} from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

function UrgencyIndicator({
	total,
	coveringCount,
	incomplete,
}: Pick<PendingApprovalsData, "total" | "coveringCount"> & {
	/** A source failed, so `total` is a lower bound: the banner says "at least". */
	incomplete: boolean;
}) {
	const { t } = useTranslate();
	const isUrgent = total >= 5;
	const isWarning = total >= 3;

	return (
		<div
			className={cn(
				"flex items-center gap-2 rounded-xl px-4 py-3",
				isUrgent
					? "border border-destructive/30 bg-destructive/10 text-foreground"
					: isWarning
						? "border border-amber-500/30 bg-amber-500/10 text-foreground"
						: "border border-primary/20 bg-primary/5 text-foreground",
			)}
		>
			<div className="flex items-center justify-center rounded-full bg-white/20 p-2">
				<IconAlertCircle className="size-5" aria-hidden="true" />
			</div>
			<div className="flex-1">
				<p className="font-semibold">
					{incomplete
						? t(
								"dashboard.pending-approvals.pending-total-at-least",
								"{count, plural, one {At least # pending approval} other {At least # pending approvals}}",
								{ count: total },
							)
						: t(
								"dashboard.pending-approvals.pending-total",
								"{count, plural, one {# pending approval} other {# pending approvals}}",
								{ count: total },
							)}
				</p>
				{coveringCount > 0 && (
					<p className="text-xs">
						{t(
							"dashboard.pending-approvals.includes-covering",
							"Includes {count, plural, one {# approval} other {# approvals}} you cover for",
							{ count: coveringCount },
						)}
					</p>
				)}
				<p className="text-xs opacity-90">
					{isUrgent
						? t("dashboard.pending-approvals.requires-attention", "Requires immediate attention")
						: t("dashboard.pending-approvals.awaiting-approval", "Awaiting your approval")}
				</p>
			</div>
		</div>
	);
}

function TypePills({
	typeCounts,
	labels,
}: {
	typeCounts: PendingApprovalsData["typeCounts"];
	labels: Record<ApprovalInboxType, string>;
}) {
	const { t } = useTranslate();
	return (
		<ul
			aria-label={t("dashboard.pending-approvals.by-type", "Pending approvals by type")}
			className="flex flex-wrap gap-2"
		>
			{typeCounts.map(({ type, count, atLeast }) => (
				<li key={type}>
					<Link
						href={`/approvals/inbox?types=${type}`}
						className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					>
						<span>{labels[type]}</span>{" "}
						<span className="rounded-full bg-muted px-1.5 font-semibold tabular-nums">
							{/* Its count failed: the rows in hand, and more may wait (#1978). */}
							{atLeast
								? t("dashboard.pending-approvals.type-count-at-least", "{count}+", { count })
								: count}
						</span>
					</Link>
				</li>
			))}
		</ul>
	);
}

function PreviewRow({
	item,
	typeLabel,
	text,
}: {
	item: PendingApprovalPreviewItem;
	typeLabel: string;
	text: (value: string | ApprovalInboxLocalizedText) => string;
}) {
	const { t } = useTranslate();
	const detail = text(item.detail);
	return (
		<li className="rounded-lg bg-muted/50 p-2.5">
			<div className="flex items-center justify-between gap-2">
				<p className="min-w-0 truncate font-medium text-sm">
					{item.requesterName || t("common.unknown", "Unknown")}
				</p>
				<Badge variant="outline" className="shrink-0 text-xs">
					{typeLabel}
				</Badge>
			</div>
			<p className="truncate text-xs text-muted-foreground">
				<span>{text(item.title)}</span>
				{detail ? (
					<>
						{" · "}
						<span>{detail}</span>
					</>
				) : null}
			</p>
			{item.ownRequest ? (
				<p className="mt-1 text-xs font-medium text-muted-foreground">{getOwnRequestNote(t)}</p>
			) : null}
			{item.coveringForName ? (
				<p className="mt-1 inline-flex items-center gap-1 text-xs text-primary">
					<IconUserShare className="size-3.5" aria-hidden="true" />
					{t("dashboard.pending-approvals.covering-for", "Covering for {name}", {
						name: item.coveringForName,
					})}
				</p>
			) : null}
		</li>
	);
}

/** Each kind of failure in its own words, as the inbox tells its warnings apart (#1978). */
function usePartialFailureText(
	locale: string,
	labels: Record<ApprovalInboxType, string>,
	notLoadedTypes: ApprovalInboxType[],
	notCountedTypes: ApprovalInboxType[],
) {
	const { t } = useTranslate();
	const listFormat = useMemo(
		() => new Intl.ListFormat(locale, { type: "conjunction" }),
		[locale],
	);
	const typeList = (types: ApprovalInboxType[]) =>
		listFormat.format(types.map((type) => labels[type]));
	return [
		notLoadedTypes.length > 0
			? t(
					"dashboard.pending-approvals.not-loaded",
					"Some approvals could not be loaded ({types}). The list and totals may be incomplete.",
					{ types: typeList(notLoadedTypes) },
				)
			: null,
		notCountedTypes.length > 0
			? t(
					"dashboard.pending-approvals.not-counted",
					"Some approvals could not be counted ({types}). Totals may be incomplete.",
					{ types: typeList(notCountedTypes) },
				)
			: null,
	]
		.filter((sentence) => sentence !== null)
		.join(" ");
}

function ReviewAllApprovals() {
	const { t } = useTranslate();
	return (
		<Button className="w-full group" asChild>
			<Link href="/approvals/inbox">
				{t("dashboard.pending-approvals.review-all", "Review All Approvals")}
				<IconArrowRight
					className="ml-2 size-4 transition-transform group-hover:translate-x-1"
					aria-hidden="true"
				/>
			</Link>
		</Button>
	);
}

function PendingApprovalsSummary({
	data,
	total,
	preview,
	incomplete,
	typeLabels,
	text,
}: {
	data: PendingApprovalsData;
	total: number;
	preview: PendingApprovalPreviewItem[];
	incomplete: boolean;
	typeLabels: Record<ApprovalInboxType, string>;
	text: (value: string | ApprovalInboxLocalizedText) => string;
}) {
	const { t } = useTranslate();
	const itemTypeLabels = getApprovalItemTypeLabels(t);
	return (
		<>
			<UrgencyIndicator total={total} coveringCount={data.coveringCount} incomplete={incomplete} />
			<TypePills typeCounts={data.typeCounts} labels={typeLabels} />
			<ul
				aria-label={t("dashboard.pending-approvals.most-urgent", "Most urgent pending approvals")}
				className="space-y-2"
			>
				{preview.map((item) => (
					<PreviewRow
						key={`${item.type}:${item.id}`}
						item={item}
						typeLabel={itemTypeLabels[item.type]}
						text={text}
					/>
				))}
			</ul>
			<ReviewAllApprovals />
		</>
	);
}

export function PendingApprovalsWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<DashboardWidgetData["pending-approvals"]>;
} = {}) {
	const { t } = useTranslate();
	const tolgee = useTolgee();
	const locale = tolgee.getLanguage() || "en";
	const { data, loading, refreshing, refetch, error } = useDashboardWidget(
		"pending-approvals",
		initialSnapshot,
	);
	const typeLabels = getApprovalTypeLabels(t);
	// List summaries never name a per diem place (#1978): no travel expense catalog here.
	const text = useApprovalInboxSummaryText(locale);
	const preview = data?.preview ?? [];
	// A failed count leaves its listed rows out of the total: never state fewer than are shown.
	const total = Math.max(data?.total ?? 0, preview.length);
	// A source failed: what loaded still shows, as the inbox tells its warnings apart (#1978).
	const partialFailure = usePartialFailureText(
		locale,
		typeLabels,
		data?.notLoadedTypes ?? [],
		data?.notCountedTypes ?? [],
	);
	const title = t("dashboard.pending-approvals.title", "Pending Approvals");

	return (
		<DashboardWidget id="pending-approvals">
			<WidgetCard
				title={title}
				description={t(
					"dashboard.pending-approvals.description",
					"Requests awaiting your decision",
				)}
				icon={<IconClock className="size-4 text-amber-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				<div className="space-y-4">
					{!error && partialFailure ? (
						<WidgetReadError
							title={title}
							message={partialFailure}
							retry={refetch}
							refreshing={refreshing}
						/>
					) : null}
					{error ? (
						<WidgetReadError
							title={title}
							message={error}
							retry={refetch}
							refreshing={refreshing}
						/>
					) : total === 0 && partialFailure ? (
						// Nothing counted or listed, but not nothing pending: the inbox may still list some.
						<ReviewAllApprovals />
					) : !data || total === 0 ? (
						<p role="status">{t("dashboard.pending-approvals.empty", "No pending approvals")}</p>
					) : (
						<PendingApprovalsSummary
							data={data}
							total={total}
							preview={preview}
							incomplete={partialFailure !== ""}
							typeLabels={typeLabels}
							text={text}
						/>
					)}
				</div>
			</WidgetCard>
		</DashboardWidget>
	);
}
