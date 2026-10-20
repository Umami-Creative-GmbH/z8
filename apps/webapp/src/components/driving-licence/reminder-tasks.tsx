"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	completeDrivingLicencePersonalReminderAction,
	getDrivingLicenceTasksAction,
} from "@/lib/organization/driving-licence/task-actions";
import type { DrivingLicenceTaskView } from "@/lib/organization/driving-licence/tasks";
import { drivingLicenceCheckPath } from "@/lib/organization/driving-licence/paths";
import { Link } from "@/navigation";

const TASK_LINK_CLASS =
	"block w-fit rounded-sm text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

function PersonalReminderItem({
	task,
}: {
	task: Extract<DrivingLicenceTaskView, { kind: "personal_reminder" }>;
}) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const client = useQueryClient();
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);
	const complete = () =>
		startTransition(async () => {
			setError(null);
			const result = await completeDrivingLicencePersonalReminderAction({
				taskId: task.id,
			});
			if (!result.success)
				setError(
					t(
						"drivingLicence.tasks.completeError",
						"Could not complete this task. Check your current verifier responsibility.",
					),
				);
			await client.invalidateQueries({ queryKey: ["drivingLicence", "tasks"] });
		});
	return (
		<li className="space-y-3 p-4">
			<p className="break-words font-medium">{task.employeeName}</p>
			<p className="text-sm">
				{task.occasion.kind === "initial"
					? t(
							"drivingLicence.tasks.initialCheck",
							"Initial original check required",
						)
					: task.occasion.kind === "suspension"
						? t(
								"drivingLicence.tasks.suspension",
								"Driving authorization suspended",
							)
						: t("drivingLicence.tasks.deadline", "Original check due")}
			</p>
			{task.occasion.classCode ? (
				<p className="text-sm">
					{t("drivingLicence.tasks.class", "Class {classCode}", {
						classCode: task.occasion.classCode,
					})}
				</p>
			) : null}
			{task.occasion.validThrough ? (
				<p className="text-sm">
					{t(
						"drivingLicence.tasks.validThrough",
						"Valid through {date} in the check’s saved deadline timezone",
						{
							date: formatPlainDate(
								parsePlainDate(task.occasion.validThrough),
								locale,
								"dateMedium",
							),
						},
					)}
				</p>
			) : null}
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.tasks.directUnavailable",
					"Direct employee notification was unavailable. Remind this employee in person.",
				)}
			</p>
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.tasks.noDeliveryReceipt",
					"Task completion does not confirm direct delivery or employee reading. No deadline is extended.",
				)}
			</p>
			{task.state === "completed" ? (
				<p role="status" className="text-sm">
					{t(
						"drivingLicence.tasks.personalCompleted",
						"Personal reminder completed",
					)}
				</p>
			) : (
				<Button variant="outline" disabled={pending} onClick={complete}>
					{pending
						? t("drivingLicence.tasks.completing", "Completing…")
						: t(
								"drivingLicence.tasks.complete",
								"Mark personal reminder completed",
							)}
				</Button>
			)}
			{error ? (
				<p role="alert" className="text-sm text-destructive">
					{error}
				</p>
			) : null}
			<Link className={TASK_LINK_CLASS} href={drivingLicenceCheckPath(task.employeeId)}>
				{t("drivingLicence.tasks.openCheck", "Open check")}
			</Link>
		</li>
	);
}
function ReassignmentItem({
	task,
}: {
	task: Extract<DrivingLicenceTaskView, { kind: "reassignment" }>;
}) {
	const { t } = useTranslate();
	return (
		<li className="space-y-3 p-4">
			<p className="break-words font-medium">{task.employeeName}</p>
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.tasks.assignmentBoundary",
					"This task grants no inspection rights and does not extend any deadline.",
				)}
			</p>
			{task.state === "pending" ? (
				<p className="text-sm">
					{t(
						"drivingLicence.tasks.noVerifier",
						"No available verifier is responsible for this employee.",
					)}
				</p>
			) : null}
			{task.state === "completed" ? (
				<p role="status" className="text-sm">
					{t("drivingLicence.tasks.assigned", "Responsibility assigned")}
				</p>
			) : (
				<Link
					className={TASK_LINK_CLASS}
					href="/settings/driving-licence#driving-verifier-settings"
				>
					{t("drivingLicence.tasks.assign", "Assign responsibility")}
				</Link>
			)}
		</li>
	);
}
function DrivingLicenceTasks({
	kind,
}: {
	kind: DrivingLicenceTaskView["kind"];
}) {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const titleId = useId();
	const tasks = useQuery({
		queryKey: [
			"drivingLicence",
			"tasks",
			session?.session.activeOrganizationId,
			session?.user.id,
		],
		queryFn: getDrivingLicenceTasksAction,
		enabled: !!session?.session.activeOrganizationId && !!session.user.id,
	});
	if (tasks.isPending)
		return (
			<p role="status">
				{t("drivingLicence.tasks.loading", "Loading driving licence tasks…")}
			</p>
		);
	if (tasks.isError || !tasks.data?.success)
		return (
			<p role="alert">
				{t(
					"drivingLicence.tasks.loadError",
					"Could not load driving licence tasks. Check your organization access.",
				)}
			</p>
		);
	const visible = tasks.data.data.filter((task) => task.kind === kind);
	if (!visible.length) return null;
	return (
		<section className="space-y-4 border-t pt-6" aria-labelledby={titleId}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<h2 id={titleId} className="text-balance text-xl font-semibold">
					{kind === "personal_reminder"
						? t("drivingLicence.tasks.personalTitle", "Personal reminder tasks")
						: t(
								"drivingLicence.tasks.reassignmentTitle",
								"Verifier responsibility tasks",
							)}
				</h2>
				<Button
					variant="outline"
					disabled={tasks.isFetching}
					onClick={() => void tasks.refetch()}
				>
					{t("drivingLicence.tasks.refresh", "Recheck responsibility")}
				</Button>
			</div>
			<ul className="divide-y rounded-lg border">
				{visible.map((task) =>
					task.kind === "personal_reminder" ? (
						<PersonalReminderItem key={task.id} task={task} />
					) : (
						<ReassignmentItem key={task.id} task={task} />
					),
				)}
			</ul>
		</section>
	);
}
export function DrivingLicencePersonalReminderTasks() {
	return <DrivingLicenceTasks kind="personal_reminder" />;
}
export function DrivingLicenceReassignmentTasks() {
	return <DrivingLicenceTasks kind="reassignment" />;
}
