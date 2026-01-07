"use client";

import { IconEdit, IconLoader2 } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { requestTimeCorrection } from "@/app/[locale]/(app)/time-tracking/actions";
import { Button } from "@/components/ui/button";
import {
	Drawer,
	DrawerClose,
	DrawerContent,
	DrawerDescription,
	DrawerFooter,
	DrawerHeader,
	DrawerTitle,
	DrawerTrigger,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface WorkPeriodData {
	id: string;
	startTime: Date;
	endTime: Date | null;
}

interface Props {
	workPeriod: WorkPeriodData;
}

export function TimeCorrectionDialog({ workPeriod }: Props) {
	const [open, setOpen] = useState(false);
	const [loading, setLoading] = useState(false);

	// Extract time from ISO string for input initial value
	const getTimeFromDate = (date: Date | string) => {
		const d = new Date(date);
		return d.toTimeString().substring(0, 5); // HH:MM
	};

	const [formData, setFormData] = useState({
		clockInTime: getTimeFromDate(workPeriod.startTime),
		clockOutTime: workPeriod.endTime ? getTimeFromDate(workPeriod.endTime) : "",
		reason: "",
	});

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		setLoading(true);

		const result = await requestTimeCorrection({
			workPeriodId: workPeriod.id,
			newClockInTime: formData.clockInTime,
			newClockOutTime: formData.clockOutTime || undefined,
			reason: formData.reason,
		});

		if (result.success) {
			toast.success("Correction request submitted for manager approval");
			setOpen(false);
			// Reset form
			setFormData({
				clockInTime: getTimeFromDate(workPeriod.startTime),
				clockOutTime: workPeriod.endTime ? getTimeFromDate(workPeriod.endTime) : "",
				reason: "",
			});
		} else {
			toast.error(result.error || "Failed to submit correction");
		}

		setLoading(false);
	};

	return (
		<Drawer open={open} onOpenChange={setOpen}>
			<DrawerTrigger asChild>
				<Button variant="ghost" size="icon">
					<IconEdit className="size-4" />
					<span className="sr-only">Request time correction</span>
				</Button>
			</DrawerTrigger>
			<DrawerContent>
				<DrawerHeader>
					<DrawerTitle>Request Time Correction</DrawerTitle>
					<DrawerDescription>
						Submit a correction request for this time entry. Your manager will need to approve it.
					</DrawerDescription>
				</DrawerHeader>
				<form onSubmit={handleSubmit} className="px-4">
					<div className="flex flex-col gap-4 py-4">
						<div className="flex flex-col gap-2">
							<Label htmlFor="clockIn">Clock In Time</Label>
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
								<Label htmlFor="clockOut">Clock Out Time</Label>
								<Input
									type="time"
									id="clockOut"
									value={formData.clockOutTime}
									onChange={(e) => setFormData({ ...formData, clockOutTime: e.target.value })}
								/>
							</div>
						)}

						<div className="flex flex-col gap-2">
							<Label htmlFor="reason">Reason for Correction</Label>
							<Textarea
								id="reason"
								value={formData.reason}
								onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
								placeholder="Explain why this correction is needed..."
								required
								rows={4}
							/>
						</div>
					</div>

					<DrawerFooter>
						<Button type="submit" disabled={loading} className="w-full">
							{loading ? (
								<>
									<IconLoader2 className="size-4 animate-spin" />
									Submitting...
								</>
							) : (
								"Submit Request"
							)}
						</Button>
						<DrawerClose asChild>
							<Button variant="outline" className="w-full">
								Cancel
							</Button>
						</DrawerClose>
					</DrawerFooter>
				</form>
			</DrawerContent>
		</Drawer>
	);
}
