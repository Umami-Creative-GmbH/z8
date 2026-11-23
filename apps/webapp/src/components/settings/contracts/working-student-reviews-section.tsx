"use client";

import { IconCheck, IconExternalLink, IconLoader2, IconSchool } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	acknowledgeWorkingStudentFindingAction,
	listWorkingStudentReviewsAction,
} from "@/app/[locale]/(app)/settings/contracts/working-student-actions";
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
import type {
	WorkingStudentAcknowledgementRefusal,
	WorkingStudentReviewItem,
} from "@/lib/statutory/working-student/views";
import { Link } from "@/navigation";
import { AcknowledgementBadge, workingStudentFindingText } from "./working-student-monitor-card";
import {
	invalidateWorkingStudentFindings,
	workingStudentQueryKeys,
} from "./working-student-queries";

const ACKNOWLEDGE_REFUSALS = {
	statutory_reason_required: [
		"settings.contracts.workingStudent.reviews.reasonRequired",
		"Explain why this week is acknowledged.",
	],
	statutory_subject_required: [
		"settings.contracts.workingStudent.reviews.notFound",
		"This week no longer has the finding. Reload the reviews.",
	],
	working_student_invalid_week: [
		"settings.contracts.workingStudent.reviews.notFound",
		"This week no longer has the finding. Reload the reviews.",
	],
	working_student_finding_not_found: [
		"settings.contracts.workingStudent.reviews.notFound",
		"This week no longer has the finding. Reload the reviews.",
	],
} satisfies RefusalMessages<StatutoryAcknowledgementRefusal | WorkingStudentAcknowledgementRefusal>;

function AcknowledgeForm({
	organizationId,
	item,
}: {
	organizationId: string;
	item: WorkingStudentReviewItem;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const mutation = useMutation({
		mutationFn: async (value: { reason: string; legalNote: string }) => {
			const result = await acknowledgeWorkingStudentFindingAction({
				employeeId: item.finding.employeeId,
				findingKind: item.finding.kind,
				weekStart: item.finding.periodStart,
				reason: value.reason,
				legalNote: value.legalNote.trim() || null,
			});
			if (!result.success) throw new Error(actionErrorMessage(t, result, ACKNOWLEDGE_REFUSALS));
		},
		onSuccess: () => {
			toast.success(
				t("settings.contracts.workingStudent.reviews.acknowledged", "Week acknowledged"),
			);
			void invalidateWorkingStudentFindings(queryClient, organizationId, item.finding.employeeId);
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
			className="space-y-2"
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
									"settings.contracts.workingStudent.reviews.reasonRequired",
									"Explain why this week is acknowledged.",
								),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.contracts.workingStudent.reviews.reason", "Reason")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								name={field.name}
								rows={2}
								value={field.state.value}
								placeholder={t(
									"settings.contracts.workingStudent.reviews.reasonPlaceholder",
									"e.g. exam-free project week confirmed by the university",
								)}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</TFormControl>
						<TFormMessage>{field.state.meta.errors[0]}</TFormMessage>
					</TFormItem>
				)}
			</form.Field>
			<div className="flex flex-wrap items-end gap-2">
				<form.Field name="legalNote">
					{(field) => (
						<TFormItem className="min-w-56 flex-1">
							<TFormLabel>
								{t("settings.contracts.workingStudent.reviews.legalNote", "Legal note (optional)")}
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
							className="size-4 animate-spin motion-reduce:animate-none"
							aria-hidden="true"
						/>
					) : (
						<IconCheck className="size-4" aria-hidden="true" />
					)}
					{t("settings.contracts.workingStudent.reviews.acknowledge", "Acknowledge")}
				</Button>
			</div>
		</form>
	);
}

/**
 * Working-student findings in Settings → Contracts → Reviews & Conflicts (#1991). Org admins
 * acknowledge a week with a reason; the acknowledgement goes stale when the week's work changes.
 */
export function WorkingStudentReviewsSection({
	organizationId,
	includeResolved,
}: {
	organizationId: string;
	includeResolved: boolean;
}) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() ?? "en";
	const query = useQuery({
		queryKey: workingStudentQueryKeys.reviews(organizationId),
		queryFn: async () => {
			const result = await listWorkingStudentReviewsAction();
			if (!result.success) throw new Error(actionErrorMessage(t, result));
			return result.data;
		},
		staleTime: 15 * 1000,
	});

	const items = (query.data ?? []).filter(
		(item) => includeResolved || item.finding.acknowledgement?.status !== "current",
	);
	if (query.isLoading || (query.isSuccess && items.length === 0)) return null;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconSchool className="size-5 text-primary" aria-hidden="true" />
					{t("settings.contracts.workingStudent.reviews.title", "Working students above 20 hours")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.contracts.workingStudent.reviews.description",
						"Lecture weeks above 20 hours of weekday daytime work and weeks that use up the 26-week allowance. Acknowledge a week once you have reviewed it.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isError ? (
					<p className="text-destructive text-sm" role="alert">
						{t(
							"settings.contracts.workingStudent.loadFailed",
							"Could not load the working-student monitor.",
						)}
					</p>
				) : (
					<ul className="space-y-3">
						{items.map((item) => (
							<li key={item.finding.id} className="space-y-3 rounded-md border p-3">
								<div className="flex flex-wrap items-center gap-2 text-sm">
									<Badge variant={item.finding.severity === "critical" ? "destructive" : "outline"}>
										{item.finding.severity === "critical"
											? t("settings.contracts.workingStudent.severity.critical", "Critical")
											: t("settings.contracts.workingStudent.severity.warning", "Warning")}
									</Badge>
									<Link
										href={`/settings/employees/${item.finding.employeeId}`}
										className="inline-flex items-center gap-1 font-medium hover:underline"
									>
										{item.employeeName}
										<IconExternalLink className="size-3.5" aria-hidden="true" />
									</Link>
									<span className="tabular-nums">{item.finding.subjectKey}</span>
									<span>{workingStudentFindingText(item.finding, t, locale)}</span>
									<AcknowledgementBadge status={item.finding.acknowledgement?.status} />
								</div>
								{item.finding.acknowledgement?.status === "current" ? (
									<p className="text-muted-foreground text-xs">
										{item.finding.acknowledgement.reason}
									</p>
								) : (
									<AcknowledgeForm organizationId={organizationId} item={item} />
								)}
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
