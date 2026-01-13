"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, Loader2, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { deleteShift, upsertShift } from "@/app/[locale]/(app)/scheduling/actions";
import type { ShiftTemplate, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { listEmployees } from "@/app/[locale]/(app)/settings/employees/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query/keys";
import { cn } from "@/lib/utils";

interface ShiftDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	shift: ShiftWithRelations | null;
	templates: ShiftTemplate[];
	isManager: boolean;
	defaultDate: Date | null;
	organizationId: string;
}

export function ShiftDialog({
	open,
	onOpenChange,
	shift,
	templates,
	isManager,
	defaultDate,
	organizationId,
}: ShiftDialogProps) {
	const queryClient = useQueryClient();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	const isEditing = !!shift;
	const title = isEditing ? "Edit Shift" : "Create Shift";
	const description = isEditing
		? "Update the shift details below"
		: "Fill in the details for the new shift";

	// Fetch employees for assignment
	const { data: employeesResult } = useQuery({
		queryKey: queryKeys.employees.list(organizationId),
		queryFn: async () => {
			const result = await listEmployees({ limit: 1000 });
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open && isManager,
	});

	const employees = employeesResult?.employees || [];

	const form = useForm({
		defaultValues: {
			employeeId: null as string | null,
			templateId: null as string | null,
			date: new Date(),
			startTime: "09:00",
			endTime: "17:00",
			notes: "",
			color: undefined as string | undefined,
		},
		onSubmit: async ({ value }) => {
			upsertMutation.mutate(value);
		},
	});

	// Reset form when dialog opens/closes or shift changes
	useEffect(() => {
		if (open) {
			if (shift) {
				form.setFieldValue("employeeId", shift.employeeId);
				form.setFieldValue("templateId", shift.templateId);
				form.setFieldValue("date", new Date(shift.date));
				form.setFieldValue("startTime", shift.startTime);
				form.setFieldValue("endTime", shift.endTime);
				form.setFieldValue("notes", shift.notes || "");
				form.setFieldValue("color", shift.color || undefined);
			} else {
				form.setFieldValue("employeeId", null);
				form.setFieldValue("templateId", null);
				form.setFieldValue("date", defaultDate || new Date());
				form.setFieldValue("startTime", "09:00");
				form.setFieldValue("endTime", "17:00");
				form.setFieldValue("notes", "");
				form.setFieldValue("color", undefined);
			}
		}
	}, [open, shift, defaultDate, form]);

	// Watch template selection to auto-fill times
	const formValues = useStore(form.store, (state) => state.values);
	const selectedTemplateId = formValues.templateId;
	useEffect(() => {
		if (selectedTemplateId) {
			const template = templates.find((t) => t.id === selectedTemplateId);
			if (template) {
				form.setFieldValue("startTime", template.startTime);
				form.setFieldValue("endTime", template.endTime);
				if (template.color) {
					form.setFieldValue("color", template.color);
				}
			}
		}
	}, [selectedTemplateId, templates, form]);

	const upsertMutation = useMutation({
		mutationFn: async (values: {
			employeeId: string | null;
			templateId: string | null;
			date: Date;
			startTime: string;
			endTime: string;
			notes: string;
			color: string | undefined;
		}) => {
			const result = await upsertShift({
				id: shift?.id,
				employeeId: values.employeeId,
				templateId: values.templateId,
				date: values.date,
				startTime: values.startTime,
				endTime: values.endTime,
				notes: values.notes,
				color: values.color,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (result) => {
			if (result.metadata.hasOverlap) {
				toast.warning("Shift saved with overlap warning", {
					description: `This shift overlaps with ${result.metadata.overlappingShifts.length} other shift(s)`,
				});
			} else {
				toast.success(isEditing ? "Shift updated" : "Shift created");
			}
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error("Failed to save shift", { description: error.message });
		},
	});

	const deleteMutation = useMutation({
		mutationFn: async () => {
			if (!shift) throw new Error("No shift to delete");
			const result = await deleteShift(shift.id);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success("Shift deleted");
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error("Failed to delete shift", { description: error.message });
		},
	});

	const handleDelete = () => {
		if (showDeleteConfirm) {
			deleteMutation.mutate();
		} else {
			setShowDeleteConfirm(true);
		}
	};

	const isPending = upsertMutation.isPending || deleteMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					{/* Date picker */}
					<form.Field
						name="date"
						validators={{
							onChange: z.date(),
						}}
					>
						{(field) => (
							<div className="flex flex-col space-y-2">
								<Label>Date</Label>
								<Popover>
									<PopoverTrigger asChild>
										<Button
											variant="outline"
											className={cn(
												"w-full pl-3 text-left font-normal",
												!field.state.value && "text-muted-foreground",
											)}
											disabled={!isManager}
										>
											{field.state.value ? format(field.state.value, "PPP") : <span>Pick a date</span>}
											<CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
										</Button>
									</PopoverTrigger>
									<PopoverContent className="w-auto p-0" align="start">
										<Calendar
											mode="single"
											selected={field.state.value}
											onSelect={(date) => date && field.handleChange(date)}
											initialFocus
										/>
									</PopoverContent>
								</Popover>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm font-medium text-destructive">
										{typeof field.state.meta.errors[0] === "string"
											? field.state.meta.errors[0]
											: (field.state.meta.errors[0] as any)?.message}
									</p>
								)}
							</div>
						)}
					</form.Field>

					{/* Template selector (optional) */}
					{isManager && templates.length > 0 && (
						<form.Field name="templateId">
							{(field) => (
								<div className="space-y-2">
									<Label>Template (Optional)</Label>
									<Select
										onValueChange={(value) => field.handleChange(value === "none" ? null : value)}
										value={field.state.value || "none"}
									>
										<SelectTrigger>
											<SelectValue placeholder="Select a template" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="none">No template</SelectItem>
											{templates
												.filter((t) => t.isActive)
												.map((template) => (
													<SelectItem key={template.id} value={template.id}>
														{template.name} ({template.startTime} - {template.endTime})
													</SelectItem>
												))}
										</SelectContent>
									</Select>
									<p className="text-sm text-muted-foreground">Selecting a template will auto-fill the times</p>
								</div>
							)}
						</form.Field>
					)}

					{/* Time inputs */}
					<div className="grid grid-cols-2 gap-4">
						<form.Field
							name="startTime"
							validators={{
								onChange: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label>Start Time</Label>
									<Input
										type="time"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										disabled={!isManager}
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm font-medium text-destructive">
											{typeof field.state.meta.errors[0] === "string"
											? field.state.meta.errors[0]
											: (field.state.meta.errors[0] as any)?.message}
										</p>
									)}
								</div>
							)}
						</form.Field>

						<form.Field
							name="endTime"
							validators={{
								onChange: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
							}}
						>
							{(field) => (
								<div className="space-y-2">
									<Label>End Time</Label>
									<Input
										type="time"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
										disabled={!isManager}
									/>
									{field.state.meta.errors.length > 0 && (
										<p className="text-sm font-medium text-destructive">
											{typeof field.state.meta.errors[0] === "string"
											? field.state.meta.errors[0]
											: (field.state.meta.errors[0] as any)?.message}
										</p>
									)}
								</div>
							)}
						</form.Field>
					</div>

					{/* Employee assignment (managers only) */}
					{isManager && (
						<form.Field name="employeeId">
							{(field) => (
								<div className="space-y-2">
									<Label>
										<span className="flex items-center gap-2">
											<Users className="h-4 w-4" />
											Assign To
										</span>
									</Label>
									<Select
										onValueChange={(value) => field.handleChange(value === "open" ? null : value)}
										value={field.state.value || "open"}
									>
										<SelectTrigger>
											<SelectValue placeholder="Select an employee" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="open">
												<span className="flex items-center gap-2">
													<Badge variant="secondary">Open Shift</Badge>
													<span className="text-muted-foreground">Anyone can pick up</span>
												</span>
											</SelectItem>
											{employees.map((emp) => (
												<SelectItem key={emp.id} value={emp.id}>
													{emp.firstName} {emp.lastName}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<p className="text-sm text-muted-foreground">
										Leave as "Open Shift" to allow employees to claim it
									</p>
								</div>
							)}
						</form.Field>
					)}

					{/* Notes */}
					{isManager && (
						<form.Field name="notes">
							{(field) => (
								<div className="space-y-2">
									<Label>Notes (Optional)</Label>
									<Textarea
										placeholder="Any special instructions or notes..."
										className="resize-none"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										onBlur={field.handleBlur}
									/>
								</div>
							)}
						</form.Field>
					)}

					{/* Shift status badge */}
					{isEditing && shift && (
						<div className="flex items-center gap-2 text-sm">
							<span className="text-muted-foreground">Status:</span>
							<Badge variant={shift.status === "published" ? "default" : "secondary"}>
								{shift.status === "published" ? "Published" : "Draft"}
							</Badge>
						</div>
					)}

					<DialogFooter className="gap-2 sm:gap-0">
						{isEditing && isManager && (
							<Button
								type="button"
								variant="destructive"
								onClick={handleDelete}
								disabled={isPending}
							>
								{deleteMutation.isPending ? (
									<Loader2 className="h-4 w-4 animate-spin" />
								) : (
									<>
										<Trash2 className="h-4 w-4 mr-2" />
										{showDeleteConfirm ? "Confirm Delete" : "Delete"}
									</>
								)}
							</Button>
						)}
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={isPending}
						>
							Cancel
						</Button>
						{isManager && (
							<Button type="submit" disabled={isPending}>
								{upsertMutation.isPending ? (
									<>
										<Loader2 className="h-4 w-4 mr-2 animate-spin" />
										Saving...
									</>
								) : isEditing ? (
									"Update Shift"
								) : (
									"Create Shift"
								)}
							</Button>
						)}
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
