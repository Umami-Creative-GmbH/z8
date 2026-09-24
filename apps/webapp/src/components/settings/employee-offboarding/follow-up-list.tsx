"use client";

import { IconExternalLink, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ServerActionResult } from "@/lib/effect/result";
import type { EmployeeOffboardingView } from "@/lib/employee-lifecycle/view-types";
import { useRequestIdentity } from "@/lib/query/use-employee-offboarding";
import { Link } from "@/navigation";
import { useOffboardingLabels } from "./labels";

type Review = EmployeeOffboardingView["reviews"][number];

export type FollowUpListProps = {
	employeeId: string;
	departureId: string;
	reviews: EmployeeOffboardingView["reviews"];
	failedTasks: EmployeeOffboardingView["failedTasks"];
	canResolve: boolean;
	/** Canonical place to correct this employee's time around the cutoff. */
	timeCorrectionHref: string;
	highlightedReviewId: string | null;
	replacementOptions: Array<{ id: string; name: string }>;
	resolveReview: (input: {
		reviewId: string;
		resolution: string;
	}) => Promise<ServerActionResult<void>>;
	retryTask: (input: { taskId: string }) => Promise<ServerActionResult<void>>;
	assignReplacement: (input: {
		departureId: string;
		handoverTaskId: string;
		replacementEmployeeId: string;
		requestId: string;
	}) => Promise<ServerActionResult<void>>;
};

/**
 * Persistent follow-up after a departure. Every item is resolved where it
 * lives: time through the canonical correction flow, approvals through a
 * replacement, and explicit reviews with a written resolution. There is no
 * way to clear an error without resolving the underlying work.
 */
export function FollowUpList(props: FollowUpListProps) {
	const { t } = useTranslate();
	const labels = useOffboardingLabels();
	const openReviews = props.reviews.filter((review) => review.status === "open");
	const resolvedReviews = props.reviews.filter((review) => review.status === "resolved");

	if (props.reviews.length === 0 && props.failedTasks.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t("settings.employees.offboarding.noFollowUp", "No follow-up work.")}
			</p>
		);
	}

	return (
		<div className="space-y-4">
			{openReviews.length > 0 && (
				<section aria-labelledby="offboarding-open-reviews" className="space-y-3">
					<h3 id="offboarding-open-reviews" className="text-sm font-medium">
						{t("settings.employees.offboarding.openReviews", "Needs review")}
					</h3>
					<ul className="space-y-3">
						{openReviews.map((review) => (
							<ReviewItem key={review.id} review={review} {...props} />
						))}
					</ul>
				</section>
			)}

			{props.failedTasks.length > 0 && (
				<section aria-labelledby="offboarding-failed-tasks" className="space-y-2">
					<h3 id="offboarding-failed-tasks" className="text-sm font-medium">
						{t("settings.employees.offboarding.failedWork", "Follow-up work failed")}
					</h3>
					<ul className="space-y-2">
						{props.failedTasks.map((task) => (
							<FailedTaskItem
								key={task.id}
								taskId={task.id}
								label={labels.task(task.kind)}
								canRetry={props.canResolve}
								retryTask={props.retryTask}
							/>
						))}
					</ul>
				</section>
			)}

			{resolvedReviews.length > 0 && (
				<details className="text-sm">
					<summary className="cursor-pointer text-muted-foreground">
						{t("settings.employees.offboarding.resolvedReviews", "Resolved reviews ({count})", {
							count: resolvedReviews.length,
						})}
					</summary>
					<ul className="mt-2 space-y-1">
						{resolvedReviews.map((review) => (
							<li key={review.id} className="text-muted-foreground">
								{labels.review(review.kind)}
							</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

function ReviewItem({ review, ...props }: FollowUpListProps & { review: Review }) {
	const { t } = useTranslate();
	const labels = useOffboardingLabels();
	const noteId = useId();
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);
	const isTimeReview = review.kind === "clock_out" || review.kind === "clock_repair";
	const reason = review.reason ? labels.reason(review.reason) : null;

	async function resolve() {
		setPending(true);
		setError(null);
		const result = await props.resolveReview({ reviewId: review.id, resolution: note });
		setPending(false);
		if (!result.success) setError(result.error ?? null);
		else setNote("");
	}

	return (
		<li
			id={`offboarding-review-${review.id}`}
			className={`rounded-md border p-3 ${
				props.highlightedReviewId === review.id ? "border-primary ring-1 ring-primary" : ""
			}`}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="font-medium text-sm">{labels.review(review.kind)}</p>
				<Badge variant="outline">{t("settings.employees.offboarding.statusOpen", "Open")}</Badge>
			</div>
			{reason && <p className="mt-1 text-sm text-muted-foreground">{reason}</p>}

			<div className="mt-3 flex flex-wrap gap-2">
				{isTimeReview && (
					<Button asChild variant="outline" size="sm">
						<Link href={props.timeCorrectionHref}>
							<IconExternalLink className="mr-1 size-4" aria-hidden="true" />
							{t("settings.employees.offboarding.correctTime", "Correct time")}
						</Link>
					</Button>
				)}
			</div>

			{review.kind === "approval_handover" && review.handoverTaskId && props.canResolve && (
				<ReplacementAssignment
					departureId={props.departureId}
					handoverTaskId={review.handoverTaskId}
					options={props.replacementOptions}
					assignReplacement={props.assignReplacement}
				/>
			)}

			{props.canResolve && (
				<div className="mt-3 space-y-2">
					<Label htmlFor={noteId}>
						{t("settings.employees.offboarding.resolutionNote", "Resolution note")}
					</Label>
					<Textarea
						id={noteId}
						rows={2}
						value={note}
						onChange={(event) => setNote(event.target.value)}
					/>
					{error && (
						<p className="text-sm text-destructive" role="alert">
							{error}
						</p>
					)}
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={pending || note.trim().length === 0}
						onClick={() => void resolve()}
					>
						{pending && <IconLoader2 className="mr-1 size-4 animate-spin" aria-hidden="true" />}
						{t("settings.employees.offboarding.markResolved", "Mark resolved")}
					</Button>
				</div>
			)}
		</li>
	);
}

function ReplacementAssignment(props: {
	departureId: string;
	handoverTaskId: string;
	options: Array<{ id: string; name: string }>;
	assignReplacement: FollowUpListProps["assignReplacement"];
}) {
	const { t } = useTranslate();
	const requestIdentity = useRequestIdentity();
	const labelId = useId();
	const [replacementId, setReplacementId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function assign() {
		setPending(true);
		setError(null);
		const intent = {
			departureId: props.departureId,
			handoverTaskId: props.handoverTaskId,
			replacementEmployeeId: replacementId,
		};
		const result = await props.assignReplacement({
			...intent,
			requestId: requestIdentity.forPayload(intent),
		});
		setPending(false);
		if (result.success) requestIdentity.complete();
		else setError(result.error ?? null);
	}

	return (
		<div className="mt-3 space-y-2">
			<Label id={labelId}>
				{t("settings.employees.offboarding.replacement", "Replacement for approvals")}
			</Label>
			<div className="flex flex-wrap gap-2">
				<Select value={replacementId} onValueChange={setReplacementId}>
					<SelectTrigger className="w-64" aria-labelledby={labelId}>
						<SelectValue
							placeholder={t(
								"settings.employees.offboarding.chooseReplacement",
								"Choose a replacement",
							)}
						/>
					</SelectTrigger>
					<SelectContent>
						{props.options.map((option) => (
							<SelectItem key={option.id} value={option.id}>
								{option.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				<Button
					type="button"
					size="sm"
					disabled={pending || !replacementId}
					onClick={() => void assign()}
				>
					{pending && <IconLoader2 className="mr-1 size-4 animate-spin" aria-hidden="true" />}
					{t("settings.employees.offboarding.assignReplacement", "Assign replacement")}
				</Button>
			</div>
			{error && (
				<p className="text-sm text-destructive" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}

function FailedTaskItem(props: {
	taskId: string;
	label: string;
	canRetry: boolean;
	retryTask: FollowUpListProps["retryTask"];
}) {
	const { t } = useTranslate();
	const [pending, setPending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function retry() {
		setPending(true);
		setError(null);
		const result = await props.retryTask({ taskId: props.taskId });
		setPending(false);
		if (!result.success) setError(result.error ?? null);
	}

	return (
		<li className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm">
			<span>{props.label}</span>
			{props.canRetry && (
				<Button
					type="button"
					size="sm"
					variant="outline"
					disabled={pending}
					onClick={() => void retry()}
				>
					{pending ? (
						<IconLoader2 className="mr-1 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconRefresh className="mr-1 size-4" aria-hidden="true" />
					)}
					{t("settings.employees.offboarding.retry", "Retry")}
				</Button>
			)}
			{error && (
				<p className="w-full text-destructive" role="alert">
					{error}
				</p>
			)}
		</li>
	);
}
