"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconCircle,
	IconCircleCheck,
	IconCloudOff,
	IconLoader2,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { GoLiveGroupSettings } from "@/lib/implementation-checklist/go-live/group-types";
import type { ImplementationChecklistItemStatus } from "@/lib/implementation-checklist/go-live/types";
import type { ResolvedImplementationChecklistItem } from "@/lib/implementation-checklist/status";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import {
	markImplementationChecklistItemComplete,
	markImplementationChecklistItemIncomplete,
} from "./actions";
import { FirstWorkflowsPanel } from "./first-workflows-panel";
import { GoLiveCheckPanel } from "./go-live-check-panel";
import { GoLiveReadinessCard, type GoLiveReadinessView } from "./go-live-readiness-card";
import { ManualConfirmationNote, manualConfirmationLapsed } from "./manual-confirmation-note";

/** The group card brings the employee picker; load it only when the card is shown. */
const GoLiveGroupCard = dynamic(() =>
	import("./go-live-group-card").then((module) => module.GoLiveGroupCard),
);

type ImplementationChecklistItem = Pick<
	ResolvedImplementationChecklistItem,
	| "id"
	| "title"
	| "description"
	| "helperText"
	| "actionLabel"
	| "href"
	| "status"
	| "completionSource"
	| "canToggleManualCompletion"
	| "goLive"
> &
	Partial<
		Pick<
			ResolvedImplementationChecklistItem,
			| "titleKey"
			| "descriptionKey"
			| "helperTextKey"
			| "actionLabelKey"
			| "firstWorkflows"
			| "manualConfirmation"
			| "confirmationLabel"
			| "confirmationLabelKey"
			| "confirmedLabel"
			| "confirmedLabelKey"
		>
	>;

interface ImplementationChecklistClientProps {
	checklist: {
		items: readonly ImplementationChecklistItem[];
		completedCount: number;
		totalCount: number;
		goLive: GoLiveReadinessView & {
			memberCount?: number | null;
			/** The go-live group card is shown when the loader provides it (null: couldn't load). */
			group?: GoLiveGroupSettings | null;
		};
	};
}

type Translate = ReturnType<typeof useTranslate>["t"];

export function ImplementationChecklistClient({ checklist }: ImplementationChecklistClientProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [pendingItemId, setPendingItemId] = useState<string | null>(null);
	const progressPercent = checklist.totalCount
		? Math.round((checklist.completedCount / checklist.totalCount) * 100)
		: 0;
	const controlsDisabled = isPending || pendingItemId !== null;

	function setManualCompletion(item: ImplementationChecklistItem, complete: boolean) {
		setPendingItemId(item.id);
		startTransition(async () => {
			const result = complete
				? await markImplementationChecklistItemComplete(item.id)
				: await markImplementationChecklistItemIncomplete(item.id);

			if (!result.success) {
				toast.error(
					result.error ||
						t(
							"settings.implementationChecklist.errors.updateItem",
							"Failed to update checklist item.",
						),
				);
			}

			setPendingItemId(null);
		});
	}

	return (
		<div className="space-y-6">
			<div className="space-y-2">
				<p className="font-medium text-muted-foreground text-sm">
					{t("settings.implementationChecklist.eyebrow", "Customer implementation")}
				</p>
				<div className="space-y-1">
					<h1 className="text-balance font-semibold text-2xl tracking-tight">
						{t("settings.implementationChecklist.title", "Implementation checklist")}
					</h1>
					<p className="max-w-3xl text-muted-foreground">
						{t(
							"settings.implementationChecklist.description",
							"Finish the setup steps before inviting your full team so time tracking, approvals, and payroll workflows are ready for daily use.",
						)}
					</p>
				</div>
			</div>

			<GoLiveReadinessCard goLive={checklist.goLive} />

			{checklist.goLive.group !== undefined ? (
				<GoLiveGroupCard
					group={checklist.goLive.group}
					memberCount={checklist.goLive.memberCount ?? null}
				/>
			) : null}

			<Card>
				<CardHeader>
					<CardDescription>
						{t("settings.implementationChecklist.progress.label", "Setup progress")}
					</CardDescription>
					<CardTitle className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
						<span>
							{t(
								"settings.implementationChecklist.progress.completedCount",
								"{completed} of {total} complete",
								{
									completed: checklist.completedCount,
									total: checklist.totalCount,
								},
							)}
						</span>
						<span className="font-semibold text-muted-foreground text-sm tabular-nums">
							{t(
								"settings.implementationChecklist.progress.percentComplete",
								"{percent}% complete",
								{
									percent: progressPercent,
								},
							)}
						</span>
					</CardTitle>
				</CardHeader>
				<CardContent>
					<Progress
						aria-label={t(
							"settings.implementationChecklist.progress.ariaLabel",
							"Implementation checklist progress",
						)}
						value={progressPercent}
					/>
				</CardContent>
			</Card>

			<div className="grid gap-4 lg:grid-cols-2">
				{checklist.items.map((item) => {
					const itemPending = pendingItemId === item.id;
					const confirmationLapsed = manualConfirmationLapsed(item.manualConfirmation);
					const pendingIcon = itemPending ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : null;
					const showsGoLiveDetail =
						item.goLive !== null &&
						(item.goLive.outcome === "unavailable" ||
							item.goLive.failures.length > 0 ||
							item.goLive.warnings.length > 0 ||
							item.goLive.notes.length > 0);
					const firstWorkflows = item.firstWorkflows ?? null;

					return (
						<Card
							key={item.id}
							className={cn(
								"shadow-none",
								(showsGoLiveDetail || firstWorkflows) && "lg:col-span-2",
							)}
						>
							<CardHeader>
								<div className="flex items-start gap-3">
									<StatusMarker status={item.status} />
									<div className="min-w-0 flex-1 space-y-2">
										<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
											<div className="space-y-1">
												<CardTitle>
													<h2 className="text-base font-semibold">
														{item.titleKey ? t(item.titleKey, item.title) : item.title}
													</h2>
												</CardTitle>
												<CardDescription>
													{item.descriptionKey
														? t(item.descriptionKey, item.description)
														: item.description}
												</CardDescription>
											</div>
											<div className="flex flex-wrap items-center gap-2">
												{item.goLive?.severity === "advisory" ? (
													<Badge variant="outline">
														{t("settings.implementationChecklist.goLive.optional", "Optional")}
													</Badge>
												) : null}
												<Badge variant={statusBadgeVariant(item.status)}>
													{getStatusLabel(item, t)}
												</Badge>
											</div>
										</div>
									</div>
								</div>
							</CardHeader>
							<CardContent className="space-y-4">
								<p className="text-muted-foreground text-sm">
									{item.helperTextKey ? t(item.helperTextKey, item.helperText) : item.helperText}
								</p>
								{showsGoLiveDetail && item.goLive ? (
									<GoLiveCheckPanel result={item.goLive} />
								) : null}
								{firstWorkflows ? <FirstWorkflowsPanel evidence={firstWorkflows} /> : null}
								{item.goLive &&
								item.confirmedLabel &&
								hasManualConfirmation(item) &&
								!confirmationLapsed ? (
									<p className="flex items-center gap-2 text-sm">
										<IconCheck aria-hidden="true" className="size-4 text-primary" />
										{item.confirmedLabelKey
											? t(item.confirmedLabelKey, item.confirmedLabel)
											: item.confirmedLabel}
									</p>
								) : null}
								{item.manualConfirmation ? (
									<ManualConfirmationNote confirmation={item.manualConfirmation} />
								) : null}
								<div className="flex flex-wrap items-center gap-3">
									<Button asChild size="sm">
										<Link href={item.href}>
											{item.actionLabelKey
												? t(item.actionLabelKey, item.actionLabel)
												: item.actionLabel}
										</Link>
									</Button>
									{item.canToggleManualCompletion && confirmationLapsed ? (
										<>
											<Button
												disabled={controlsDisabled}
												onClick={() => setManualCompletion(item, true)}
												size="sm"
												type="button"
												variant="outline"
											>
												{pendingIcon}
												{t(
													"settings.implementationChecklist.actions.confirmAgain",
													"Confirm again",
												)}
											</Button>
											<Button
												disabled={controlsDisabled}
												onClick={() => setManualCompletion(item, false)}
												size="sm"
												type="button"
												variant="ghost"
											>
												{removeConfirmationLabel(item, t)}
											</Button>
										</>
									) : item.canToggleManualCompletion ? (
										<Button
											disabled={controlsDisabled}
											onClick={() => setManualCompletion(item, !hasManualConfirmation(item))}
											size="sm"
											type="button"
											variant="outline"
										>
											{pendingIcon}
											{manualToggleLabel(item, t)}
										</Button>
									) : null}
								</div>
							</CardContent>
						</Card>
					);
				})}
			</div>
		</div>
	);
}

const STATUS_ICONS = {
	"not-set-up": IconCircle,
	configured: IconCheck,
	verified: IconCircleCheck,
	"needs-attention": IconAlertTriangle,
	unavailable: IconCloudOff,
} as const satisfies Record<ImplementationChecklistItemStatus, unknown>;

function StatusMarker({ status }: { status: ImplementationChecklistItemStatus }) {
	const { t } = useTranslate();
	const Icon = STATUS_ICONS[status];

	return (
		<output
			aria-label={statusText(status, t)}
			className={cn(
				"mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
				status === "verified" && "border-primary bg-primary text-primary-foreground",
				status === "configured" && "border-primary text-primary",
				status === "needs-attention" && "border-destructive text-destructive",
				(status === "not-set-up" || status === "unavailable") &&
					"border-border bg-background text-muted-foreground",
			)}
		>
			<Icon aria-hidden="true" className="size-4" />
		</output>
	);
}

function statusBadgeVariant(status: ImplementationChecklistItemStatus) {
	if (status === "verified") return "default" as const;
	if (status === "needs-attention") return "destructive" as const;
	if (status === "configured") return "secondary" as const;
	return "outline" as const;
}

function statusText(status: ImplementationChecklistItemStatus, t: Translate) {
	switch (status) {
		case "not-set-up":
			return t("settings.implementationChecklist.status.notSetUp", "Not set up");
		case "configured":
			return t("settings.implementationChecklist.status.configured", "Configured");
		case "verified":
			return t("settings.implementationChecklist.status.verified", "Verified");
		case "needs-attention":
			return t("settings.implementationChecklist.status.needsAttention", "Needs attention");
		case "unavailable":
			return t("settings.implementationChecklist.status.unavailable", "Unavailable");
	}
}

/**
 * Whether the item holds a confirmation, current or lapsed. A lapsed confirmation on a go-live
 * item is no longer its completion source, so the confirmation itself decides; items loaded
 * without confirmation details fall back to the completion source.
 */
function hasManualConfirmation(item: ImplementationChecklistItem) {
	return Boolean(item.manualConfirmation) || item.completionSource === "manual";
}

/** A go-live item's confirmation is a business sign-off, not a way to complete the item. */
function manualToggleLabel(item: ImplementationChecklistItem, t: Translate) {
	if (hasManualConfirmation(item)) {
		return removeConfirmationLabel(item, t);
	}
	if (item.goLive && item.confirmationLabel) {
		return item.confirmationLabelKey
			? t(item.confirmationLabelKey, item.confirmationLabel)
			: item.confirmationLabel;
	}
	return t("settings.implementationChecklist.actions.markComplete", "Mark complete");
}

function removeConfirmationLabel(item: ImplementationChecklistItem, t: Translate) {
	return item.goLive && item.confirmationLabel
		? t("settings.implementationChecklist.actions.removeConfirmation", "Remove confirmation")
		: t("settings.implementationChecklist.actions.markIncomplete", "Mark incomplete");
}

function getStatusLabel(item: ImplementationChecklistItem, t: Translate) {
	// First workflows is noticed from real use, so "configured" would mislead.
	if (item.firstWorkflows) {
		if (item.status === "not-set-up") {
			return t("settings.implementationChecklist.firstWorkflows.status.notStarted", "Not started");
		}
		if (item.status === "configured") {
			return t("settings.implementationChecklist.firstWorkflows.status.underWay", "Under way");
		}
		if (item.status === "verified") {
			return t("settings.implementationChecklist.firstWorkflows.status.allSeen", "All seen");
		}
	}

	if (item.status === "configured" && item.completionSource === "manual") {
		return t("settings.implementationChecklist.status.manuallyComplete", "Manually complete");
	}

	return statusText(item.status, t);
}
