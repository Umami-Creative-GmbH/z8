"use client";

import {
	IconAlertTriangle,
	IconExternalLink,
	IconLoader2,
	IconRefresh,
	IconRotate,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ReportDocumentExportButtons } from "@/components/reports/report-document-export-buttons";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
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
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useDisplayContext } from "@/hooks/use-display-context";
import { accountingProviderName } from "@/lib/billable-time/accounting/views";
import { formatBillableAmount } from "@/lib/billable-time/format";
import { buildTimesheetDocument } from "@/lib/billable-time/hand-off/timesheet-document";
import type {
	DraftToolStatusView,
	InvoiceDraftDetailView,
	InvoicedWorkView,
} from "@/lib/billable-time/hand-off/views";
import { queryKeys } from "@/lib/query/keys";
import { useHandOffLabels } from "./hand-off-labels";

type ActionResult<T> = { success: true; data: T } | { success: false; error: string };

/** The server actions the panel calls (injected so the page owns them). */
export interface InvoiceDraftPanelActions {
	load(draftId: string): Promise<ActionResult<InvoiceDraftDetailView>>;
	checkStatus(draftId: string): Promise<ActionResult<DraftToolStatusView>>;
	retry(draftId: string): Promise<ActionResult<{ status: "created" | "pending" }>>;
	release(draftId: string, reason: string): Promise<ActionResult<{ workReturned: number }>>;
	clearMarks(invoicedWorkIds: string[]): Promise<ActionResult<{ cleared: number }>>;
}

async function unwrap<T>(result: Promise<ActionResult<T>>): Promise<T> {
	const settled = await result;
	if (!settled.success) throw new Error(settled.error);
	return settled.data;
}

/**
 * One hand-off (#903): its lines, the draft's status in the accounting tool
 * (asked when the panel opens), release, retry of a pending hand-off, the
 * timesheet download and the work marked as changed after invoicing.
 */
export function InvoiceDraftPanel({
	draftId,
	onOpenChange,
	actions,
	onChanged,
}: {
	draftId: string | null;
	onOpenChange: (open: boolean) => void;
	actions: InvoiceDraftPanelActions;
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const labels = useHandOffLabels();
	const detail = useQuery({
		queryKey: queryKeys.billableTime.invoiceDraft(draftId ?? ""),
		queryFn: () => unwrap(actions.load(draftId ?? "")),
		enabled: draftId !== null,
	});

	return (
		<ActionPanel open={draftId !== null} onOpenChange={onOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>
						{detail.data
							? t("settings.billableTime.handOff.detail.title", "Hand-off to {customer}", {
									customer: detail.data.customerName,
								})
							: t("settings.billableTime.handOff.detail.loading", "Hand-off")}
					</ActionPanelTitle>
					{detail.data && (
						<ActionPanelDescription>
							{labels.period(detail.data.period)} ·{" "}
							{accountingProviderName(detail.data.providerKind)}
						</ActionPanelDescription>
					)}
				</ActionPanelHeader>
				<ActionPanelBody>
					{detail.isPending && draftId !== null ? (
						<IconLoader2
							aria-label={t("common.loading", "Loading")}
							className="size-6 animate-spin text-muted-foreground"
						/>
					) : detail.isError ? (
						<p role="alert" className="text-destructive text-sm">
							{detail.error.message}
						</p>
					) : detail.data ? (
						<DraftDetail
							draft={detail.data}
							actions={actions}
							onChanged={() => {
								void detail.refetch();
								onChanged();
							}}
						/>
					) : null}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function useInvoiceDraftDetail({
	draft,
	actions,
	onChanged,
}: {
	draft: InvoiceDraftDetailView;
	actions: InvoiceDraftPanelActions;
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const { locale } = useDisplayContext();
	const labels = useHandOffLabels();
	const money = (amount: string) => formatBillableAmount(locale, amount, draft.currency);
	const [releasing, setReleasing] = useState(false);
	const [reason, setReason] = useState("");
	const [isPending, startTransition] = useTransition();

	const toolStatus = useQuery({
		queryKey: queryKeys.billableTime.invoiceDraftStatus(draft.id),
		queryFn: () => unwrap(actions.checkStatus(draft.id)),
		enabled: draft.status === "created" && draft.statusCheckSupported,
		staleTime: 0,
	});
	const gone = toolStatus.data?.kind === "gone";
	const releasable = draft.status === "created" || draft.status === "pending";
	const marked = draft.work.filter((item) => item.changedAfterInvoicingAt !== null);

	function run<T>(action: () => Promise<ActionResult<T>>, success: (data: T) => string) {
		startTransition(async () => {
			const result = await action();
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(success(result.data));
			onChanged();
		});
	}

	return {
		draft,
		labels,
		t,
		toolStatus,
		gone,
		isPending,
		run,
		actions,
		money,
		marked,
		releasable,
		setReleasing,
		releasing,
		reason,
		setReason,
	};
}

function DraftDetail({
	draft,
	actions,
	onChanged,
}: {
	draft: InvoiceDraftDetailView;
	actions: InvoiceDraftPanelActions;
	onChanged: () => void;
}) {
	const {
		labels,
		t,
		toolStatus,
		gone,
		isPending,
		run,
		money,
		marked,
		releasable,
		setReleasing,
		releasing,
		reason,
		setReason,
	} = useInvoiceDraftDetail({ draft, actions, onChanged });
	return (
		<div className="space-y-6">
			<InvoiceDraftStatus draft={draft} labels={labels} t={t} toolStatus={toolStatus} />

			{gone && (
				<div
					role="alert"
					className="flex gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm"
				>
					<IconAlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
					<p>
						{t(
							"settings.billableTime.handOff.detail.gone",
							"The accounting tool no longer has this draft. If it was deleted on purpose, release the hand-off so its work can be handed off again.",
						)}
					</p>
				</div>
			)}
			{draft.status === "pending" && (
				<div role="status" className="space-y-2 rounded-md border p-3 text-sm">
					<p>
						{draft.outcomeUnknown
							? t(
									"settings.billableTime.handOff.detail.pendingUnknown",
									"The accounting tool did not answer. Retry to finish this hand-off: it finds a draft that was already created and never creates a second one.",
								)
							: t(
									"settings.billableTime.handOff.detail.pending",
									"The accounting tool has not created this draft yet. Retry to finish the hand-off.",
								)}
					</p>
					{draft.lastFailureMessage && (
						<p className="text-muted-foreground">{draft.lastFailureMessage}</p>
					)}
					<Button
						size="sm"
						disabled={isPending}
						onClick={() =>
							run(
								() => actions.retry(draft.id),
								(data) =>
									data.status === "created"
										? t("settings.billableTime.handOff.confirmed", "The invoice draft was created")
										: t(
												"settings.billableTime.handOff.pending",
												"The accounting tool did not confirm the draft yet. Retry the hand-off.",
											),
							)
						}
					>
						<IconRefresh aria-hidden="true" className="mr-2 size-4" />
						{t("settings.billableTime.handOff.preview.retry", "Retry hand-off")}
					</Button>
				</div>
			)}
			{draft.status === "released" && draft.releaseReason && (
				<p className="text-muted-foreground text-sm">
					{t("settings.billableTime.handOff.detail.releaseReason", "Released: {reason}", {
						reason: draft.releaseReason,
					})}
				</p>
			)}

			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{t("settings.billableTime.handOff.preview.line", "Line")}</TableHead>
						<TableHead className="text-right">
							{t("settings.billableTime.handOff.preview.hours", "Hours")}
						</TableHead>
						<TableHead className="text-right">
							{t("settings.billableTime.handOff.preview.rate", "Rate")}
						</TableHead>
						<TableHead className="text-right">
							{t("settings.billableTime.handOff.preview.amount", "Amount")}
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{draft.lines
						.filter((line) => line.kind === "work")
						.map((line) => (
							<TableRow key={line.position}>
								<TableCell>{line.text}</TableCell>
								<TableCell className="text-right tabular-nums">
									{line.hours && labels.hours(line.hours)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{line.rate && money(line.rate)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{line.amount && money(line.amount)}
								</TableCell>
							</TableRow>
						))}
				</TableBody>
				<TableFooter>
					<TableRow>
						<TableCell colSpan={3}>
							{t("settings.billableTime.handOff.preview.total", "Net total")}
						</TableCell>
						<TableCell className="text-right font-semibold tabular-nums">
							{money(draft.netTotal)}
						</TableCell>
					</TableRow>
				</TableFooter>
			</Table>

			<section className="space-y-2">
				<h3 className="font-medium text-sm">
					{t("settings.billableTime.handOff.detail.timesheet", "Timesheet")}
				</h3>
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.billableTime.handOff.detail.timesheetHelp",
						"The itemized work behind this hand-off, to send alongside the invoice.",
					)}
				</p>
				<ReportDocumentExportButtons
					formats={["pdf", "csv"]}
					buildDocument={({ generatedAt }) =>
						buildTimesheetDocument(draft, { labels: labels.timesheet, generatedAt })
					}
				/>
			</section>

			<MarkedWork
				marked={marked}
				disabled={isPending}
				onClear={(ids) =>
					run(
						() => actions.clearMarks(ids),
						(data) =>
							t(
								"settings.billableTime.handOff.marks.cleared",
								"{count, plural, one {# mark cleared} other {# marks cleared}}",
								{ count: data.cleared },
							),
					)
				}
			/>

			{releasable && (
				<div className="flex justify-end border-t pt-4">
					<Button variant="outline" disabled={isPending} onClick={() => setReleasing(true)}>
						<IconRotate aria-hidden="true" className="mr-2 size-4" />
						{t("settings.billableTime.handOff.release.action", "Release")}
					</Button>
				</div>
			)}

			<AlertDialog open={releasing} onOpenChange={setReleasing}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.billableTime.handOff.release.title", "Release this hand-off?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.billableTime.handOff.release.description",
								"Its work becomes un-invoiced again and can be handed off anew. Z8 does not change the draft in the accounting tool: delete or cancel it there yourself.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="space-y-2">
						<Label htmlFor="hand-off-release-reason">
							{t("settings.billableTime.handOff.release.reason", "Reason (optional)")}
						</Label>
						<Textarea
							id="hand-off-release-reason"
							value={reason}
							maxLength={500}
							onChange={(event) => setReason(event.target.value)}
						/>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								setReleasing(false);
								run(
									() => actions.release(draft.id, reason),
									(data) =>
										t(
											"settings.billableTime.handOff.release.done",
											"Released. {count, plural, one {# work period is} other {# work periods are}} un-invoiced again.",
											{ count: data.workReturned },
										),
								);
							}}
						>
							{t("settings.billableTime.handOff.release.confirm", "Release")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

/** Invoiced work marked as changed after invoicing, with clearing. */
export function MarkedWork({
	marked,
	disabled,
	onClear,
}: {
	marked: readonly InvoicedWorkView[];
	disabled: boolean;
	onClear: (invoicedWorkIds: string[]) => void;
}) {
	const { t } = useTranslate();
	const labels = useHandOffLabels();
	if (marked.length === 0) return null;
	return (
		<section className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h3 className="font-medium text-sm">
					{t("settings.billableTime.handOff.marks.title", "Changed after invoicing")}
				</h3>
				<Button
					size="sm"
					variant="outline"
					disabled={disabled}
					onClick={() => onClear(marked.map((item) => item.invoicedWorkId))}
				>
					{t("settings.billableTime.handOff.marks.clearAll", "Clear all marks")}
				</Button>
			</div>
			<p className="text-muted-foreground text-sm">
				{t(
					"settings.billableTime.handOff.marks.help",
					"This invoiced work was corrected after its hand-off. Correct the invoice in the accounting tool if needed (for example with a credit note), then clear the mark.",
				)}
			</p>
			<ul className="divide-y rounded-md border text-sm">
				{marked.map((item) => (
					<li key={item.invoicedWorkId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-2">
						<span className="tabular-nums">{labels.day(item.day)}</span>
						<span>{item.employeeName}</span>
						<span className="text-muted-foreground">{item.projectName}</span>
						<span className="flex flex-wrap gap-1">
							{item.changedFields.map((field) => (
								<Badge key={field} variant="outline">
									{labels.changedField(field)}
								</Badge>
							))}
						</span>
						<Button
							size="sm"
							variant="ghost"
							className="ml-auto"
							disabled={disabled}
							onClick={() => onClear([item.invoicedWorkId])}
						>
							{t("settings.billableTime.handOff.marks.clear", "Clear mark")}
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}

function InvoiceDraftStatus({
	draft,
	labels,
	t,
	toolStatus,
}: Pick<ReturnType<typeof useInvoiceDraftDetail>, "draft" | "labels" | "t" | "toolStatus">) {
	return (
		<div className="flex flex-wrap items-center gap-2">
			<Badge variant={draft.status === "created" ? "default" : "secondary"}>
				{labels.status(draft.status)}
			</Badge>
			{draft.externalUrl && (
				<a
					href={draft.externalUrl}
					target="_blank"
					rel="noreferrer"
					className="inline-flex items-center gap-1 text-sm underline"
				>
					{t("settings.billableTime.handOff.detail.openInTool", "Open in the accounting tool")}
					<IconExternalLink aria-hidden="true" className="size-4" />
				</a>
			)}
			{draft.status === "created" && draft.statusCheckSupported && (
				<span className="text-muted-foreground text-sm">
					{toolStatus.isFetching
						? t("settings.billableTime.handOff.detail.checking", "Checking the draft in the tool…")
						: toolStatus.data?.kind === "status"
							? t("settings.billableTime.handOff.detail.toolStatus", "In the tool: {status}", {
									status: toolStatus.data.toolStatus,
								})
							: toolStatus.data?.kind === "unavailable"
								? toolStatus.data.message
								: null}
				</span>
			)}
		</div>
	);
}
