"use client";

import { IconCalendar, IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";
import { setWorkSchedule } from "@/app/[locale]/(app)/settings/employees/actions";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "@/lib/datetime/luxon-utils";
import { cn } from "@/lib/utils";

interface WorkScheduleFormProps {
	employeeId: string;
	currentSchedule?: any;
	onSuccess?: () => void;
	onCancel?: () => void;
}

const DAYS = [
	{ value: "monday", label: "Monday" },
	{ value: "tuesday", label: "Tuesday" },
	{ value: "wednesday", label: "Wednesday" },
	{ value: "thursday", label: "Thursday" },
	{ value: "friday", label: "Friday" },
	{ value: "saturday", label: "Saturday" },
	{ value: "sunday", label: "Sunday" },
];

export function WorkScheduleForm({
	employeeId,
	currentSchedule,
	onSuccess,
	onCancel,
}: WorkScheduleFormProps) {
	const [scheduleType, setScheduleType] = useState<"simple" | "detailed">("simple");
	const [workClassification, setWorkClassification] = useState<"daily" | "weekly" | "monthly">(
		"weekly",
	);
	const [effectiveFrom, setEffectiveFrom] = useState<Date>(new Date());
	const [loading, setLoading] = useState(false);

	// Simple schedule state
	const [hoursPerWeek, setHoursPerWeek] = useState("40");

	// Detailed schedule state
	const [detailedSchedule, setDetailedSchedule] = useState(
		DAYS.map((day) => ({
			dayOfWeek: day.value as any,
			hoursPerDay: "8",
			isWorkDay: day.value !== "saturday" && day.value !== "sunday",
		})),
	);

	const handleDetailedDayChange = (
		dayOfWeek: string,
		field: "hoursPerDay" | "isWorkDay",
		value: string | boolean,
	) => {
		setDetailedSchedule((prev) =>
			prev.map((day) => (day.dayOfWeek === dayOfWeek ? { ...day, [field]: value } : day)),
		);
	};

	const calculateTotalHours = () => {
		if (scheduleType === "simple") {
			return parseFloat(hoursPerWeek || "0");
		}
		return detailedSchedule
			.filter((d) => d.isWorkDay)
			.reduce((total, day) => total + parseFloat(day.hoursPerDay || "0"), 0);
	};

	const handleSave = async () => {
		setLoading(true);

		try {
			const scheduleData: any = {
				scheduleType,
				workClassification,
				effectiveFrom,
			};

			if (scheduleType === "simple") {
				// Validate hours per week
				const hours = parseFloat(hoursPerWeek);
				if (Number.isNaN(hours) || hours < 0 || hours > 168) {
					toast.error("Hours per week must be between 0 and 168");
					setLoading(false);
					return;
				}
				scheduleData.hoursPerWeek = hoursPerWeek;
			} else {
				// Validate detailed schedule
				for (const day of detailedSchedule) {
					const hours = parseFloat(day.hoursPerDay);
					if (Number.isNaN(hours) || hours < 0 || hours > 24) {
						toast.error(`Hours per day must be between 0 and 24 for ${day.dayOfWeek}`);
						setLoading(false);
						return;
					}
				}
				scheduleData.days = detailedSchedule;
			}

			const result = await setWorkSchedule(employeeId, scheduleData);

			if (result.success) {
				toast.success("Work schedule saved successfully");
				onSuccess?.();
			} else {
				toast.error(result.error || "Failed to save work schedule");
			}
		} catch (_error) {
			toast.error("An unexpected error occurred");
		} finally {
			setLoading(false);
		}
	};

	const totalHours = calculateTotalHours();

	return (
		<Card>
			<CardHeader>
				<CardTitle>Work Schedule Configuration</CardTitle>
				<CardDescription>
					Define the employee's working hours using simple or detailed schedule
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Schedule Type Selection */}
				<Tabs value={scheduleType} onValueChange={(v) => setScheduleType(v as any)}>
					<TabsList className="grid w-full grid-cols-2">
						<TabsTrigger value="simple">Simple Schedule</TabsTrigger>
						<TabsTrigger value="detailed">Detailed Schedule</TabsTrigger>
					</TabsList>

					<TabsContent value="simple" className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="hoursPerWeek">Hours Per Week</Label>
							<Input
								id="hoursPerWeek"
								type="number"
								step="0.5"
								min="0"
								max="168"
								value={hoursPerWeek}
								onChange={(e) => setHoursPerWeek(e.target.value)}
								placeholder="40"
							/>
							<p className="text-sm text-muted-foreground">Total weekly working hours (0-168)</p>
						</div>
					</TabsContent>

					<TabsContent value="detailed" className="space-y-4">
						<div className="space-y-4">
							<Label>Daily Schedule</Label>
							<div className="space-y-2">
								{DAYS.map((day) => {
									const daySchedule = detailedSchedule.find((d) => d.dayOfWeek === day.value);
									if (!daySchedule) return null;

									return (
										<div key={day.value} className="flex items-center gap-4 rounded-lg border p-3">
											<Checkbox
												id={`workday-${day.value}`}
												checked={daySchedule.isWorkDay}
												onCheckedChange={(checked) =>
													handleDetailedDayChange(day.value, "isWorkDay", checked as boolean)
												}
											/>
											<Label
												htmlFor={`workday-${day.value}`}
												className="min-w-[100px] cursor-pointer font-medium"
											>
												{day.label}
											</Label>
											<Input
												type="number"
												step="0.5"
												min="0"
												max="24"
												value={daySchedule.hoursPerDay}
												onChange={(e) =>
													handleDetailedDayChange(day.value, "hoursPerDay", e.target.value)
												}
												disabled={!daySchedule.isWorkDay}
												className="w-24"
												placeholder="8"
											/>
											<span className="text-sm text-muted-foreground">hours</span>
										</div>
									);
								})}
							</div>
							<p className="text-sm text-muted-foreground">
								Check work days and specify hours per day (0-24)
							</p>
						</div>
					</TabsContent>
				</Tabs>

				{/* Work Classification */}
				<div className="space-y-2">
					<Label htmlFor="workClassification">Work Classification</Label>
					<Select value={workClassification} onValueChange={(v) => setWorkClassification(v as any)}>
						<SelectTrigger id="workClassification">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="daily">Daily</SelectItem>
							<SelectItem value="weekly">Weekly</SelectItem>
							<SelectItem value="monthly">Monthly</SelectItem>
						</SelectContent>
					</Select>
					<p className="text-sm text-muted-foreground">How the schedule is measured and tracked</p>
				</div>

				{/* Effective From Date */}
				<div className="space-y-2">
					<Label>Effective From</Label>
					<Popover>
						<PopoverTrigger asChild>
							<Button
								variant="outline"
								className={cn(
									"w-full justify-start text-left font-normal",
									!effectiveFrom && "text-muted-foreground",
								)}
							>
								<IconCalendar className="mr-2 h-4 w-4" />
								{effectiveFrom ? format(effectiveFrom, "PPP") : <span>Pick a date</span>}
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-auto p-0" align="start">
							<Calendar
								mode="single"
								selected={effectiveFrom}
								onSelect={(date) => setEffectiveFrom(date || new Date())}
								initialFocus
							/>
						</PopoverContent>
					</Popover>
					<p className="text-sm text-muted-foreground">When this schedule becomes active</p>
				</div>

				{/* Summary */}
				<div className="rounded-lg bg-muted p-4">
					<div className="flex items-center justify-between">
						<span className="font-medium">Total Weekly Hours:</span>
						<span className="text-2xl font-bold">{totalHours.toFixed(1)}</span>
					</div>
				</div>

				{/* Action Buttons */}
				<div className="flex justify-end gap-2 pt-4">
					{onCancel && (
						<Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
							<IconX className="mr-2 size-4" />
							Cancel
						</Button>
					)}
					<Button onClick={handleSave} disabled={loading}>
						{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						<IconCheck className="mr-2 size-4" />
						Save Schedule
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
