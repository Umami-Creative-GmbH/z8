"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/lib/auth-client";
import { drivingLicenceCheckPath } from "@/lib/organization/driving-licence/paths";
import {
	completeDrivingLicencePersonalReminderAction,
	getDrivingLicenceTasksAction,
} from "@/lib/organization/driving-licence/task-actions";
import type { DrivingLicenceTaskView } from "@/lib/organization/driving-licence/tasks";
import { queryKeys } from "@/lib/query";
import { Link } from "@/navigation";
import { useDrivingDateOnly } from "./deadline-date";

const TASK_LINK_CLASS =
	"block w-fit rounded-sm text-sm font-medium text-primary underline underline-offset-4 hover:text-primary/80 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

function PersonalReminderItem({
	task,
}: {
	task: Extract<DrivingLicenceTaskView, { kind: "personal_reminder" }>;
}) {
	const { t } = useTranslate();
	const formatDate = useDrivingDateOnly();
	const client = useQueryClient();
	const [pending, startTransition] = useTransition();
	const complete = () =>
		startTransition(async () => {
			const result = await completeDrivingLicencePersonalReminderAction({
				taskId: task.id,
			});
			if (result.success)
				toast.success(
					t("drivingLicence.tasks.completedToast", "Personal reminder marked completed"),
				);
			else
				toast.error(
					t(
						"drivingLicence.tasks.completeError",
						"Could not complete this task. Check your current verifier responsibility.",
					),
				);
			await client.invalidateQueries({ queryKey: queryKeys.drivingLicence.tasksAll });
		});
	return (
		<li className="space-y-3 py-4 first:pt-0 last:pb-0">
			<p className="break-words font-medium">{task.employeeName}</p>
			<p className="text-sm">
				{task.occasion.kind === "initial"
					? t("drivingLicence.tasks.initialCheck", "Initial original check required")
					: task.occasion.kind === "suspension"
						? t("drivingLicence.tasks.suspension", "Driving authorization suspended")
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
						{ date: formatDate(task.occasion.validThrough) },
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
					{t("drivingLicence.tasks.personalCompleted", "Personal reminder completed")}
				</p>
			) : (
				<Button variant="outline" disabled={pending} onClick={complete}>
					{pending
						? t("drivingLicence.tasks.completing", "Completing…")
						: t("drivingLicence.tasks.complete", "Mark personal reminder completed")}
				</Button>
			)}
			<Link className={TASK_LINK_CLASS} href={drivingLicenceCheckPath(task.employeeId)}>
				{t("drivingLicence.tasks.openCheck", "Open check")}
			</Link>
		</li>
	);
}

/**
 * The verifier's personal reminder tasks on the Checks tab: terminal-only intended drivers
 * to remind in person. Reassignment tasks show above the settings tabs instead
 * (`DrivingLicenceReassignmentAlert`).
 */
export function DrivingLicencePersonalReminderTasks() {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const titleId = useId();
	const tasks = useQuery({
		queryKey: queryKeys.drivingLicence.tasks(
			session?.session.activeOrganizationId,
			session?.user.id,
		),
		queryFn: getDrivingLicenceTasksAction,
		enabled: !!session?.session.activeOrganizationId && !!session.user.id,
	});
	if (tasks.isPending)
		return (
			<p role="status">{t("drivingLicence.tasks.loading", "Loading driving licence tasks…")}</p>
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
	const visible = tasks.data.data.filter(
		(task): task is Extract<DrivingLicenceTaskView, { kind: "personal_reminder" }> =>
			task.kind === "personal_reminder",
	);
	if (!visible.length) return null;
	return (
		<Card role="region" aria-labelledby={titleId}>
			<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
				<CardTitle>
					<h2 id={titleId} className="text-balance text-lg font-semibold">
						{t("drivingLicence.tasks.personalTitle", "Personal reminder tasks")}
					</h2>
				</CardTitle>
				<Button variant="outline" disabled={tasks.isFetching} onClick={() => void tasks.refetch()}>
					{t("drivingLicence.tasks.refresh", "Recheck responsibility")}
				</Button>
			</CardHeader>
			<CardContent>
				<ul className="divide-y">
					{visible.map((task) => (
						<PersonalReminderItem key={task.id} task={task} />
					))}
				</ul>
			</CardContent>
		</Card>
	);
}
