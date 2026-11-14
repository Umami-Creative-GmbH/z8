"use client";

import dynamic from "next/dynamic";

const ManualTimeEntryDialog = dynamic(
	() =>
		import("./manual-time-entry-dialog").then(
			(module) => module.ManualTimeEntryDialog,
		),
	{ ssr: false },
);

export function TimeTrackingPageActions({
	employeeId,
	timezone,
}: {
	employeeId: string;
	timezone: string;
}) {
	// The dialog resolves its authorized target and approval requirements when opened.
	return (
		<ManualTimeEntryDialog
			employeeId={employeeId}
			employeeTimezone={timezone}
			hasManager={false}
		/>
	);
}
