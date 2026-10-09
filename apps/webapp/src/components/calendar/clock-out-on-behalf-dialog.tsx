"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	getClockOutOnBehalfTaskChoices,
	type OnBehalfClockOutTaskChoices,
} from "@/app/[locale]/(app)/time-tracking/actions/on-behalf-task-choices";
import { TaskSelectorView } from "@/components/time-tracking/task-selector";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query/keys";
import { namedTaskId, taskIdToSend } from "@/lib/time-tracking/task-attribution";

/**
 * The task the clock-out on behalf sends (#874): omitted, the running work's
 * task follows its project (it is kept); null clears it; an ID books that task.
 */
export type OnBehalfClockOutTaskChoice = { taskId?: string | null };

interface ClockOutOnBehalfDialogProps {
	open: boolean;
	/** The running work period to close. */
	workPeriodId: string | null;
	isPending: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (choice: OnBehalfClockOutTaskChoice) => void;
}

export function ClockOutOnBehalfDialog({
	open,
	workPeriodId,
	isPending,
	onOpenChange,
	onConfirm,
}: ClockOutOnBehalfDialogProps) {
	const { t } = useTranslate();
	const choicesQuery = useQuery({
		queryKey: queryKeys.projects.onBehalfClockOutTasks(workPeriodId ?? ""),
		queryFn: async () => {
			const result = await getClockOutOnBehalfTaskChoices(workPeriodId ?? "");
			if (!result.success) throw new Error(result.error);
			return result.data ?? null;
		},
		enabled: open && workPeriodId !== null,
		staleTime: 0,
	});
	const choices = choicesQuery.data ?? null;

	return (
		<AlertDialog open={open} onOpenChange={onOpenChange}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("calendar.clockOutOnBehalf.title", "Clock out employee?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"calendar.clockOutOnBehalf.description",
							"This creates an auditable clock-out entry at the current server time. If anything needs adjustment afterward, use corrections.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				{/* Remounted once the choices arrive, so the running work's task starts selected. */}
				<ClockOutOnBehalfForm
					key={`${workPeriodId ?? ""}:${choices ? "choices" : "none"}`}
					choices={choices}
					isPending={isPending}
					onConfirm={onConfirm}
				/>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function ClockOutOnBehalfForm({
	choices,
	isPending,
	onConfirm,
}: {
	choices: OnBehalfClockOutTaskChoices | null;
	isPending: boolean;
	onConfirm: (choice: OnBehalfClockOutTaskChoice) => void;
}) {
	const { t } = useTranslate();
	const initialTaskId = choices?.currentTask?.id;
	const [taskId, setTaskId] = useState<string | undefined>(initialTaskId);
	const projectId = choices?.projectId ?? undefined;

	const confirm = () =>
		// An unchanged task is left to the server, which keeps it with the project.
		onConfirm(
			namedTaskId(taskIdToSend({ projectId, taskId, current: { projectId, taskId: initialTaskId } })),
		);

	return (
		<>
			{choices && projectId ? (
				<TaskSelectorView
					projectId={projectId}
					projects={[{ id: projectId, tasks: choices.tasks }]}
					value={taskId}
					onValueChange={setTaskId}
					currentTask={choices.currentTask}
					disabled={isPending}
				/>
			) : null}
			<AlertDialogFooter>
				<AlertDialogCancel disabled={isPending}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
				<Button type="button" disabled={isPending} onClick={confirm}>
					{isPending ? (
						<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
					) : null}
					{isPending
						? t("calendar.clockOutOnBehalf.loading", "Clocking out...")
						: t("calendar.clockOutOnBehalf.confirm", "Clock Out")}
				</Button>
			</AlertDialogFooter>
		</>
	);
}
