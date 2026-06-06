"use client";

import { IconClock } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { updateTimezone } from "@/app/[locale]/(app)/settings/profile/actions";
import { useTimeFormat, useUserTimezone } from "@/components/providers/user-preferences-provider";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useRouter } from "@/navigation";
import { formatHeaderTimezone } from "./header-timezone-control-utils";

function getInitialCurrentTime() {
	const initialNow = DateTime.now();
	const latestNow = DateTime.now();
	return latestNow.hasSame(initialNow, "minute") ? initialNow : latestNow;
}

export function HeaderTimezoneControl() {
	const router = useRouter();
	const savedTimezone = useUserTimezone();
	const timeFormat = useTimeFormat();
	const [now, setNow] = useState(getInitialCurrentTime);
	const [open, setOpen] = useState(false);
	const [draftTimezone, setDraftTimezone] = useState(savedTimezone);
	const [pending, setPending] = useState(false);

	useEffect(() => {
		let interval: number | undefined;
		const current = DateTime.now();
		const millisecondsUntilNextMinute = 60_000 - (current.second * 1_000 + current.millisecond);
		const timeout = window.setTimeout(() => {
			setNow(DateTime.now());
			interval = window.setInterval(() => {
				setNow(DateTime.now());
			}, 60_000);
		}, millisecondsUntilNextMinute);

		return () => {
			window.clearTimeout(timeout);
			if (interval) {
				window.clearInterval(interval);
			}
		};
	}, []);

	const { displayTimezone, offsetLabel, timeLabel } = formatHeaderTimezone({
		now,
		timezone: savedTimezone,
		timeFormat,
	});
	const selectedTimezone = open ? draftTimezone : savedTimezone;
	const hasChanges = selectedTimezone !== savedTimezone;

	async function handleSave() {
		setPending(true);

		try {
			const result = await updateTimezone(selectedTimezone);

			if (!result) {
				toast.error("An error occurred while updating timezone");
				setPending(false);
				return;
			}

			if (!result.success) {
				toast.error(result.error || "Failed to update timezone");
				setPending(false);
				return;
			}

			toast.success("Timezone updated successfully");
			setPending(false);
			setOpen(false);
			router.refresh();
		} catch {
			toast.error("An error occurred while updating timezone");
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
					className="h-9 gap-1 px-2 sm:gap-2 sm:px-3"
					suppressHydrationWarning
					type="button"
					variant="ghost"
				>
					<IconClock className="hidden size-4 sm:block" aria-hidden="true" />
					<span className="hidden font-medium tabular-nums sm:inline" suppressHydrationWarning>
						{timeLabel}
					</span>
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

				<TimezonePicker value={selectedTimezone} onChange={setDraftTimezone} disabled={pending} />

				<Button
					aria-busy={pending}
					className="w-full"
					disabled={!hasChanges || pending}
					onClick={handleSave}
					type="button"
				>
					{pending ? "Saving..." : "Save timezone"}
				</Button>
			</PopoverContent>
		</Popover>
	);
}
