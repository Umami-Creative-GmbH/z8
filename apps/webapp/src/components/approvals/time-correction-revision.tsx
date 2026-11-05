"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { prepareTimeCorrectionRevision } from "@/app/[locale]/(app)/time-tracking/actions/corrections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { CorrectionOverlap } from "@/lib/time-tracking/correction-overlaps";
import {
	type Draft,
	useTimeCorrectionRevision,
} from "./use-time-correction-revision";

function RevisionForm({
	approvalId,
	draft,
	overlaps,
	onActiveChange,
	onComplete,
	onCancel,
	onRejected,
}: {
	approvalId: string;
	draft: Draft;
	overlaps: CorrectionOverlap[];
	onActiveChange: (active: boolean) => void;
	onComplete: (status: "approved" | "pending" | "rejected") => void;
	onRejected: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const { form, fit, suggestion, rejected, error } = useTimeCorrectionRevision({
		approvalId,
		draft,
		overlaps,
		onActiveChange,
		onComplete,
		onRejected,
	});
	return (
		<form
			className="space-y-3"
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<p className="text-sm">
				{t(
					"approvals:approvals.reviseExplanation",
					"The original request will be rejected with your reason. The revised correction follows the employee’s approval chain. Existing recorded work stays unchanged.",
				)}
			</p>
			<p className="text-muted-foreground text-sm">
				{t("approvals:approvals.reviseTimezone", "Times in {timezone}", {
					timezone: draft.timezone,
				})}
			</p>
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(pending) => (
					<fieldset disabled={pending} className="space-y-3">
						<div className="grid grid-cols-2 gap-3">
							{(
								[
									["startDate", "date"],
									["startTime", "time"],
									["endDate", "date"],
									["endTime", "time"],
								] as const
							).map(([name, type]) => (
								<form.Field key={name} name={name}>
									{(field) => (
										<div className="min-w-0 space-y-1">
											<Label htmlFor={approvalId + name}>
												{name === "startDate"
													? t(
															"approvals:approvals.reviseStartDate",
															"Start date",
														)
													: name === "startTime"
														? t(
																"approvals:approvals.reviseStartTime",
																"Start time",
															)
														: name === "endDate"
															? t(
																	"approvals:approvals.reviseEndDate",
																	"End date",
																)
															: t(
																	"approvals:approvals.reviseEndTime",
																	"End time",
																)}
											</Label>
											<Input
												id={approvalId + name}
												name={name}
												autoComplete="off"
												type={type}
												value={field.state.value}
												onBlur={field.handleBlur}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												required
											/>
										</div>
									)}
								</form.Field>
							))}
						</div>
						<Button
							type="button"
							variant="outline"
							onClick={fit}
							disabled={!suggestion}
						>
							{t(
								"approvals:approvals.reviseAutoFit",
								"Auto-fit requested times",
							)}
						</Button>
						<p className="text-muted-foreground text-sm">
							{suggestion
								? t(
										"approvals:approvals.reviseFitHelp",
										"Auto-fit keeps the longest available stretch within the requested range. Review the times before submitting.",
									)
								: t(
										"approvals:approvals.reviseNoRoom",
										"No free time remains within the requested range. Enter another range or reject the request.",
									)}
						</p>
						<form.Field name="reason">
							{(field) => (
								<div className="space-y-1">
									<Label htmlFor={`${approvalId}revisionReason`}>
										{t(
											"approvals:approvals.reviseReason",
											"Reason for revision",
										)}
									</Label>
									<Textarea
										id={`${approvalId}revisionReason`}
										name="revisionReason"
										autoComplete="off"
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
										required
										maxLength={2000}
									/>
								</div>
							)}
						</form.Field>
						{rejected && (
							<p role="status" className="text-sm">
								{t(
									"approvals:approvals.reviseRejected",
									"The original request has been rejected. Submit the revised correction below; you can retry if submission fails.",
								)}
							</p>
						)}
						{error && (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						)}
						<div className="flex flex-wrap gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									if (rejected) onComplete("rejected");
									else onCancel();
								}}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit">
								{pending && (
									<IconLoader2
										className="size-4 animate-spin"
										aria-hidden="true"
									/>
								)}
								{rejected
									? t(
											"approvals:approvals.reviseSubmit",
											"Submit revised correction",
										)
									: t(
											"approvals:approvals.reviseReplace",
											"Reject and submit revision",
										)}
							</Button>
						</div>
					</fieldset>
				)}
			</form.Subscribe>
		</form>
	);
}

export function TimeCorrectionRevision({
	approvalId,
	overlaps,
	onActiveChange,
	onComplete,
	onRejected,
}: {
	approvalId: string;
	overlaps: CorrectionOverlap[];
	onActiveChange: (active: boolean) => void;
	onComplete: (status: "approved" | "pending" | "rejected") => void;
	onRejected: () => void;
}) {
	const { t } = useTranslate();
	const [draft, setDraft] = useState<Draft | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const prepare = async () => {
		setLoading(true);
		setError(null);
		try {
			const result = await prepareTimeCorrectionRevision(approvalId);
			if (result.success) {
				setDraft(result.data);
				onActiveChange(true);
			} else setError(result.error);
		} catch {
			setError(
				t(
					"approvals:approvals.reviseLoadFailed",
					"Could not prepare revised correction. Try again.",
				),
			);
		}
		setLoading(false);
	};
	return draft ? (
		<RevisionForm
			key={approvalId}
			approvalId={approvalId}
			draft={draft}
			overlaps={overlaps}
			onActiveChange={onActiveChange}
			onComplete={onComplete}
			onRejected={onRejected}
			onCancel={() => {
				setDraft(null);
				onActiveChange(false);
			}}
		/>
	) : (
		<div className="space-y-2">
			<Button variant="outline" onClick={prepare} disabled={loading}>
				{loading && (
					<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
				)}
				{t("approvals:approvals.reviseCorrection", "Adjust requested times")}
			</Button>
			{error && (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			)}
		</div>
	);
}
