"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import {
	getClockOutOnBehalfTaskChoices,
	type OnBehalfClockOutTaskChoices,
} from "@/app/[locale]/(app)/time-tracking/actions/on-behalf-task-choices";
import { type BillableChoice, billableChoice } from "@/components/time-tracking/billable-choice";
import { BillableWorkSwitch } from "@/components/time-tracking/billable-work-switch";
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
import type { CalendarEvent } from "@/lib/calendar/types";
import { queryKeys } from "@/lib/query/keys";
import { namedTaskId, taskIdToSend } from "@/lib/time-tracking/task-attribution";

/**
 * What the clock-out on behalf sends. The task (#874): omitted, the running
 * work's task follows its project (it is kept); null clears it; an ID books that
 * task. `billable` (#900) is the explicit choice; omitted keeps the work's.
 */
export type OnBehalfClockOutTaskChoice = { taskId?: string | null; billable?: boolean };

interface ClockOutOnBehalfDialogProps {
	open: boolean;
	/** The running work period to close. */
	workPeriodId: string | null;
	/** The running work; its project and billability decide the billable toggle (#900). */
	work?: CalendarEvent | null;
	isPending: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: (choice: OnBehalfClockOutTaskChoice) => void;
}

export function ClockOutOnBehalfDialog({
	open,
	workPeriodId,
	work,
	isPending,
	onOpenChange,
	onConfirm,
}: ClockOutOnBehalfDialogProps) {
	const { t } = useTranslate();
	const [billable, setBillable] = useState<{ workId: string; value: boolean } | null>(null);
	const metadata = work?.metadata;
	// The closure keeps the work's project, so the toggle starts from its billability.
	const choice = billableChoice({
		project: metadata?.projectId
			? { hasCustomer: metadata.projectHasCustomer ?? false, billableDefault: false }
			: null,
		explicit: billable && billable.workId === work?.id ? billable.value : undefined,
		kept: metadata?.isBillable ?? false,
	});
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
		<AlertDialog
			open={open}
			onOpenChange={(next) => {
				if (!next) setBillable(null);
				onOpenChange(next);
			}}
		>
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
					billable={
						work
							? { choice, onChange: (value: boolean) => setBillable({ workId: work.id, value }) }
							: null
					}
					isPending={isPending}
					onConfirm={onConfirm}
				/>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function ClockOutOnBehalfForm({
	choices,
	billable,
	isPending,
	onConfirm,
}: {
	choices: OnBehalfClockOutTaskChoices | null;
	/** The billable toggle (#900), shown for running work it applies to. */
	billable: { choice: BillableChoice; onChange: (value: boolean) => void } | null;
	isPending: boolean;
	onConfirm: (choice: OnBehalfClockOutTaskChoice) => void;
}) {
	const { t } = useTranslate();
	const initialTaskId = choices?.currentTask?.id;
	const [taskId, setTaskId] = useState<string | undefined>(initialTaskId);
	const projectId = choices?.projectId ?? undefined;

	const confirm = () =>
		// An unchanged task is left to the server, which keeps it with the project.
		onConfirm({
			...namedTaskId(
				taskIdToSend({ projectId, taskId, current: { projectId, taskId: initialTaskId } }),
			),
			...(billable?.choice.request === undefined ? {} : { billable: billable.choice.request }),
		});

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
			{billable ? (
				<BillableWorkSwitch
					choice={billable.choice}
					onChange={billable.onChange}
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
