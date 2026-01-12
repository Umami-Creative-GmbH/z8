"use client";

import { IconEdit, IconLoader2 } from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	editSameDayTimeEntry,
	requestTimeCorrection,
} from "@/app/[locale]/(app)/time-tracking/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatTimeInZone, getTimezoneAbbreviation } from "@/lib/time-tracking/timezone-utils";

interface WorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
	clockOut?: { notes: string | null } | null;
}

interface Props {
	workPeriod: WorkPeriodData;
	isSameDay: boolean;
	employeeTimezone: string;
}

export function TimeCorrectionDialog({ workPeriod, isSameDay, employeeTimezone }: Props) {
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);
	const router = useRouter();
	const timezoneAbbr = getTimezoneAbbreviation(employeeTimezone);

	const getInitialFormData = () => ({
		clockInTime: formatTimeInZone(workPeriod.startTime, employeeTimezone),
		clockOutTime: workPeriod.endTime ? formatTimeInZone(workPeriod.endTime, employeeTimezone) : "",
		reason: workPeriod.clockOut?.notes || "",
	});

	const [formData, setFormData] = useState(getInitialFormData);

	// Reset form data when dialog opens to get latest values
	const handleOpenChange = (isOpen: boolean) => {
		if (isOpen) {
			setFormData(getInitialFormData());
		}
		setOpen(isOpen);
	};

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();

		// Validate time span - clock out must be after clock in
		if (formData.clockOutTime) {
			const [inHours, inMinutes] = formData.clockInTime.split(":").map(Number);
			const [outHours, outMinutes] = formData.clockOutTime.split(":").map(Number);
			const clockInMinutes = inHours * 60 + inMinutes;
			const clockOutMinutes = outHours * 60 + outMinutes;

			if (clockOutMinutes <= clockInMinutes) {
				toast.error("Clock out time must be after clock in time");
				return;
			}
		}

		setLoading(true);

		if (isSameDay) {
			// Direct edit for same-day entries
			const result = await editSameDayTimeEntry({
				workPeriodId: workPeriod.id,
				newClockInTime: formData.clockInTime,
				newClockOutTime: formData.clockOutTime || undefined,
				reason: formData.reason || undefined,
			});

			if (result.success) {
				toast.success("Time entry updated successfully");
				setOpen(false);
				router.refresh();
			} else {
				toast.error(result.error || "Failed to update time entry");
			}
		} else {
			// Approval required for past entries
			const result = await requestTimeCorrection({
				workPeriodId: workPeriod.id,
				newClockInTime: formData.clockInTime,
				newClockOutTime: formData.clockOutTime || undefined,
				reason: formData.reason,
			});

			if (result.success) {
				toast.success("Correction request submitted for manager approval");
				setOpen(false);
			} else {
				toast.error(result.error || "Failed to submit correction");
			}
		}

		setLoading(false);
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogTrigger asChild>
				<Button variant="ghost" size="icon">
					<IconEdit className="size-4" />
					<span className="sr-only">
						{isSameDay ? "Edit time entry" : "Request time correction"}
					</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{isSameDay ? "Edit Time Entry" : "Request Time Correction"}</DialogTitle>
					<DialogDescription>
						{isSameDay
							? "Make changes to your time entry for today."
							: "Submit a correction request for this time entry. Your manager will need to approve it."}
					</DialogDescription>
				</DialogHeader>
				<form onSubmit={handleSubmit}>
					<div className="grid gap-4 py-4">
						<p className="text-xs text-muted-foreground">
							Times are in your local timezone ({timezoneAbbr})
						</p>
						<div className="grid grid-cols-2 gap-4">
							<div className="flex flex-col gap-2">
								<Label htmlFor="clockIn">Clock In</Label>
								<Input
									type="time"
									id="clockIn"
									value={formData.clockInTime}
									onChange={(e) => setFormData({ ...formData, clockInTime: e.target.value })}
									required
								/>
							</div>

							{workPeriod.endTime && (
								<div className="flex flex-col gap-2">
									<Label htmlFor="clockOut">Clock Out</Label>
									<Input
										type="time"
										id="clockOut"
										value={formData.clockOutTime}
										onChange={(e) => setFormData({ ...formData, clockOutTime: e.target.value })}
									/>
								</div>
							)}
						</div>

						<div className="flex flex-col gap-2">
							<Label htmlFor="reason">
								{isSameDay ? "Note (optional)" : "Reason for Correction"}
							</Label>
							<Textarea
								id="reason"
								value={formData.reason}
								onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
								placeholder={
									isSameDay
										? "Add a note about this change..."
										: "Explain why this correction is needed..."
								}
								required={!isSameDay}
								rows={2}
							/>
						</div>
					</div>

					<DialogFooter className="gap-2 sm:gap-0">
						<DialogClose asChild>
							<Button type="button" variant="outline">
								Cancel
							</Button>
						</DialogClose>
						<Button type="submit" disabled={loading}>
							{loading ? (
								<>
									<IconLoader2 className="size-4 animate-spin" />
									{isSameDay ? "Saving..." : "Submitting..."}
								</>
							) : isSameDay ? (
								"Save Changes"
							) : (
								"Submit Request"
							)}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
