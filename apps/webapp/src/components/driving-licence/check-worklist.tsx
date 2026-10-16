"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import {
	getDrivingLicenceCheckWorklistAction,
	getDrivingLicenceEmployeeRecordAction,
} from "@/lib/organization/driving-licence/check-actions";
import { DrivingLicenceEvidence, DrivingStatusLabel } from "./check-evidence";
import { OriginalDrivingCheckForm } from "./original-check-form";
import { ReinstateDrivingAuthorization } from "./reinstate-authorization";
export function DrivingLicenceVerifierWorklist() {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const { data: session } = useSession();
	const identity = [session?.session.activeOrganizationId, session?.user.id];
	const [selected, setSelected] = useState<{
		employeeId: string;
		name: string;
	} | null>(null);
	const worklist = useQuery({
		queryKey: ["driving-licence-worklist", ...identity],
		queryFn: () => getDrivingLicenceCheckWorklistAction(),
	});
	const record = useQuery({
		queryKey: ["driving-licence-record", ...identity, selected?.employeeId],
		enabled: !!selected,
		queryFn: () =>
			getDrivingLicenceEmployeeRecordAction({
				employeeId: selected?.employeeId ?? "",
			}),
	});
	const refresh = async () => {
		await queryClient.invalidateQueries({
			queryKey: ["driving-licence-worklist", ...identity],
		});
		await queryClient.invalidateQueries({
			queryKey: ["driving-licence-record", ...identity, selected?.employeeId],
		});
	};
	if (!worklist.data?.success || !worklist.data.data.length) return null;
	return (
		<section
			className="space-y-4 border-t pt-6"
			aria-labelledby="driving-worklist-title"
		>
			<h2 id="driving-worklist-title" className="text-xl font-semibold">
				{t("drivingLicence.worklist.title", "Your original-check worklist")}
			</h2>
			<p className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.worklist.help",
					"Only enrolled employees within your current verifier responsibility appear here.",
				)}
			</p>
			<ul className="divide-y rounded-lg border">
				{worklist.data.data.map((person) => (
					<li
						key={person.employeeId}
						className="flex flex-wrap items-center justify-between gap-3 p-4"
					>
						<div>
							<p className="font-medium">{person.name}</p>
							<p className="text-sm text-muted-foreground">
								<DrivingStatusLabel status={person.status} />
							</p>
						</div>
						<Button variant="outline" onClick={() => setSelected(person)}>
							{t("drivingLicence.worklist.open", "Check {name}", {
								name: person.name,
							})}
						</Button>
					</li>
				))}
			</ul>
			{selected && (
				<div className="space-y-5">
					<OriginalDrivingCheckForm
						key={selected.employeeId}
						employeeId={selected.employeeId}
						name={selected.name}
						onCompleted={refresh}
					/>
					{record.data?.success && (
						<>
							<DrivingLicenceEvidence record={record.data.data} />
							<ReinstateDrivingAuthorization
								key={selected.employeeId + record.data.data.checks[0]?.id}
								employeeId={selected.employeeId}
								record={record.data.data}
								onCompleted={refresh}
							/>
						</>
					)}
				</div>
			)}
		</section>
	);
}
