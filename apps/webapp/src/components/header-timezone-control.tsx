"use client";

import { IconWorld } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { useTimeFormat, useUserTimezone } from "@/components/providers/user-preferences-provider";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { useRouter } from "@/navigation";

export interface HeaderTimezoneDisplay {
	timeLabel: string;
	offsetLabel: string;
	displayTimezone: string;
}

export function formatHeaderTimezone({
	now,
	timezone,
	timeFormat,
}: {
	now: DateTime;
	timezone: string;
	timeFormat: TimeFormat;
}): HeaderTimezoneDisplay {
	const zonedNow = now.setZone(timezone);
	const displayDateTime = zonedNow.isValid ? zonedNow : now.setZone("UTC");
	const displayTimezone = zonedNow.isValid ? timezone : "UTC";
	const offsetMinutes = displayDateTime.offset;
	const sign = offsetMinutes >= 0 ? "+" : "-";
	const absoluteOffset = Math.abs(offsetMinutes);
	const offsetHours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
	const offsetRemainderMinutes = String(absoluteOffset % 60).padStart(2, "0");

	return {
		displayTimezone,
		offsetLabel: `UTC${sign}${offsetHours}:${offsetRemainderMinutes}`,
		timeLabel: displayDateTime.toFormat(timeFormat === "12h" ? "h:mm a" : "HH:mm"),
	};
}

export function HeaderTimezoneControl() {
	const router = useRouter();
	const savedTimezone = useUserTimezone();
	const timeFormat = useTimeFormat();
	const [now, setNow] = useState(() => DateTime.now());
	const [open, setOpen] = useState(false);
	const [draftTimezone, setDraftTimezone] = useState(savedTimezone);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		const interval = window.setInterval(() => {
			setNow(DateTime.now());
		}, 60_000);

		return () => window.clearInterval(interval);
	}, []);

	useEffect(() => {
		if (!open) {
			setDraftTimezone(savedTimezone);
		}
	}, [open, savedTimezone]);

	const { displayTimezone, offsetLabel, timeLabel } = formatHeaderTimezone({
		now,
		timezone: savedTimezone,
		timeFormat,
	});
	const hasChanges = draftTimezone !== savedTimezone;

	async function handleSave() {
		setPending(true);

		try {
			const result = await updateTimezone(draftTimezone);

			if (!result) {
				toast.error("An error occurred while updating timezone");
				return;
			}

			if (!result.success) {
				toast.error(result.error || "Failed to update timezone");
				return;
			}

			toast.success("Timezone updated successfully");
			setOpen(false);
			router.refresh();
		} catch {
			toast.error("An error occurred while updating timezone");
		} finally {
			setPending(false);
		}
	}

	return (
		<Popover
			open={open}
			onOpenChange={(nextOpen) => {
				setOpen(nextOpen);
				if (!nextOpen) {
					setDraftTimezone(savedTimezone);
				}
			}}
		>
			<PopoverTrigger asChild>
				<Button
					aria-label={`Current timezone ${displayTimezone}, ${timeLabel}, ${offsetLabel}`}
					className="h-9 gap-2 px-3"
					type="button"
					variant="ghost"
				>
					<IconWorld className="size-4" aria-hidden="true" />
					<span className="font-medium tabular-nums">{timeLabel}</span>
					<Badge variant="secondary" className="font-mono text-[11px]">
						{offsetLabel}
					</Badge>
				</Button>
			</PopoverTrigger>
			<PopoverContent align="end" className="w-80 space-y-4">
				<div className="space-y-1">
					<p className="text-sm font-medium">Saved timezone</p>
					<p className="break-all text-muted-foreground text-sm">{savedTimezone}</p>
				</div>

				<TimezonePicker value={draftTimezone} onChange={setDraftTimezone} disabled={pending} />

				<Button
					className="w-full"
					disabled={!hasChanges || pending}
					onClick={handleSave}
					type="button"
				>
					Save timezone
				</Button>
			</PopoverContent>
		</Popover>
	);
}
