"use client";

import { IconAlertTriangle, IconCheck, IconExternalLink, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	acknowledgeMinijobExceedanceAction,
	listMinijobExceedanceReviewsAction,
} from "@/app/[locale]/(app)/settings/contracts/minijob-review-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import {
	actionErrorMessage,
	type RefusalMessages,
} from "@/lib/organization-action/action-error-message";
import type { StatutoryAcknowledgementRefusal } from "@/lib/statutory/acknowledgements";
import type { MinijobExceedanceRefusal } from "@/lib/statutory/minijob/acknowledge-minijob-exceedance";
import type { MinijobExceedanceReview } from "@/lib/statutory/minijob/minijob-reviews";
import { Link } from "@/navigation";
import { formatEuroCents, formatMinijobMonth, minijobExceedanceLabel } from "./minijob-labels";
import { MINIJOB_REVIEWS_QUERY_KEY, minijobMonitorQueryPrefix } from "./minijob-query-keys";

// Minijob exceedance months in Settings → Contracts → Reviews & Conflicts (#1989, org admins).

const ACKNOWLEDGE_REFUSALS = {
	minijob_invalid_month: [
		"settings.contracts.minijob.refusal.invalidMonth",
		"Choose a calendar month.",
	],
	minijob_not_exceeded: [
		"settings.contracts.minijob.refusal.notExceeded",
		"The month's earnings are within the limit again; nothing to document.",
	],
	minijob_exceedance_not_acknowledgeable: [
		"settings.contracts.minijob.refusal.notAcknowledgeable",
		"This month cannot count as an unforeseeable exceedance: it is above twice the limit or the third exceedance within 12 months.",
	],
	minijob_exceedance_changed: [
		"settings.contracts.minijob.refusal.changed",
		"The month's earnings changed since you opened this list. Review the updated figures and document them again.",
	],
	statutory_reason_required: [
		"settings.contracts.minijob.refusal.reasonRequired",
		"Explain why the exceedance was unforeseeable.",
	],
	statutory_subject_required: [
		"settings.contracts.minijob.refusal.subjectRequired",
		"The month could not be evaluated. Reload and try again.",
	],
} satisfies RefusalMessages<MinijobExceedanceRefusal | StatutoryAcknowledgementRefusal>;

function AcknowledgeForm({ review }: { review: MinijobExceedanceReview }) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async (value: { reason: string; legalNote: string }) => {
			const result = await acknowledgeMinijobExceedanceAction({
				employeeId: review.employeeId,
				month: review.month,
				reason: value.reason,
				legalNote: value.legalNote.trim() || null,
				expectedFingerprint: review.inputFingerprint,
				expectedTotalCents: review.totalCents,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result, ACKNOWLEDGE_REFUSALS));
			return result.data;
		},
		onSuccess: () => {
			toast.success(
				t(
					"settings.contracts.minijob.review.acknowledged",
					"Exceedance documented as unforeseeable",
				),
			);
			void queryClient.invalidateQueries({ queryKey: MINIJOB_REVIEWS_QUERY_KEY });
			void queryClient.invalidateQueries({
				queryKey: minijobMonitorQueryPrefix(review.employeeId),
			});
		},
		onError: (error) => {
			toast.error(error.message);
			// The figures may have changed: show the current ones.
			void queryClient.invalidateQueries({ queryKey: MINIJOB_REVIEWS_QUERY_KEY });
		},
	});
	const form = useForm({
		defaultValues: { reason: "", legalNote: "" },
		onSubmit: async ({ value }) => {
			await mutation.mutateAsync(value);
		},
	});
	const reasonRequired = (value: string) =>
		value.trim()
			? undefined
			: t(
					"settings.contracts.minijob.refusal.reasonRequired",
					"Explain why the exceedance was unforeseeable.",
				);

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
					onChange: ({ value }) => reasonRequired(value),
					onSubmit: ({ value }) => reasonRequired(value),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.contracts.minijob.review.reason", "Why was it unforeseeable?")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name={field.name}
								rows={2}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
								placeholder={t(
									"settings.contracts.minijob.review.reasonPlaceholder",
									"For example: covered a colleague's unplanned sick leave",
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
							{t("settings.contracts.minijob.review.legalNote", "Legal note (optional)")}
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
			<div className="flex justify-end">
				<Button type="submit" size="sm" disabled={mutation.isPending}>
					{mutation.isPending ? (
						<IconLoader2
							className="size-4 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
					) : (
						<IconCheck className="size-4" aria-hidden="true" />
					)}
					{t("settings.contracts.minijob.review.acknowledge", "Document as unforeseeable")}
				</Button>
			</div>
		</form>
	);
}

export interface MinijobExceedanceReviewsProps {
	readonly organizationId: string;
	/** Also list months already documented by a current acknowledgement. */
	readonly includeAcknowledged: boolean;
}

/** Renders nothing while there is nothing to review. */
export function MinijobExceedanceReviews({
	organizationId,
	includeAcknowledged,
}: MinijobExceedanceReviewsProps) {
	const { t } = useTranslate();
	const query = useQuery({
		queryKey: [...MINIJOB_REVIEWS_QUERY_KEY, organizationId, includeAcknowledged],
		queryFn: async () => {
			const result = await listMinijobExceedanceReviewsAction({ includeAcknowledged });
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
		staleTime: 60 * 1000,
		// Employee changes made elsewhere (terms, leaving dates, offboarding, rehires) move the
		// exceedances: refetch whenever the list mounts instead of showing a cached list.
		refetchOnMount: "always",
	});
	const reviews = query.data ?? [];
	if (query.isLoading || (reviews.length === 0 && !query.isError)) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconAlertTriangle className="size-5 text-amber-600" aria-hidden="true" />
					{t("settings.contracts.minijob.review.title", "Minijob earnings above the monthly limit")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.contracts.minijob.review.description",
						"Up to two months within 12 months may exceed the limit by up to twice the amount when the exceedance was unforeseeable (§ 8 Abs. 1b SGB IV). Document each such month; everything else needs a contract or schedule change.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isError ? (
					<p className="text-destructive text-sm">
						{t(
							"settings.contracts.minijob.review.loadFailed",
							"Could not load the Minijob exceedances.",
						)}
					</p>
				) : (
					<ReviewList reviews={reviews} />
				)}
			</CardContent>
		</Card>
	);
}

function ReviewList({ reviews }: { reviews: readonly MinijobExceedanceReview[] }) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	return (
		<ul className="space-y-3">
			{reviews.map((review) => (
				<li key={review.id} className="space-y-3 rounded-lg border p-4">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div className="space-y-1">
							<Link
								href={`/settings/employees/${review.employeeId}`}
								className="inline-flex items-center gap-1 font-medium hover:underline"
							>
								{review.employeeName}
								<IconExternalLink className="size-3.5" aria-hidden="true" />
							</Link>
							<p className="text-muted-foreground text-sm">
								{formatMinijobMonth(review.month, locale)}
							</p>
						</div>
						<Badge variant={review.severity === "critical" ? "destructive" : "secondary"}>
							{minijobExceedanceLabel(review.status, t)}
						</Badge>
					</div>
					<dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
						<div className="flex justify-between gap-2">
							<dt className="text-muted-foreground">
								{t("settings.contracts.minijob.review.total", "Earnings incl. planned shifts")}
							</dt>
							<dd className="tabular-nums">{formatEuroCents(review.totalCents, locale)}</dd>
						</div>
						<div className="flex justify-between gap-2">
							<dt className="text-muted-foreground">
								{t("settings.contracts.minijob.review.cap", "Monthly limit")}
							</dt>
							<dd className="tabular-nums">{formatEuroCents(review.capCents, locale)}</dd>
						</div>
						{review.externalCents > 0 && (
							<div className="flex justify-between gap-2">
								<dt className="text-muted-foreground">
									{t("settings.contracts.minijob.review.external", "Other Minijobs")}
								</dt>
								<dd className="tabular-nums">{formatEuroCents(review.externalCents, locale)}</dd>
							</div>
						)}
						{review.doubleCapCents !== null && (
							<div className="flex justify-between gap-2">
								<dt className="text-muted-foreground">
									{t("settings.contracts.minijob.review.doubleCap", "Twice the limit")}
								</dt>
								<dd className="tabular-nums">{formatEuroCents(review.doubleCapCents, locale)}</dd>
							</div>
						)}
					</dl>
					{review.priorExceedanceMonths.length > 0 && (
						<p className="text-muted-foreground text-xs">
							{t(
								"settings.contracts.minijob.review.prior",
								"Earlier exceedance months within 12 months: {months}",
								{
									months: review.priorExceedanceMonths
										.map((month) => formatMinijobMonth(month, locale))
										.join(", "),
								},
							)}
						</p>
					)}
					{review.acknowledgement.status !== "none" && review.acknowledgement.reason && (
						<p className="text-xs">
							{t(
								"settings.contracts.minijob.review.documentedReason",
								"Documented reason: {reason}",
								{
									reason: review.acknowledgement.reason,
								},
							)}
						</p>
					)}
					{review.acknowledgeable && review.status !== "acknowledged" && (
						<AcknowledgeForm review={review} />
					)}
				</li>
			))}
		</ul>
	);
}
