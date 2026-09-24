"use client";

import {
	IconExternalLink,
	IconLoader2,
	IconRefresh,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useDisplayContext } from "@/hooks/use-display-context";
import type { EscalationAttentionView } from "@/lib/approvals/escalation/management-overview";
import { Link } from "@/navigation";
import {
	attentionEventLabel,
	attentionReasonLabel,
	channelLabel,
	type EscalationTranslate,
	formatEscalationInstant,
} from "./escalation-labels";

function formatEvidenceValue(value: unknown): string {
	if (value === null || value === undefined) return "—";
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return String(value);
	}
	return JSON.stringify(value);
}

function AttentionFacts({
	item,
	t,
}: {
	item: EscalationAttentionView;
	t: EscalationTranslate;
}) {
	const displayContext = useDisplayContext();
	const facts: Array<[string, string]> = [
		[
			t(
				"settings.approvalEscalation.attention.currentApprover",
				"Current assignment",
			),
			item.currentApprover?.name ??
				t(
					"settings.approvalEscalation.attention.unknownApprover",
					"Not recorded",
				),
		],
		[
			t("settings.approvalEscalation.attention.approvalType", "Approval"),
			[item.approvalType, item.approvalRequestId ?? item.workflowId]
				.filter(Boolean)
				.join(" · ") || "—",
		],
		[
			t("settings.approvalEscalation.attention.firstRaised", "First raised"),
			formatEscalationInstant(item.firstRaisedAt, displayContext),
		],
		[
			t("settings.approvalEscalation.attention.lastObserved", "Last observed"),
			t(
				"settings.approvalEscalation.attention.lastObservedValue",
				"{date} ({count}×)",
				{
					date: formatEscalationInstant(item.lastObservedAt, displayContext),
					count: item.observationCount,
				},
			),
		],
	];
	if (item.deliveryChannel) {
		facts.push([
			t("settings.approvalEscalation.attention.channel", "Channel"),
			channelLabel(item.deliveryChannel),
		]);
	}
	if (item.policyRevision !== null) {
		facts.push([
			t(
				"settings.approvalEscalation.attention.policyRevision",
				"Policy revision",
			),
			String(item.policyRevision),
		]);
	}

	return (
		<dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
			{facts.map(([label, value]) => (
				<div key={label} className="min-w-0">
					<dt className="text-muted-foreground">{label}</dt>
					<dd className="break-words">{value}</dd>
				</div>
			))}
		</dl>
	);
}

function AttentionDetails({
	item,
	t,
}: {
	item: EscalationAttentionView;
	t: EscalationTranslate;
}) {
	const displayContext = useDisplayContext();
	const evidence = Object.entries(item.evidence);

	return (
		<details className="group text-sm">
			<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
				{t(
					"settings.approvalEscalation.attention.details",
					"Evidence, attempts and history",
				)}
			</summary>
			<div className="mt-3 space-y-4">
				<section className="space-y-1">
					<h4 className="font-medium">
						{t("settings.approvalEscalation.attention.evidence", "Evidence")}
					</h4>
					{evidence.length === 0 ? (
						<p className="text-muted-foreground">—</p>
					) : (
						<dl className="space-y-1">
							{evidence.map(([key, value]) => (
								<div key={key} className="flex min-w-0 flex-wrap gap-x-2">
									<dt className="text-muted-foreground">{key}</dt>
									<dd className="min-w-0 break-all font-mono text-xs leading-5">
										{formatEvidenceValue(value)}
									</dd>
								</div>
							))}
						</dl>
					)}
				</section>
				<section className="space-y-1">
					<h4 className="font-medium">
						{t("settings.approvalEscalation.attention.attempts", "Attempts")}
					</h4>
					{item.attempts.length === 0 ? (
						<p className="text-muted-foreground">
							{t(
								"settings.approvalEscalation.attention.noAttempts",
								"No related attempts recorded.",
							)}
						</p>
					) : (
						<ul className="space-y-1">
							{item.attempts.map((attempt) => (
								<li
									key={`${attempt.at}-${attempt.kind}-${attempt.channel ?? ""}-${attempt.reference ?? ""}`}
									className="break-words"
								>
									{formatEscalationInstant(attempt.at, displayContext)} ·{" "}
									{attempt.kind}
									{attempt.channel ? ` · ${channelLabel(attempt.channel)}` : ""}{" "}
									· {attempt.outcome}
								</li>
							))}
						</ul>
					)}
				</section>
				<section className="space-y-1">
					<h4 className="font-medium">
						{t("settings.approvalEscalation.attention.history", "History")}
					</h4>
					<ol className="space-y-1">
						{item.events.map((event) => (
							<li
								key={`${event.createdAt}-${event.eventType}`}
								className="break-words"
							>
								{formatEscalationInstant(event.createdAt, displayContext)} ·{" "}
								{attentionEventLabel(event.eventType, t)}
								{event.actorName ? ` · ${event.actorName}` : ""}
							</li>
						))}
					</ol>
				</section>
			</div>
		</details>
	);
}

function DisposeAttentionDialog({
	item,
	isSubmitting,
	onClose,
	onDispose,
}: {
	item: EscalationAttentionView | null;
	isSubmitting: boolean;
	onClose: () => void;
	onDispose: (attentionId: string, note: string) => Promise<boolean>;
}) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: { note: "" },
		onSubmit: async ({ value, formApi }) => {
			if (!item) return;
			if (await onDispose(item.id, value.note)) {
				formApi.reset();
				onClose();
			}
		},
	});

	return (
		<Dialog
			open={item !== null}
			onOpenChange={(open) => {
				if (!open && !isSubmitting) {
					form.reset();
					onClose();
				}
			}}
		>
			<DialogContent>
				<form
					className="space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{t(
								"settings.approvalEscalation.dispose.title",
								"Close attention item",
							)}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.approvalEscalation.dispose.description",
								"Closing records your decision in the audit log. It does not reassign the approval or allow another automatic escalation.",
							)}
						</DialogDescription>
					</DialogHeader>
					<form.Field
						name="note"
						validators={{
							onSubmit: ({ value }) =>
								value.trim()
									? undefined
									: t(
											"settings.approvalEscalation.dispose.noteRequired",
											"Enter a disposition note.",
										),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label htmlFor="attention-disposition-note">
									{t(
										"settings.approvalEscalation.dispose.noteLabel",
										"Disposition note",
									)}
								</Label>
								<Textarea
									id="attention-disposition-note"
									name="note"
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									maxLength={2000}
									rows={4}
									disabled={isSubmitting}
									aria-invalid={field.state.meta.errors.length > 0}
								/>
								{field.state.meta.errors.length > 0 ? (
									<p className="text-sm text-destructive" role="alert">
										{field.state.meta.errors.join(" ")}
									</p>
								) : null}
							</div>
						)}
					</form.Field>
					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={onClose}
							disabled={isSubmitting}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? (
								<IconLoader2
									className="mr-2 size-4 motion-safe:animate-spin"
									aria-hidden="true"
								/>
							) : null}
							{t("settings.approvalEscalation.dispose.confirm", "Close item")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

export function EscalationAttentionCard({
	openAttention,
	closedAttention,
	isRechecking,
	isDisposing,
	onRecheck,
	onDispose,
}: {
	openAttention: EscalationAttentionView[];
	closedAttention: EscalationAttentionView[];
	isRechecking: boolean;
	isDisposing: boolean;
	onRecheck: () => void;
	onDispose: (attentionId: string, note: string) => Promise<boolean>;
}) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const [disposing, setDisposing] = useState<EscalationAttentionView | null>(
		null,
	);

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 space-y-1.5">
						<CardTitle>
							{t(
								"settings.approvalEscalation.attention.title",
								"Needs attention",
							)}
							{openAttention.length > 0 ? (
								<Badge variant="destructive" className="ml-2 align-middle">
									{openAttention.length}
								</Badge>
							) : null}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.approvalEscalation.attention.description",
								"Unresolved escalation conditions stay here until they are resolved or an approval manager closes them. Alerts to admins do not close them.",
							)}
						</CardDescription>
					</div>
					<Button
						variant="outline"
						size="sm"
						onClick={onRecheck}
						disabled={isRechecking}
					>
						{isRechecking ? (
							<IconLoader2
								className="mr-2 size-4 motion-safe:animate-spin"
								aria-hidden="true"
							/>
						) : (
							<IconRefresh className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("settings.approvalEscalation.attention.recheck", "Recheck")}
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{openAttention.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.approvalEscalation.attention.empty",
							"Nothing needs attention.",
						)}
					</p>
				) : (
					<ul className="space-y-3">
						{openAttention.map((item) => (
							<li key={item.id} className="space-y-3 rounded-lg border p-4">
								<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
									<div className="min-w-0 space-y-1">
										<h3 className="font-medium">
											{attentionReasonLabel(item.reason, t)}
										</h3>
										{item.adminAlertedAt ? (
											<p className="text-xs text-muted-foreground">
												{t(
													"settings.approvalEscalation.attention.alertedAt",
													"Admins alerted {date}",
													{
														date: formatEscalationInstant(
															item.adminAlertedAt,
															displayContext,
														),
													},
												)}
											</p>
										) : null}
									</div>
									<div className="flex shrink-0 gap-2">
										<Button asChild variant="outline" size="sm">
											<Link href={item.approvalHref}>
												<IconExternalLink
													className="mr-2 size-4"
													aria-hidden="true"
												/>
												{t(
													"settings.approvalEscalation.attention.openApproval",
													"Open approvals",
												)}
											</Link>
										</Button>
										<Button
											size="sm"
											variant="secondary"
											onClick={() => setDisposing(item)}
										>
											{t(
												"settings.approvalEscalation.attention.dispose",
												"Close…",
											)}
										</Button>
									</div>
								</div>
								<AttentionFacts item={item} t={t} />
								<AttentionDetails item={item} t={t} />
							</li>
						))}
					</ul>
				)}

				{closedAttention.length > 0 ? (
					<details className="text-sm">
						<summary className="cursor-pointer text-muted-foreground hover:text-foreground">
							{t(
								"settings.approvalEscalation.attention.recentlyClosed",
								"Recently closed ({count})",
								{
									count: closedAttention.length,
								},
							)}
						</summary>
						<ul className="mt-3 space-y-2">
							{closedAttention.map((item) => (
								<li key={item.id} className="rounded-md border p-3">
									<div className="flex flex-wrap items-center gap-2">
										<span className="font-medium">
											{attentionReasonLabel(item.reason, t)}
										</span>
										<Badge variant="secondary">
											{item.status === "disposed"
												? t(
														"settings.approvalEscalation.attention.disposed",
														"Closed by manager",
													)
												: t(
														"settings.approvalEscalation.attention.resolved",
														"Resolved",
													)}
										</Badge>
										{item.closedAt ? (
											<span className="text-muted-foreground">
												{formatEscalationInstant(item.closedAt, displayContext)}
											</span>
										) : null}
									</div>
									{item.status === "disposed" ? (
										<p className="mt-1 break-words text-muted-foreground">
											{item.disposedByName ?? "—"}: {item.closureNote}
										</p>
									) : null}
								</li>
							))}
						</ul>
					</details>
				) : null}
			</CardContent>

			<DisposeAttentionDialog
				item={disposing}
				isSubmitting={isDisposing}
				onClose={() => setDisposing(null)}
				onDispose={onDispose}
			/>
		</Card>
	);
}
