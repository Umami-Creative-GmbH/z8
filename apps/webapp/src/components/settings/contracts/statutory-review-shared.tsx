"use client";

import { IconAlertTriangle, IconChevronDown, IconHistory } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { type ReactNode, useId, useState } from "react";
import { listStatutoryAcknowledgementHistoryAction } from "@/app/[locale]/(app)/settings/contracts/statutory-review-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant, localeDefaultTimeFormat } from "@/lib/datetime/temporal-format";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type {
	StatutoryAcknowledgementHistoryState,
	StatutoryAcknowledgementReviewStatus,
} from "@/lib/statutory/acknowledgement-history";
import {
	isStatutoryReviewDomain,
	type StatutoryReviewDomain,
} from "@/lib/statutory/review-domains";
import { cn } from "@/lib/utils";
import {
	type StatutoryAcknowledgementHistorySubject,
	statutoryAcknowledgementHistoryQueryKey,
} from "./statutory-review-query-keys";

// Shared pieces of the unified Settings → Contracts → Reviews & Conflicts inbox (#1994).

type Translate = ReturnType<typeof useTranslate>["t"];

/** The inbox's domain filter: every statutory domain plus the contract migration and departure reviews. */
export type ReviewDomainFilter = "all" | StatutoryReviewDomain | "migration_departure";

export const reviewDomainFilters: readonly ReviewDomainFilter[] = [
	"all",
	"minijob",
	"short_term",
	"working_student",
	"on_call",
	"youth_apprentice",
	"migration_departure",
];

/** The filter a deep link asks for (`?domain=`), or "all". */
export function parseReviewDomainFilter(value: string | null | undefined): ReviewDomainFilter {
	if (!value) return "all";
	return value === "migration_departure" || isStatutoryReviewDomain(value) ? value : "all";
}

export function reviewDomainLabel(filter: ReviewDomainFilter, t: Translate): string {
	switch (filter) {
		case "all":
			return t("settings.contracts.reviews.domain.all", "All");
		case "minijob":
			return t("settings.contracts.reviews.domain.minijob", "Minijob");
		case "short_term":
			return t("settings.contracts.reviews.domain.shortTerm", "Short-Term");
		case "working_student":
			return t("settings.contracts.reviews.domain.workingStudent", "Working Student");
		case "on_call":
			return t("settings.contracts.reviews.domain.onCall", "On-Call");
		case "youth_apprentice":
			return t("settings.contracts.reviews.domain.youthApprentice", "Youth & Apprentice");
		case "migration_departure":
			return t("settings.contracts.reviews.domain.migrationDeparture", "Migration & Departure");
	}
}

/**
 * Classes that highlight an item whose acknowledgement no longer documents it: newer work, shifts
 * or figures invalidated it (`stale`), or the finding can no longer be acknowledged
 * (`no_longer_applies`).
 */
export function invalidatedItemClassName(status: string | null | undefined): string {
	return status === "stale" || status === "no_longer_applies"
		? "border-amber-500/70 bg-amber-50/60 dark:border-amber-400/60 dark:bg-amber-950/30"
		: "";
}

/** Says, next to a highlighted item, why its acknowledgement no longer holds. */
export function InvalidatedAcknowledgementNotice({
	status = "stale",
	className,
	children,
}: {
	/** `stale` (the default): acknowledge again if it still holds; `no_longer_applies`: it cannot be. */
	status?: "stale" | "no_longer_applies";
	className?: string;
	/** A domain's own wording; the generic one otherwise. */
	children?: ReactNode;
}) {
	const { t } = useTranslate();
	const generic =
		status === "no_longer_applies"
			? t(
					"settings.contracts.reviews.noLongerApplies",
					"Acknowledgement no longer applies: the finding can no longer be acknowledged, so the documented reason no longer counts. Change the schedule or the contract instead.",
				)
			: t(
					"settings.contracts.reviews.invalidated",
					"Acknowledgement invalidated: the work, shifts or figures changed after it was recorded. Review the current figures and acknowledge again if it still holds.",
				);
	return (
		<p
			className={cn(
				"flex items-start gap-1.5 text-amber-800 text-xs dark:text-amber-300",
				className,
			)}
		>
			<IconAlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
			<span>{children ?? generic}</span>
		</p>
	);
}

function historyStateLabel(state: StatutoryAcknowledgementHistoryState, t: Translate) {
	switch (state) {
		case "current":
			return t("settings.contracts.reviews.history.current", "Current");
		case "stale":
			return t("settings.contracts.reviews.history.stale", "Invalidated");
		case "no_longer_applies":
			return t("settings.contracts.reviews.history.noLongerApplies", "No longer applies");
		case "superseded":
			return t("settings.contracts.reviews.history.superseded", "Earlier");
	}
}

/**
 * The audited acknowledgements of one finding (who, when, reason, legal note, current or
 * invalidated), loaded when opened. Renders nothing for a finding nobody acknowledged yet.
 */
export function StatutoryAcknowledgementHistory({
	organizationId,
	subject,
	currentInputFingerprint,
	currentStatus,
}: {
	readonly organizationId: string;
	readonly subject: StatutoryAcknowledgementHistorySubject;
	readonly currentInputFingerprint: string;
	readonly currentStatus: StatutoryAcknowledgementReviewStatus | null | undefined;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const [open, setOpen] = useState(false);
	const panelId = useId();
	const status = currentStatus ?? "none";
	const query = useQuery({
		queryKey: statutoryAcknowledgementHistoryQueryKey(
			organizationId,
			subject,
			currentInputFingerprint,
			status,
		),
		queryFn: async () => {
			const result = await listStatutoryAcknowledgementHistoryAction({
				...subject,
				currentInputFingerprint,
				currentStatus: status,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
		enabled: open,
	});
	if (status === "none") return null;

	// The organization's zone, as the action returns it with the entries.
	const context = query.data
		? {
				locale,
				timezone: query.data.timezone,
				timeFormat: localeDefaultTimeFormat(locale),
			}
		: null;
	return (
		<div className="space-y-2">
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="-ml-2 h-8 text-muted-foreground"
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((value) => !value)}
			>
				<IconHistory className="size-4" aria-hidden="true" />
				{t("settings.contracts.reviews.history.toggle", "Acknowledgement history")}
				<IconChevronDown
					className={cn(
						"size-4 transition-transform motion-reduce:transition-none",
						open && "rotate-180",
					)}
					aria-hidden="true"
				/>
			</Button>
			{open ? (
				<div id={panelId}>
					{query.isPending ? (
						<p className="text-muted-foreground text-xs" role="status">
							{t("common.loading", "Loading…")}
						</p>
					) : query.isError ? (
						<p className="text-destructive text-xs" role="alert">
							{query.error.message}
						</p>
					) : context ? (
						<ol className="space-y-2 border-l pl-3">
							{query.data.entries.map((entry) => (
								<li key={entry.id} className="space-y-0.5 text-xs">
									<div className="flex flex-wrap items-center gap-2">
										<Badge
											variant={entry.state === "current" ? "secondary" : "outline"}
											className={cn(
												(entry.state === "stale" || entry.state === "no_longer_applies") &&
													"border-amber-500/70 text-amber-800 dark:text-amber-300",
												entry.state === "superseded" && "text-muted-foreground",
											)}
										>
											{historyStateLabel(entry.state, t)}
										</Badge>
										<span className="font-medium">{entry.acknowledgedByName}</span>
										<time
											className="text-muted-foreground tabular-nums"
											dateTime={new Date(entry.acknowledgedAt).toISOString()}
										>
											{formatInstant(
												instantFromDate(new Date(entry.acknowledgedAt)),
												context,
												"dateTimeMedium",
											)}
										</time>
									</div>
									{entry.state === "no_longer_applies" ? (
										<p className="text-amber-800 dark:text-amber-300">
											{t(
												"settings.contracts.reviews.history.noLongerAppliesDetail",
												"Recorded for these figures, but it does not document the current state: the finding can no longer be acknowledged.",
											)}
										</p>
									) : null}
									<p className="break-words">
										{t("settings.contracts.reviews.history.reason", "Reason: {reason}", {
											reason: entry.reason,
										})}
									</p>
									{entry.legalNote ? (
										<p className="break-words text-muted-foreground">
											{t("settings.contracts.reviews.history.legalNote", "Legal note: {note}", {
												note: entry.legalNote,
											})}
										</p>
									) : null}
								</li>
							))}
						</ol>
					) : null}
				</div>
			) : null}
		</div>
	);
}
