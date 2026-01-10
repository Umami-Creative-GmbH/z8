"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { CalendarIcon, Loader2, Trash2, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
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
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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

const shiftFormSchema = z.object({
	employeeId: z.string().nullable(),
	templateId: z.string().nullable(),
	date: z.date(),
	startTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
	endTime: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
	notes: z.string().optional(),
	color: z.string().optional(),
});

type ShiftFormValues = z.infer<typeof shiftFormSchema>;

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
			const result = await listEmployees();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open && isManager,
	});

	const employees = employeesResult || [];

	const form = useForm<ShiftFormValues>({
		resolver: zodResolver(shiftFormSchema),
		defaultValues: {
			employeeId: null,
			templateId: null,
			date: new Date(),
			startTime: "09:00",
			endTime: "17:00",
			notes: "",
			color: undefined,
		},
	});

	// Reset form when dialog opens/closes or shift changes
	useEffect(() => {
		if (open) {
			if (shift) {
				form.reset({
					employeeId: shift.employeeId,
					templateId: shift.templateId,
					date: new Date(shift.date),
					startTime: shift.startTime,
					endTime: shift.endTime,
					notes: shift.notes || "",
					color: shift.color || undefined,
				});
			} else {
				form.reset({
					employeeId: null,
					templateId: null,
					date: defaultDate || new Date(),
					startTime: "09:00",
					endTime: "17:00",
					notes: "",
					color: undefined,
				});
			}
		}
	}, [open, shift, defaultDate, form]);

	// Watch template selection to auto-fill times
	const selectedTemplateId = form.watch("templateId");
	useEffect(() => {
		if (selectedTemplateId) {
			const template = templates.find((t) => t.id === selectedTemplateId);
			if (template) {
				form.setValue("startTime", template.startTime);
				form.setValue("endTime", template.endTime);
				if (template.color) {
					form.setValue("color", template.color);
				}
			}
		}
	}, [selectedTemplateId, templates, form]);

	const upsertMutation = useMutation({
		mutationFn: async (values: ShiftFormValues) => {
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

	const onSubmit = (values: ShiftFormValues) => {
		upsertMutation.mutate(values);
	};

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

				<Form {...form}>
					<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
						{/* Date picker */}
						<FormField
							control={form.control}
							name="date"
							render={({ field }) => (
								<FormItem className="flex flex-col">
									<FormLabel>Date</FormLabel>
									<Popover>
										<PopoverTrigger asChild>
											<FormControl>
												<Button
													variant="outline"
													className={cn(
														"w-full pl-3 text-left font-normal",
														!field.value && "text-muted-foreground",
													)}
													disabled={!isManager}
												>
													{field.value ? format(field.value, "PPP") : <span>Pick a date</span>}
													<CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
												</Button>
											</FormControl>
										</PopoverTrigger>
										<PopoverContent className="w-auto p-0" align="start">
											<Calendar
												mode="single"
												selected={field.value}
												onSelect={field.onChange}
												initialFocus
											/>
										</PopoverContent>
									</Popover>
									<FormMessage />
								</FormItem>
							)}
						/>

						{/* Template selector (optional) */}
						{isManager && templates.length > 0 && (
							<FormField
								control={form.control}
								name="templateId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Template (Optional)</FormLabel>
										<Select
											onValueChange={(value) => field.onChange(value === "none" ? null : value)}
											value={field.value || "none"}
										>
											<FormControl>
												<SelectTrigger>
													<SelectValue placeholder="Select a template" />
												</SelectTrigger>
											</FormControl>
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
										<FormDescription>Selecting a template will auto-fill the times</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}

						{/* Time inputs */}
						<div className="grid grid-cols-2 gap-4">
							<FormField
								control={form.control}
								name="startTime"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Start Time</FormLabel>
										<FormControl>
											<Input type="time" {...field} disabled={!isManager} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="endTime"
								render={({ field }) => (
									<FormItem>
										<FormLabel>End Time</FormLabel>
										<FormControl>
											<Input type="time" {...field} disabled={!isManager} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{/* Employee assignment (managers only) */}
						{isManager && (
							<FormField
								control={form.control}
								name="employeeId"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											<span className="flex items-center gap-2">
												<Users className="h-4 w-4" />
												Assign To
											</span>
										</FormLabel>
										<Select
											onValueChange={(value) => field.onChange(value === "open" ? null : value)}
											value={field.value || "open"}
										>
											<FormControl>
												<SelectTrigger>
													<SelectValue placeholder="Select an employee" />
												</SelectTrigger>
											</FormControl>
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
										<FormDescription>
											Leave as "Open Shift" to allow employees to claim it
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}

						{/* Notes */}
						{isManager && (
							<FormField
								control={form.control}
								name="notes"
								render={({ field }) => (
									<FormItem>
										<FormLabel>Notes (Optional)</FormLabel>
										<FormControl>
											<Textarea
												placeholder="Any special instructions or notes..."
												className="resize-none"
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
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
				</Form>
			</DialogContent>
		</Dialog>
	);
}
