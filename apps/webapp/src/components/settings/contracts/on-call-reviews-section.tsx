"use client";

import { IconInfoCircle, IconPhoneCall } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	acknowledgeOnCallShortNoticeAction,
	listOnCallReviewItemsAction,
} from "@/app/[locale]/(app)/settings/contracts/on-call-actions";
import {
	onCallQueryScope,
	onCallReviewsQueryKey,
} from "@/components/statutory/on-call/on-call-query-keys";
import { onCallFindingText } from "@/components/statutory/on-call/on-call-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TFormTextareaField } from "@/components/ui/tanstack-form-textarea";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import type { OnCallAcknowledgementRefusal } from "@/lib/statutory/on-call/acknowledge";
import type { OnCallReviewItem } from "@/lib/statutory/on-call/views";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { invalidateStatutoryReviewViews } from "./statutory-review-query-keys";
import {
	InvalidatedAcknowledgementNotice,
	invalidatedItemClassName,
	StatutoryAcknowledgementHistory,
} from "./statutory-review-shared";

function AcknowledgeShortNoticeForm({
	organizationId,
	shiftId,
	fingerprint,
}: {
	readonly organizationId: string;
	readonly shiftId: string;
	/** The fingerprint of the finding shown: the server refuses if the shift changed since. */
	readonly fingerprint: string;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const refusals: RefusalMessages<OnCallAcknowledgementRefusal> = {
		on_call_notice_shift_not_published: [
			"common.onCall.reviews.notPublished",
			"The shift is not published yet. Publish it before documenting the employee's agreement.",
		],
		on_call_notice_finding_not_open: [
			"common.onCall.reviews.notOpen",
			"The shift no longer has a short-notice finding.",
		],
		on_call_notice_finding_changed: [
			"common.onCall.reviews.changed",
			"The shift changed since this list was loaded. Review it again before documenting the agreement.",
		],
	};
	const acknowledge = useMutation({
		mutationFn: async (reason: string) => {
			const result = await acknowledgeOnCallShortNoticeAction({
				shiftId,
				expectedFingerprint: fingerprint,
				reason,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result, refusals));
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("common.onCall.reviews.acknowledged", "Agreement documented"));
			// Reviews & Conflicts and every Employee Detail status show these findings.
			void queryClient.invalidateQueries({ queryKey: onCallQueryScope(organizationId) });
			void invalidateStatutoryReviewViews(queryClient, organizationId);
		},
		onError: (error) => {
			toast.error(error.message);
			// A changed or closed finding: show the current one.
			void queryClient.invalidateQueries({ queryKey: onCallReviewsQueryKey(organizationId) });
		},
	});
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			await acknowledge.mutateAsync(value.reason.trim());
		},
	});

	return (
		<form
			noValidate
			className="mt-2 space-y-2"
			aria-busy={acknowledge.isPending}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="reason"
				validators={{
					onSubmit: ({ value }) =>
						value.trim()
							? undefined
							: t(
									"common.onCall.reviews.reasonRequired",
									"Describe how the employee agreed to the short notice.",
								),
				}}
			>
				{(field) => (
					<TFormTextareaField
						field={field}
						name={field.name}
						rows={2}
						maxLength={2000}
						required
						label={t(
							"common.onCall.reviews.reason",
							"Employee's voluntary agreement (§ 12 Abs. 3 TzBfG)",
						)}
					/>
				)}
			</form.Field>
			<Button type="submit" size="sm" variant="outline" disabled={acknowledge.isPending}>
				{t("common.onCall.reviews.acknowledge", "Document agreement")}
			</Button>
		</form>
	);
}

function ReviewRow({
	organizationId,
	item,
}: {
	readonly organizationId: string;
	readonly item: OnCallReviewItem;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const { finding } = item;
	const status = finding.acknowledgement?.status ?? null;
	const shiftId = finding.subjectKey.startsWith("shift:") ? finding.subjectKey.slice(6) : null;

	return (
		<li className={cn("space-y-1 rounded-lg border p-3", invalidatedItemClassName(status))}>
			<div className="flex flex-wrap items-center gap-2 text-sm">
				<Link
					className="font-medium underline-offset-4 hover:underline"
					href={`/settings/employees/${item.employeeId}`}
				>
					{item.employeeName}
				</Link>
				<Badge variant={finding.severity === "critical" ? "destructive" : "secondary"}>
					{formatPlainDate(parsePlainDate(finding.periodStart), locale, "dateMedium")}
				</Badge>
				<span>{onCallFindingText(finding, t)}</span>
				<span className="text-muted-foreground">{finding.legalReference}</span>
			</div>
			{status === "current" ? (
				<p className="mt-1 text-muted-foreground text-sm">
					{t("common.onCall.reviews.documented", "Agreement documented: {reason}", {
						reason: finding.acknowledgement?.reason ?? "",
					})}
				</p>
			) : null}
			{status === "stale" ? (
				<InvalidatedAcknowledgementNotice className="mt-1 text-sm">
					{t(
						"common.onCall.reviews.stale",
						"The shift changed after the agreement was documented. Document it again if it still holds.",
					)}
				</InvalidatedAcknowledgementNotice>
			) : null}
			{finding.acknowledgementKind ? (
				<StatutoryAcknowledgementHistory
					organizationId={organizationId}
					subject={{
						employeeId: item.employeeId,
						acknowledgementKind: finding.acknowledgementKind,
						findingKind: finding.kind,
						subjectKey: finding.subjectKey,
					}}
					currentInputFingerprint={finding.inputFingerprint}
					currentStatus={status}
				/>
			) : null}
			{finding.kind === "on_call_short_notice" &&
			finding.acknowledgementKind &&
			shiftId &&
			status !== "current" ? (
				<AcknowledgeShortNoticeForm
					organizationId={organizationId}
					shiftId={shiftId}
					fingerprint={finding.inputFingerprint}
				/>
			) : null}
			{finding.kind === "on_call_short_notice" && !finding.acknowledgementKind ? (
				// A draft announces no call yet: there is no agreement to document until it is published.
				<p className="mt-1 text-muted-foreground text-sm">
					{t(
						"common.onCall.reviews.draft",
						"Not published yet. Publish the shift before documenting the employee's agreement.",
					)}
				</p>
			) : null}
		</li>
	);
}

/**
 * § 12 TzBfG on-call findings of the last and next four weeks in Settings → Contracts → Reviews &
 * Conflicts (#1992), with short-notice agreements. Org admins only.
 */
export function OnCallReviewsSection({
	organizationId,
	includeResolved = false,
	showWhenEmpty = false,
}: {
	readonly organizationId: string;
	/** Also list short-notice call-ins whose agreement is documented (current). */
	readonly includeResolved?: boolean;
	/** Show the card with an empty note instead of nothing (the domain filter is selected). */
	readonly showWhenEmpty?: boolean;
}) {
	const { t } = useTranslate();
	const items = useQuery({
		queryKey: onCallReviewsQueryKey(organizationId),
		queryFn: async () => {
			const result = await listOnCallReviewItemsAction({});
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
	});
	const shown = (items.data ?? []).filter(
		(item) => includeResolved || item.finding.acknowledgement?.status !== "current",
	);

	if (items.isPending || (items.isSuccess && shown.length === 0 && !showWhenEmpty)) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconPhoneCall aria-hidden="true" className="size-5" />
					{t("common.onCall.reviews.title", "On-call work (§ 12 TzBfG)")}
				</CardTitle>
				<CardDescription>
					{t(
						"common.onCall.reviews.description",
						"Short-notice call-ins, calls below the minimum and weeks outside the call-off band in the last and next four weeks. Clocking is never blocked.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{items.isError ? (
					<p role="alert" className="text-destructive text-sm">
						{items.error.message}
					</p>
				) : shown.length === 0 ? (
					<div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
						<IconInfoCircle className="size-4" aria-hidden="true" />
						{t("common.onCall.reviews.empty", "No on-call findings to review.")}
					</div>
				) : (
					<ul className="space-y-2">
						{shown.map((item) => (
							<ReviewRow key={item.finding.id} organizationId={organizationId} item={item} />
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
