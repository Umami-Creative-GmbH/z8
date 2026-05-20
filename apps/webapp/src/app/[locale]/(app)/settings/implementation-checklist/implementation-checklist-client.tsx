"use client";

import { IconCheck, IconCircle, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import {
	markImplementationChecklistItemComplete,
	markImplementationChecklistItemIncomplete,
} from "./actions";

type ChecklistStatus = "complete" | "not-started";
type CompletionSource = "automatic" | "manual" | null;

interface ImplementationChecklistItem {
	id: string;
	title: string;
	titleKey?: string;
	description: string;
	descriptionKey?: string;
	helperText: string;
	helperTextKey?: string;
	actionLabel: string;
	actionLabelKey?: string;
	href: string;
	status: ChecklistStatus;
	completionSource: CompletionSource;
	canToggleManualCompletion: boolean;
}

interface ImplementationChecklistViewModel {
	items: ImplementationChecklistItem[];
	completedCount: number;
	totalCount: number;
}

interface ImplementationChecklistClientProps {
	checklist: ImplementationChecklistViewModel;
}

export function ImplementationChecklistClient({ checklist }: ImplementationChecklistClientProps) {
	const { t } = useTranslate();
	const [isPending, startTransition] = useTransition();
	const [pendingItemId, setPendingItemId] = useState<string | null>(null);
	const progressPercent = checklist.totalCount
		? Math.round((checklist.completedCount / checklist.totalCount) * 100)
		: 0;
	const controlsDisabled = isPending || pendingItemId !== null;

	function toggleManualCompletion(item: ImplementationChecklistItem) {
		setPendingItemId(item.id);
		startTransition(async () => {
			const result =
				item.status === "complete"
					? await markImplementationChecklistItemIncomplete(item.id)
					: await markImplementationChecklistItemComplete(item.id);

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

			<Card>
				<CardHeader>
					<CardDescription>
						{t("settings.implementationChecklist.progress.label", "Setup progress")}
					</CardDescription>
					<CardTitle className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
						<span>
							{t(
								"settings.implementationChecklist.progress.completedCount",
								"{{completed}} of {{total}} complete",
								{
									completed: checklist.completedCount,
									total: checklist.totalCount,
								},
							)}
						</span>
						<span className="font-semibold text-muted-foreground text-sm tabular-nums">
							{t(
								"settings.implementationChecklist.progress.percentComplete",
								"{{percent}}% complete",
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

					return (
						<Card key={item.id} className="shadow-none">
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
													{item.descriptionKey ? t(item.descriptionKey, item.description) : item.description}
												</CardDescription>
											</div>
											<Badge variant={item.status === "complete" ? "secondary" : "outline"}>
												{getStatusLabel(item, t)}
											</Badge>
										</div>
									</div>
								</div>
							</CardHeader>
							<CardContent className="space-y-4">
								<p className="text-muted-foreground text-sm">
									{item.helperTextKey ? t(item.helperTextKey, item.helperText) : item.helperText}
								</p>
								<div className="flex flex-wrap items-center gap-3">
									<Button asChild size="sm">
										<Link href={item.href}>
											{item.actionLabelKey ? t(item.actionLabelKey, item.actionLabel) : item.actionLabel}
										</Link>
									</Button>
									{item.canToggleManualCompletion ? (
										<Button
											disabled={controlsDisabled}
											onClick={() => toggleManualCompletion(item)}
											size="sm"
											type="button"
											variant="outline"
										>
											{itemPending ? (
												<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
											) : null}
											{item.status === "complete"
												? t(
														"settings.implementationChecklist.actions.markIncomplete",
														"Mark incomplete",
													)
												: t(
														"settings.implementationChecklist.actions.markComplete",
														"Mark complete",
													)}
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

function StatusMarker({ status }: { status: ChecklistStatus }) {
	const { t } = useTranslate();
	const complete = status === "complete";
	const Icon = complete ? IconCheck : IconCircle;

	return (
		<span
			aria-label={
				complete
					? t("settings.implementationChecklist.status.complete", "Complete")
					: t("settings.implementationChecklist.status.notStarted", "Not started")
			}
			role="img"
			className={cn(
				"mt-1 inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
				complete
					? "border-primary bg-primary text-primary-foreground"
					: "border-border bg-background text-muted-foreground",
			)}
		>
			<Icon aria-hidden="true" className="size-4" />
		</span>
	);
}

function getStatusLabel(
	item: ImplementationChecklistItem,
	t: ReturnType<typeof useTranslate>["t"],
) {
	if (item.status !== "complete") {
		return t("settings.implementationChecklist.status.needsReview", "Needs review");
	}

	return item.completionSource === "manual"
		? t("settings.implementationChecklist.status.manuallyComplete", "Manually complete")
		: t("settings.implementationChecklist.status.complete", "Complete");
}
