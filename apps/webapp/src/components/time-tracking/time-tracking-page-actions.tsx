"use client";

import { IconPlus } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Button } from "@/components/ui/button";

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
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	// The dialog resolves its authorized target and approval requirements when opened.
	return (
		<>
			<Button variant="outline" onClick={() => setOpen(true)}>
				<IconPlus aria-hidden="true" className="size-4" />
				{t("timeTracking.manualEntry.title", "Add Time Entry")}
			</Button>
			<ManualTimeEntryDialog
				employeeId={employeeId}
				employeeTimezone={timezone}
				hasManager={false}
				open={open}
				onOpenChange={setOpen}
				hideTrigger
			/>
		</>
	);
}
