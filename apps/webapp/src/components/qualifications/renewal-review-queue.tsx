"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { toast } from "sonner";

import {
	getPendingQualificationRenewalRequests,
	reviewQualificationRenewalRequest,
} from "@/app/[locale]/(app)/settings/skills/actions";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import type { QualificationRenewalRequestRecord } from "@/lib/effect/services/skill.service";
import { queryKeys } from "@/lib/query/keys";

interface RenewalReviewQueueProps {
	organizationId: string;
}

type Translate = ReturnType<typeof useTranslate>["t"];

function formatDate(date: Date) {
	return DateTime.fromJSDate(date, { zone: "utc" }).toLocaleString(DateTime.DATE_MED);
}

function ReviewRequestDetails({ request, t }: { request: QualificationRenewalRequestRecord; t: Translate }) {
	return (
		<div className="mt-2 space-y-1 break-words text-xs text-muted-foreground">
			<p>
				{t("qualifications.renewalRequestedFor", "Requested for employee qualification")}: {request.employeeSkillId}
			</p>
			{request.requestedExpiresAt ? (
				<p>
					{t("qualifications.requestedExpiry", "Requested expiry")}: {formatDate(request.requestedExpiresAt)}
				</p>
			) : null}
			{request.requestedIssuedAt ? (
				<p>
					{t("qualifications.requestedIssueDate", "Requested issue date")}: {formatDate(request.requestedIssuedAt)}
				</p>
			) : null}
			{request.requestedIssuer ? (
				<p>{t("qualifications.issuerValue", "Issuer: {{issuer}}", { issuer: request.requestedIssuer })}</p>
			) : null}
			{request.requestedCertificateNumber ? (
				<p>
					{t("qualifications.certificateNumberValue", "Certificate: {{certificateNumber}}", {
						certificateNumber: request.requestedCertificateNumber,
					})}
				</p>
			) : null}
			{request.notes ? (
				<p>{t("qualifications.notesValue", "Notes: {{notes}}", { notes: request.notes })}</p>
			) : null}
		</div>
	);
}

export function RenewalReviewQueue({ organizationId }: RenewalReviewQueueProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const { data, isLoading } = useQuery({
		queryKey: queryKeys.qualifications.renewalRequests(organizationId),
		queryFn: async () => {
			const result = await getPendingQualificationRenewalRequests();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});

	const reviewMutation = useMutation({
		mutationFn: async ({ requestId, approved }: { requestId: string; approved: boolean }) => {
			const result = await reviewQualificationRenewalRequest({
				requestId,
				approved,
				reviewNotes: approved ? "Approved" : "Rejected",
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("qualifications.renewalRequestReviewed", "Renewal request reviewed"));
			queryClient.invalidateQueries({
				queryKey: queryKeys.qualifications.renewalRequests(organizationId),
			});
		},
		onError: (error) => toast.error(error.message),
	});

	const requests = data ?? [];

	const handleReview = (requestId: string, approved: boolean) => {
		if (
			!approved &&
			!window.confirm(
				t(
					"qualifications.confirmRejectRenewalRequest",
					"Reject this renewal request? The employee will need to submit updated evidence.",
				),
			)
		) {
			return;
		}

		reviewMutation.mutate({ requestId, approved });
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("qualifications.renewalRequestsTitle", "Renewal Requests")}</CardTitle>
				<CardDescription>
					{t(
						"qualifications.renewalRequestsDescription",
						"Review employee-submitted qualification evidence.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<p className="text-sm text-muted-foreground" aria-live="polite">
						{t("qualifications.loadingRenewalRequests", "Loading renewal requests…")}
					</p>
				) : null}
				{!isLoading && requests.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("qualifications.noPendingRenewalRequests", "No pending renewal requests.")}
					</p>
				) : null}
				{requests.length > 0 ? (
					<div
						className="space-y-3"
						role="list"
						aria-label={t("qualifications.renewalRequestsList", "Pending renewal requests")}
					>
						{requests.map((request) => {
							const isReviewingRequest =
								reviewMutation.isPending && reviewMutation.variables?.requestId === request.id;
							const isRejectingRequest =
								isReviewingRequest && reviewMutation.variables?.approved === false;
							const isApprovingRequest =
								isReviewingRequest && reviewMutation.variables?.approved === true;

							return (
								<div
									key={request.id}
									className="rounded-lg border bg-card/60 p-3"
									role="listitem"
								>
									<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
										<div className="min-w-0">
											<p className="font-medium">
												{t("qualifications.renewalRequest", "Qualification renewal request")}
											</p>
											<p className="text-xs text-muted-foreground">
												{t("qualifications.submittedOn", "Submitted {{date}}", {
													date: formatDate(request.createdAt),
												})}
											</p>
											<ReviewRequestDetails request={request} t={t} />
										</div>
										<div className="flex shrink-0 gap-2">
											<Button
												type="button"
												size="sm"
												variant="outline"
												disabled={reviewMutation.isPending}
												aria-label={t(
													"qualifications.rejectRenewalRequest",
													"Reject renewal request",
												)}
												onClick={() => handleReview(request.id, false)}
											>
												{isRejectingRequest ? (
													<IconLoader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
												) : null}
												{t("qualifications.reject", "Reject")}
											</Button>
											<Button
												type="button"
												size="sm"
												disabled={reviewMutation.isPending}
												aria-label={t(
													"qualifications.approveRenewalRequest",
													"Approve renewal request",
												)}
												onClick={() => handleReview(request.id, true)}
											>
												{isApprovingRequest ? (
													<IconLoader2 className="mr-1 size-3 animate-spin" aria-hidden="true" />
												) : null}
												{t("qualifications.approve", "Approve")}
											</Button>
										</div>
									</div>
								</div>
							);
						})}
					</div>
				) : null}
			</CardContent>
		</Card>
	);
}
