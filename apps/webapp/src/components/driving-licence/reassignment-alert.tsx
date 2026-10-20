"use client";
import { IconUserExclamation } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import { getDrivingLicenceTasksAction } from "@/lib/organization/driving-licence/task-actions";
import { queryKeys } from "@/lib/query";

/**
 * Open verifier-responsibility tasks (#1427), shown above the settings tabs so admins see
 * unassigned employees whichever tab is open. Shares the task query with the task lists.
 */
export function DrivingLicenceReassignmentAlert({ onAssign }: { onAssign: () => void }) {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const tasks = useQuery({
		queryKey: queryKeys.drivingLicence.tasks(
			session?.session.activeOrganizationId,
			session?.user.id,
		),
		queryFn: getDrivingLicenceTasksAction,
		enabled: !!session?.session.activeOrganizationId && !!session.user.id,
	});
	const open = tasks.data?.success
		? tasks.data.data.filter((task) => task.kind === "reassignment" && task.state === "pending")
		: [];
	if (!open.length) return null;
	return (
		<Alert variant="destructive">
			<IconUserExclamation aria-hidden="true" />
			<AlertTitle>
				{t(
					"drivingLicence.settingsTabs.reassignment.title",
					"Employees without a responsible verifier",
				)}
			</AlertTitle>
			<AlertDescription className="space-y-3">
				<ul className="list-disc space-y-0.5 pl-5">
					{open.map((task) => (
						<li key={task.id} className="break-words">
							{task.employeeName}
						</li>
					))}
				</ul>
				<p>
					{t(
						"drivingLicence.settingsTabs.reassignment.description",
						"Their checks and reminders have no verifier. Assigning responsibility grants no inspection rights to you and extends no deadline.",
					)}
				</p>
				<Button type="button" variant="outline" size="sm" onClick={onAssign}>
					{t("drivingLicence.tasks.assign", "Assign responsibility")}
				</Button>
			</AlertDescription>
		</Alert>
	);
}
