"use client";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { Temporal } from "temporal-polyfill";
import type { prepareTimeCorrectionRevision } from "@/app/[locale]/(app)/time-tracking/actions/corrections";
import { requestTimeCorrection } from "@/app/[locale]/(app)/time-tracking/actions/corrections";
import { parseInstant, systemClock } from "@/lib/datetime/temporal-core";
import { getInstantLocalMinuteFields } from "@/lib/datetime/temporal-format";
import {
	dispatchApprovalDecision,
	useInvalidateApprovalInbox,
} from "@/lib/query/use-approval-inbox";
import {
	type CorrectionOverlap,
	fitCorrectionRange,
} from "@/lib/time-tracking/correction-overlaps";
import { validateTimeCorrectionRange } from "@/lib/time-tracking/time-correction-temporal";
export type Draft = Extract<
	Awaited<ReturnType<typeof prepareTimeCorrectionRevision>>,
	{ success: true }
>["data"];

export function useTimeCorrectionRevision({
	approvalId,
	draft,
	overlaps,
	onActiveChange,
	onComplete,
	onRejected,
}: {
	approvalId: string;
	draft: Draft;
	overlaps: CorrectionOverlap[];
	onActiveChange: (active: boolean) => void;
	onComplete: (status: "approved" | "pending" | "rejected") => void;
	onRejected: () => void;
}) {
	const { t } = useTranslate();
	const invalidateInbox = useInvalidateApprovalInbox();
	const [rejected, setRejected] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const identity = useRef<{ command: string; id: string } | null>(null);
	const suggestion = fitCorrectionRange(draft.requestedRange, overlaps);
	const form = useForm({
		defaultValues: {
			startDate: draft.request.newClockInDate,
			startTime: draft.request.newClockInTime,
			endDate: draft.request.newClockOutDate ?? "",
			endTime: draft.request.newClockOutTime ?? "",
			reason: "",
		},
		onSubmit: async ({ value }) => {
			setError(null);
			try {
				const start = Temporal.PlainDateTime.from(
					`${value.startDate}T${value.startTime}`,
				)
					.toZonedDateTime(draft.timezone, { disambiguation: "reject" })
					.toInstant();
				const end = Temporal.PlainDateTime.from(
					`${value.endDate}T${value.endTime}`,
				)
					.toZonedDateTime(draft.timezone, { disambiguation: "reject" })
					.toInstant();
				if (
					start.epochNanoseconds >= end.epochNanoseconds ||
					!value.reason.trim()
				) {
					setError(
						t(
							"approvals:approvals.reviseInvalid",
							"Enter a valid time range and a reason for the revision.",
						),
					);
					return;
				}
				if (
					!draft.metadataChanged &&
					value.startDate === draft.originalStart.date &&
					value.startTime === draft.originalStart.time &&
					value.endDate === draft.originalEnd.date &&
					value.endTime === draft.originalEnd.time
				) {
					setError(
						t(
							"approvals:approvals.reviseUnchanged",
							"These times match the original record. Reject the correction if no change is needed.",
						),
					);
					return;
				}
				validateTimeCorrectionRange(start, end);
				if (end.epochNanoseconds > systemClock.nowInstant().epochNanoseconds) {
					setError(
						t(
							"approvals:approvals.reviseFuture",
							"Correction times must be in the past.",
						),
					);
					return;
				}
				const fitted = fitCorrectionRange(
					{ startAt: start.toString(), endAt: end.toString() },
					overlaps,
				);
				if (
					!fitted ||
					parseInstant(fitted.startAt).epochNanoseconds !==
						start.epochNanoseconds ||
					parseInstant(fitted.endAt).epochNanoseconds !== end.epochNanoseconds
				) {
					setError(
						t(
							"approvals:approvals.reviseStillOverlaps",
							"These times still overlap recorded work. Adjust them or use Auto-fit.",
						),
					);
					return;
				}
				const reason = t(
					"approvals:approvals.revisionReason",
					"Revised correction ({approvalId}): {reason}",
					{ approvalId, reason: value.reason.trim() },
				);
				if (!rejected) {
					const result = await dispatchApprovalDecision({
						approvalId,
						action: "reject",
						reason,
					});
					if (!result.success) {
						setError(
							result.error ??
								t("approvals:approvals.rejectFailed", "Failed to reject"),
						);
						return;
					}
					setRejected(true);
					void invalidateInbox();
					onRejected();
				}
				const request = {
					...draft.request,
					newClockInDate: value.startDate,
					newClockInTime: value.startTime,
					newClockOutDate: value.endDate,
					newClockOutTime: value.endTime,
					reason,
				};
				const command = JSON.stringify(request);
				if (identity.current?.command !== command)
					identity.current = { command, id: crypto.randomUUID() };
				const result = await requestTimeCorrection({
					...request,
					submissionId: identity.current.id,
				});
				if (result.success) {
					onActiveChange(false);
					void invalidateInbox();
					onComplete(result.data.status);
				} else setError(result.error);
			} catch {
				setError(
					t(
						"approvals:approvals.reviseFailed",
						"Could not submit the revision. Check the times and try again.",
					),
				);
			}
		},
	});
	const fit = () => {
		if (!suggestion) return;
		const start = getInstantLocalMinuteFields(
			parseInstant(suggestion.startAt).round({
				smallestUnit: "minute",
				roundingMode: "ceil",
			}),
			draft.timezone,
		);
		const end = getInstantLocalMinuteFields(
			parseInstant(suggestion.endAt).round({
				smallestUnit: "minute",
				roundingMode: "floor",
			}),
			draft.timezone,
		);
		form.setFieldValue("startDate", start.date);
		form.setFieldValue("startTime", start.time);
		form.setFieldValue("endDate", end.date);
		form.setFieldValue("endTime", end.time);
	};
	return { form, fit, suggestion, rejected, error };
}
