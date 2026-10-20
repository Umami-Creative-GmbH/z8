"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useSession } from "@/lib/auth-client";
import { getDrivingLicenceEmployeeRecordAction } from "@/lib/organization/driving-licence/check-actions";
import { queryKeys } from "@/lib/query";
import { DrivingLicenceCheckEvidence } from "./check-evidence";
import { DrivingLicenceHistoryPanel } from "./history-panel";
import { DrivingLicenceStatusSummary } from "./my-licence";
import { OriginalDrivingCheckForm } from "./original-check-form";
import { ReinstateDrivingAuthorization } from "./reinstate-authorization";

/**
 * One employee's check, the body of `/driving-licence/checks/[employee]` (#1429): the
 * original check form and the reinstatement step, next to the employee's current status,
 * evidence and history. The page guard has already confirmed that the viewer's grant covers
 * the employee; `canVerify` is false for a former employee, whose evidence stays readable.
 */
export function DrivingLicenceCheckPanel({
	employeeId,
	name,
	canVerify,
}: {
	employeeId: string;
	name: string;
	canVerify: boolean;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const organizationId = session?.session.activeOrganizationId;
	const userId = session?.user.id;
	const record = useQuery({
		queryKey: queryKeys.drivingLicence.record(organizationId, userId, employeeId),
		queryFn: () => getDrivingLicenceEmployeeRecordAction({ employeeId }),
	});
	const refresh = async () => {
		void queryClient.invalidateQueries({
			queryKey: queryKeys.drivingLicence.status,
		});
		await queryClient.invalidateQueries({
			queryKey: queryKeys.drivingLicence.historyAll(organizationId, userId, employeeId),
		});
		await queryClient.invalidateQueries({
			queryKey: queryKeys.drivingLicence.worklistAll(organizationId, userId),
		});
		await queryClient.invalidateQueries({
			queryKey: queryKeys.drivingLicence.record(organizationId, userId, employeeId),
		});
	};
	if (record.isPending)
		return (
			<p role="status" className="text-sm text-muted-foreground">
				{t("drivingLicence.checkPage.loading", "Loading the driving licence record…")}
			</p>
		);
	if (!record.data?.success)
		return (
			<p role="alert" className="text-sm text-destructive">
				{t(
					"drivingLicence.checkPage.loadError",
					"The driving licence record could not be loaded. Check your current verifier responsibility.",
				)}
			</p>
		);
	const current = record.data.data;
	const intendedDriver = current.status !== "not_enrolled";
	return (
		<div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
			<div className="space-y-6 lg:order-2">
				{current.uncertainEmailCount > 0 ? (
					<p role="status" className="text-sm text-muted-foreground">
						{t(
							"drivingLicence.delivery.uncertain",
							"Optional reminder emails to you have an uncertain delivery outcome ({count}). They will not be sent again automatically. Your in-app reminders remain available; email delivery does not confirm reading.",
							{ count: current.uncertainEmailCount },
						)}
					</p>
				) : null}
				<DrivingLicenceStatusSummary record={current} audience="verifier" />
				<DrivingLicenceCheckEvidence record={current} />
				<DrivingLicenceHistoryPanel key={employeeId} employeeId={employeeId} />
			</div>
			<div className="space-y-6 lg:order-1">
				{!intendedDriver ? (
					<p role="status" className="text-sm text-muted-foreground">
						{t(
							"drivingLicence.checkPage.notIntended",
							"{name} is not an intended driver. A check is needed only for intended drivers.",
							{ name },
						)}
					</p>
				) : null}
				{canVerify && intendedDriver ? (
					<OriginalDrivingCheckForm
						key={employeeId}
						employeeId={employeeId}
						name={name}
						onCompleted={refresh}
					/>
				) : null}
				{canVerify ? (
					<ReinstateDrivingAuthorization
						key={employeeId + current.checks[0]?.id}
						employeeId={employeeId}
						record={current}
						onCompleted={refresh}
					/>
				) : null}
			</div>
		</div>
	);
}
