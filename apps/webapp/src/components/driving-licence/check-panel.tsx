"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/lib/auth-client";
import { getDrivingLicenceEmployeeRecordAction } from "@/lib/organization/driving-licence/check-actions";
import { DrivingLicenceEvidence } from "./check-evidence";
import { DrivingLicenceHistoryPanel } from "./history-panel";
import { OriginalDrivingCheckForm } from "./original-check-form";
import { ReinstateDrivingAuthorization } from "./reinstate-authorization";

/**
 * One employee's check: the original check form, current evidence, history and the
 * reinstatement step. The Checks table opens it inline until each check gets its own page
 * (#1429 moves it to `/driving-licence/checks/[employee]`).
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
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const identity = [session?.session.activeOrganizationId, session?.user.id];
	const record = useQuery({
		queryKey: ["driving-licence-record", ...identity, employeeId],
		queryFn: () => getDrivingLicenceEmployeeRecordAction({ employeeId }),
	});
	const refresh = async () => {
		void queryClient.invalidateQueries({
			queryKey: ["driving-authorization-status"],
		});
		await queryClient.invalidateQueries({
			queryKey: ["driving-licence-history", ...identity, employeeId],
		});
		await queryClient.invalidateQueries({
			queryKey: ["driving-licence-worklist", ...identity],
		});
		await queryClient.invalidateQueries({
			queryKey: ["driving-licence-record", ...identity, employeeId],
		});
	};
	return (
		<div className="space-y-5">
			{canVerify && (
				<OriginalDrivingCheckForm
					key={employeeId}
					employeeId={employeeId}
					name={name}
					onCompleted={refresh}
				/>
			)}
			{record.data?.success && (
				<>
					<DrivingLicenceEvidence record={record.data.data} />
					<DrivingLicenceHistoryPanel key={employeeId} employeeId={employeeId} />
					{canVerify && (
						<ReinstateDrivingAuthorization
							key={employeeId + record.data.data.checks[0]?.id}
							employeeId={employeeId}
							record={record.data.data}
							onCompleted={refresh}
						/>
					)}
				</>
			)}
		</div>
	);
}
