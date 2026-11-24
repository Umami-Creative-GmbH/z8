"use client";

import { IconInfoCircle, IconLoader2, IconShieldCheck, IconUserShield } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	acknowledgeMinorContractorReviewAction,
	listMinorContractorReviewsAction,
} from "@/app/[locale]/(app)/settings/contracts/minor-contractor-review-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import type { StatutoryAcknowledgementRefusal } from "@/lib/statutory/acknowledgements";
import type {
	MinorContractorReview,
	MinorContractorReviewRefusal,
} from "@/lib/statutory/youth/minor-contractor-review";
import { cn } from "@/lib/utils";
import {
	invalidateStatutoryReviewViews,
	youthReviewQueryKeys,
} from "./statutory-review-query-keys";
import {
	InvalidatedAcknowledgementNotice,
	invalidatedItemClassName,
	StatutoryAcknowledgementHistory,
} from "./statutory-review-shared";

/** Every refusal documenting a minor contractor engagement can return, as admins read it. */
export const minorContractorReviewRefusals = {
	statutory_finding_not_found: [
		"settings.contracts.reviews.minorContractors.refusal.notFound",
		"This engagement no longer needs a review. The list shows the current ones.",
	],
	statutory_finding_changed: [
		"settings.contracts.reviews.minorContractors.refusal.changed",
		"The engagement or the birthday changed since this list was loaded. Review it again.",
	],
	statutory_reason_required: [
		"settings.contracts.reviews.minorContractors.refusal.reasonRequired",
		"Explain why the work does or does not fall under youth protection.",
	],
	statutory_subject_required: [
		"settings.contracts.reviews.minorContractors.refusal.subjectRequired",
		"This engagement cannot be documented. Reload the list and try again.",
	],
} as const satisfies RefusalMessages<
	MinorContractorReviewRefusal | StatutoryAcknowledgementRefusal
>;

/**
 * External Contractor engagements of minors (#2022). The youth protection monitor does not judge
 * contractor days, but § 1 Abs. 1 Nr. 3 JArbSchG covers minors whose services resemble an
 * employee's work: an org admin checks each engagement and documents the assessment with a reason.
 * The documentation re-opens when the engagement period or the birthday changes.
 */
export function MinorContractorReviewsSection({
	organizationId,
	includeResolved = false,
	showWhenEmpty = false,
}: {
	organizationId: string;
	/** Also list engagements a current acknowledgement documents. */
	includeResolved?: boolean;
	/** Show the card with an empty note instead of nothing (the domain filter is selected). */
	showWhenEmpty?: boolean;
}) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: [...youthReviewQueryKeys.minorContractors(organizationId), includeResolved],
		queryFn: async (): Promise<MinorContractorReview[]> => {
			const result = await listMinorContractorReviewsAction({
				includeAcknowledged: includeResolved,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
	});
	const reviews = query.data ?? [];
	if (query.isLoading || (reviews.length === 0 && !query.isError && !showWhenEmpty)) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconUserShield className="size-5" aria-hidden="true" />
					{t(
						"settings.contracts.reviews.minorContractors.title",
						"Youth protection: contractors under 18",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.contracts.reviews.minorContractors.description",
						"The youth protection limits do not judge External Contractors. JArbSchG still covers minors whose services resemble an employee's work (§ 1 Abs. 1 Nr. 3 JArbSchG). Check each engagement and record your assessment. It opens again when the engagement period or the birthday changes.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isError ? (
					<p className="text-destructive text-sm">
						{t(
							"settings.contracts.reviews.minorContractors.loadFailed",
							"Could not load contractors under 18.",
						)}
					</p>
				) : reviews.length === 0 ? (
					<div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
						<IconInfoCircle className="size-4" aria-hidden="true" />
						{t(
							"settings.contracts.reviews.minorContractors.empty",
							"No contractor under 18 needs a review.",
						)}
					</div>
				) : (
					<ul className="divide-y rounded-md border">
						{reviews.map((review) => (
							<MinorContractorReviewItem
								key={review.findingId}
								organizationId={organizationId}
								review={review}
							/>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}

function MinorContractorReviewItem({
	organizationId,
	review,
}: {
	organizationId: string;
	review: MinorContractorReview;
}) {
	const { t } = useTranslate();
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const queryClient = useQueryClient();
	const [open, setOpen] = useState(false);
	const formatDate = (date: string) => formatPlainDate(parsePlainDate(date), locale, "dateMedium");
	const mutation = useMutation({
		mutationFn: async (value: { reason: string; legalNote: string }) => {
			const result = await acknowledgeMinorContractorReviewAction({
				employeeId: review.employeeId,
				subjectKey: review.subjectKey,
				expectedFingerprint: review.inputFingerprint,
				reason: value.reason,
				legalNote: value.legalNote.trim() || null,
			});
			if (!result.success) {
				throw new Error(actionErrorMessage(t, result, minorContractorReviewRefusals));
			}
		},
		onSuccess: () => {
			toast.success(
				t("settings.contracts.reviews.minorContractors.acknowledged", "Assessment recorded"),
			);
			setOpen(false);
		},
		onError: (error) => toast.error(error.message),
		// A refused (changed) engagement is refetched too, so the admin sees what changed.
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({
					queryKey: youthReviewQueryKeys.minorContractors(organizationId),
				}),
				invalidateStatutoryReviewViews(queryClient, organizationId),
			]),
	});
	const form = useForm({
		defaultValues: { reason: "", legalNote: "" },
		onSubmit: async ({ value }) => {
			// A refusal is shown by onError; the form keeps what was entered.
			await mutation.mutateAsync(value).catch(() => undefined);
		},
	});

	const lastDay = review.periodEnd
		? parsePlainDate(review.periodEnd).subtract({ days: 1 }).toString()
		: null;
	const period = review.periodStart
		? lastDay
			? t("settings.contracts.reviews.minorContractors.period", "Engaged {from} – {until}", {
					from: formatDate(review.periodStart),
					until: formatDate(lastDay),
				})
			: t("settings.contracts.reviews.minorContractors.since", "Engaged since {from}", {
					from: formatDate(review.periodStart),
				})
		: lastDay
			? t(
					"settings.contracts.reviews.minorContractors.untilStartUnrecorded",
					"Engaged until {until} (start not recorded)",
					{ until: formatDate(lastDay) },
				)
			: t(
					"settings.contracts.reviews.minorContractors.startUnrecorded",
					"Engagement start not recorded",
				);

	return (
		<li
			className={cn(
				"flex flex-col gap-3 p-3",
				invalidatedItemClassName(review.acknowledgementStatus),
			)}
		>
			<div className="flex flex-wrap items-center gap-2">
				<span className="font-medium">{review.employeeName}</span>
				<Badge variant="outline">
					{t(
						"settings.contracts.reviews.minorContractors.kind",
						"Contractor under 18: check whether the work falls under § 1 Abs. 1 Nr. 3 JArbSchG",
					)}
				</Badge>
				<span className="text-muted-foreground text-sm tabular-nums">{period}</span>
				{review.acknowledgementStatus === "stale" ? (
					<Badge variant="outline" className="border-warning/60 text-warning">
						{t("settings.contracts.reviews.minorContractors.stale", "Changed since last assessed")}
					</Badge>
				) : null}
				{review.acknowledgementStatus === "current" ? (
					<Badge variant="secondary">
						{t("settings.contracts.reviews.minorContractors.documented", "Assessment recorded")}
					</Badge>
				) : null}
				<span className="text-muted-foreground text-xs">{review.legalReference}</span>
			</div>
			{review.contractorAfterEnd ? (
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.contracts.reviews.minorContractors.afterEnd",
						"The engagement has ended, but the person is still on the roster as a contractor. Their shifts and work after it are not judged under youth protection either.",
					)}
				</p>
			) : null}
			{review.contractorBeforeStart ? (
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.contracts.reviews.minorContractors.beforeStart",
						"The engagement has not started yet, but the person is already on the roster as a contractor. Their shifts and work before it are not judged under youth protection either.",
					)}
				</p>
			) : null}
			{review.acknowledgementStatus === "stale" ? <InvalidatedAcknowledgementNotice /> : null}
			<StatutoryAcknowledgementHistory
				organizationId={organizationId}
				subject={{
					employeeId: review.employeeId,
					acknowledgementKind: "jarbschg_minor_contractor_review",
					findingKind: "jarbschg_minor_contractor",
					subjectKey: review.subjectKey,
				}}
				currentInputFingerprint={review.inputFingerprint}
				currentStatus={review.acknowledgementStatus}
			/>
			{review.acknowledgementStatus === "current" ? null : open ? (
				<form
					className="grid gap-3 sm:grid-cols-2"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<p className="text-muted-foreground text-sm sm:col-span-2">
						{t(
							"settings.contracts.reviews.minorContractors.hint",
							"If the work resembles an employee's (bound by instructions, integrated into your organization, no own clients or business risk), youth protection applies: switch on “Apply youth protection (JArbSchG) to minor contractors” in the statutory limits, or employ the minor instead.",
						)}
					</p>
					<form.Field
						name="reason"
						validators={{
							onSubmit: ({ value }) =>
								value.trim()
									? undefined
									: t(
											"settings.contracts.reviews.minorContractors.reasonRequired",
											"Explain why the work does or does not fall under youth protection.",
										),
						}}
					>
						{(field) => (
							<div className="space-y-1.5 sm:col-span-2">
								<Label htmlFor={`minor-contractor-reason-${review.findingId}`}>
									{t(
										"settings.contracts.reviews.minorContractors.reason",
										"Your assessment of the engagement",
									)}
								</Label>
								<Textarea
									id={`minor-contractor-reason-${review.findingId}`}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									maxLength={1000}
									aria-invalid={field.state.meta.errors.length > 0}
								/>
								{field.state.meta.errors.length > 0 ? (
									<p className="text-destructive text-xs">{field.state.meta.errors.join(" ")}</p>
								) : null}
							</div>
						)}
					</form.Field>
					<form.Field name="legalNote">
						{(field) => (
							<div className="space-y-1.5 sm:col-span-2">
								<Label htmlFor={`minor-contractor-legal-${review.findingId}`}>
									{t(
										"settings.contracts.reviews.minorContractors.legalNote",
										"Legal note (optional)",
									)}
								</Label>
								<Input
									id={`minor-contractor-legal-${review.findingId}`}
									value={field.state.value}
									onChange={(event) => field.handleChange(event.target.value)}
									maxLength={500}
								/>
							</div>
						)}
					</form.Field>
					<div className="flex gap-2 sm:col-span-2">
						<Button type="submit" size="sm" disabled={mutation.isPending}>
							{mutation.isPending ? (
								<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconShieldCheck className="mr-1.5 size-4" aria-hidden="true" />
							)}
							{t("settings.contracts.reviews.minorContractors.confirm", "Record assessment")}
						</Button>
						<Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
					</div>
				</form>
			) : (
				<div>
					<Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
						<IconShieldCheck className="mr-1.5 size-4" aria-hidden="true" />
						{t("settings.contracts.reviews.minorContractors.acknowledge", "Record assessment…")}
					</Button>
				</div>
			)}
		</li>
	);
}
