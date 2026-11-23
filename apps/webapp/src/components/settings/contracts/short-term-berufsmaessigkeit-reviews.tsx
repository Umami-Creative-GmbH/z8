"use client";

import {
	IconCheck,
	IconExternalLink,
	IconInfoCircle,
	IconLoader2,
	IconUserSearch,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	acknowledgeShortTermBerufsmaessigkeitAction,
	listShortTermBerufsmaessigkeitReviewsAction,
} from "@/app/[locale]/(app)/settings/contracts/short-term-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import type { ShortTermBerufsmaessigkeitReview } from "@/lib/statutory/short-term/monitor";
import { Link } from "@/navigation";
import {
	formatCents,
	formatMonth,
	SHORT_TERM_REFUSALS,
	type Translate,
	useFormattingLocale,
	VerificationStatusBadge,
} from "./short-term-shared";

export const SHORT_TERM_REVIEWS_QUERY_KEY = ["contracts", "short-term-berufsmaessigkeit"] as const;

function AcknowledgeForm({
	review,
	t,
}: {
	review: ShortTermBerufsmaessigkeitReview;
	t: Translate;
}) {
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async (value: { reason: string; legalNote: string }) => {
			const result = await acknowledgeShortTermBerufsmaessigkeitAction({
				employeeId: review.employeeId,
				month: review.month,
				reason: value.reason,
				legalNote: value.legalNote.trim() || null,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result, SHORT_TERM_REFUSALS));
		},
		onSuccess: () => {
			toast.success(
				t("settings.contracts.shortTerm.verification.recorded", "Verification recorded"),
			);
			void queryClient.invalidateQueries({ queryKey: SHORT_TERM_REVIEWS_QUERY_KEY });
			void queryClient.invalidateQueries({
				queryKey: ["contracts", "short-term", review.employeeId],
			});
		},
		onError: (error) => toast.error(error.message),
	});
	const form = useForm({
		defaultValues: { reason: "", legalNote: "" },
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync(value);
		},
	});

	return (
		<form
			noValidate
			aria-busy={mutation.isPending}
			className="space-y-3"
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
									"settings.contracts.shortTerm.refusal.reasonRequired",
									"Explain how Berufsmäßigkeit was verified.",
								),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.contracts.shortTerm.verification.reason", "How was it verified?")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								rows={2}
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								placeholder={t(
									"settings.contracts.shortTerm.verification.reasonPlaceholder",
									"e.g. Student questionnaire on file; no other employment this year",
								)}
							/>
						</TFormControl>
						<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="legalNote">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("settings.contracts.shortTerm.verification.legalNote", "Legal note (optional)")}
						</TFormLabel>
						<TFormControl>
							<Input
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<Button type="submit" size="sm" disabled={mutation.isPending}>
				{mutation.isPending ? (
					<IconLoader2
						className="mr-1 size-3.5 animate-spin motion-reduce:animate-none"
						aria-hidden="true"
					/>
				) : (
					<IconCheck className="mr-1 size-3.5" aria-hidden="true" />
				)}
				{t("settings.contracts.shortTerm.verification.submit", "Record verification")}
			</Button>
		</form>
	);
}

function ReviewItem({ review, t }: { review: ShortTermBerufsmaessigkeitReview; t: Translate }) {
	const locale = useFormattingLocale();
	const detail = review.finding.adminDetail;
	const currency = detail?.currency ?? "EUR";
	return (
		<li className="space-y-3 rounded-lg border p-4 text-sm">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div className="flex flex-wrap items-center gap-2">
					<Link
						href={`/settings/employees/${review.employeeId}#contract`}
						className="font-medium underline underline-offset-4"
					>
						{review.employeeName}
					</Link>
					<span className="tabular-nums">{formatMonth(review.month, locale)}</span>
					<VerificationStatusBadge acknowledgement={review.finding.acknowledgement} t={t} />
				</div>
				<Button asChild variant="ghost" size="sm">
					<Link href={`/settings/employees/${review.employeeId}#contract`}>
						<IconExternalLink className="mr-1 size-3.5" aria-hidden="true" />
						{t("settings.contracts.reviews.openEmployee", "Open profile")}
					</Link>
				</Button>
			</div>
			<p className="text-muted-foreground tabular-nums">
				{t(
					"settings.contracts.shortTerm.reviews.earnings",
					"Earnings {total} (worked {earned}, planned {planned}) against the Minijob limit of {cap}",
					{
						total: formatCents(detail?.amountsCents?.total, currency, locale),
						earned: formatCents(detail?.amountsCents?.earned, currency, locale),
						planned: formatCents(detail?.amountsCents?.planned, currency, locale),
						cap: formatCents(detail?.amountsCents?.cap, currency, locale),
					},
				)}
			</p>
			{review.finding.acknowledgement?.reason && (
				<p className="text-muted-foreground text-xs">
					{t("settings.contracts.shortTerm.reviews.lastReason", "Last verification: {reason}", {
						reason: review.finding.acknowledgement.reason,
					})}
				</p>
			)}
			{review.finding.acknowledgement?.status !== "current" && (
				<AcknowledgeForm review={review} t={t} />
			)}
		</li>
	);
}

/**
 * #1990: Berufsmäßigkeit verification prompts in Settings → Contracts → Reviews & Conflicts. A
 * short-term employee whose monthly earnings exceed the Minijob limit needs an org admin's
 * documented verification; Z8 never decides social-security status itself.
 */
export function ShortTermBerufsmaessigkeitReviews({
	includeResolved,
}: {
	includeResolved: boolean;
}) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: [...SHORT_TERM_REVIEWS_QUERY_KEY, includeResolved],
		queryFn: async () => {
			const result = await listShortTermBerufsmaessigkeitReviewsAction({ includeResolved });
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
	});
	const reviews = query.data ?? [];

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconUserSearch className="size-5 text-primary" aria-hidden="true" />
					{t(
						"settings.contracts.shortTerm.reviews.title",
						"Short-term employment: Berufsmäßigkeit checks",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.contracts.shortTerm.reviews.description",
						"A short-term employee earned more than the Minijob limit in these months. Verify that the employment is not berufsmäßig and record how. The verification has to be renewed when the month's work or shifts change.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isLoading ? (
					<p className="text-muted-foreground text-sm" role="status">
						{t("common.loading", "Loading…")}
					</p>
				) : query.isError ? (
					<p className="text-destructive text-sm" role="alert">
						{query.error.message}
					</p>
				) : reviews.length === 0 ? (
					<div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
						<IconInfoCircle className="size-4" aria-hidden="true" />
						{t(
							"settings.contracts.shortTerm.reviews.empty",
							"No short-term earnings above the Minijob limit to verify.",
						)}
					</div>
				) : (
					<ul className="space-y-3">
						{reviews.map((review) => (
							<ReviewItem key={review.finding.id} review={review} t={t} />
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
