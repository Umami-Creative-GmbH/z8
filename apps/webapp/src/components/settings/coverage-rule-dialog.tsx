"use client";

import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { toast } from "sonner";
import {
	createCoverageRule,
	updateCoverageRule,
} from "@/app/[locale]/(app)/settings/coverage-rules/actions";
import { getLocationsWithSubareas } from "@/app/[locale]/(app)/scheduling/actions";
import { Button } from "@/components/ui/button";
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
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type { CoverageRuleWithRelations } from "@/lib/effect/services/coverage.service";
import type { DayOfWeek } from "@/lib/validations/coverage";

interface CoverageRuleDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	editingRule: CoverageRuleWithRelations | null;
	onSuccess: () => void;
}

const DAYS_OF_WEEK: { value: DayOfWeek; label: string }[] = [
	{ value: "monday", label: "Monday" },
	{ value: "tuesday", label: "Tuesday" },
	{ value: "wednesday", label: "Wednesday" },
	{ value: "thursday", label: "Thursday" },
	{ value: "friday", label: "Friday" },
	{ value: "saturday", label: "Saturday" },
	{ value: "sunday", label: "Sunday" },
];

export function CoverageRuleDialog({
	open,
	onOpenChange,
	organizationId,
	editingRule,
	onSuccess,
}: CoverageRuleDialogProps) {
	const { t } = useTranslate();
	const isEditing = !!editingRule;

	// Fetch locations with subareas
	const { data: locationsResult } = useQuery({
		queryKey: ["locations", organizationId],
		queryFn: async () => {
			const result = await getLocationsWithSubareas();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: open,
	});

	const locations = locationsResult || [];

	// Build flat list of subareas with location names
	const subareaOptions = locations.flatMap((loc) =>
		loc.subareas.map((sub) => ({
			id: sub.id,
			name: sub.name,
			locationName: loc.name,
			locationId: loc.id,
		})),
	);

	// Form
	const form = useForm({
		defaultValues: {
			subareaId: editingRule?.subareaId || "",
			dayOfWeek: (editingRule?.dayOfWeek || "monday") as DayOfWeek,
			startTime: editingRule?.startTime || "09:00",
			endTime: editingRule?.endTime || "17:00",
			minimumStaffCount: editingRule?.minimumStaffCount || 1,
		},
		onSubmit: async ({ value }) => {
			if (isEditing) {
				await updateMutation.mutateAsync({ ruleId: editingRule.id, data: value });
			} else {
				await createMutation.mutateAsync(value);
			}
		},
	});

	// Reset form when dialog opens/closes or editing rule changes
	useEffect(() => {
		if (open) {
			form.reset({
				subareaId: editingRule?.subareaId || "",
				dayOfWeek: (editingRule?.dayOfWeek || "monday") as DayOfWeek,
				startTime: editingRule?.startTime || "09:00",
				endTime: editingRule?.endTime || "17:00",
				minimumStaffCount: editingRule?.minimumStaffCount || 1,
			});
		}
	}, [open, editingRule, form]);

	// Create mutation
	const createMutation = useMutation({
		mutationFn: async (data: {
			subareaId: string;
			dayOfWeek: DayOfWeek;
			startTime: string;
			endTime: string;
			minimumStaffCount: number;
			priority?: number;
		}) => {
			const result = await createCoverageRule(data);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("settings.coverageRules.ruleCreated", "Coverage rule created"));
			onSuccess();
		},
		onError: (error) => {
			toast.error(error.message || t("settings.coverageRules.createFailed", "Failed to create rule"));
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: async ({
			ruleId,
			data,
		}: {
			ruleId: string;
			data: {
				subareaId: string;
				dayOfWeek: DayOfWeek;
				startTime: string;
				endTime: string;
				minimumStaffCount: number;
				priority?: number;
			};
		}) => {
			const result = await updateCoverageRule(ruleId, data);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("settings.coverageRules.ruleUpdated", "Coverage rule updated"));
			onSuccess();
		},
		onError: (error) => {
			toast.error(error.message || t("settings.coverageRules.updateFailed", "Failed to update rule"));
		},
	});

	const isSubmitting = createMutation.isPending || updateMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>
						{isEditing
							? t("settings.coverageRules.editRule", "Edit Coverage Rule")
							: t("settings.coverageRules.createRule", "Create Coverage Rule")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.coverageRules.ruleDialogDescription",
							"Define the minimum staffing requirement for a specific location, day, and time block.",
						)}
					</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
				>
					<div className="grid gap-4 py-4">
						{/* Subarea Select */}
						<form.Field name="subareaId">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="subareaId">
										{t("settings.coverageRules.subarea", "Location / Subarea")}
									</Label>
									<Select value={field.state.value} onValueChange={field.handleChange}>
										<SelectTrigger id="subareaId">
											<SelectValue
												placeholder={t("settings.coverageRules.selectSubarea", "Select a subarea")}
											/>
										</SelectTrigger>
										<SelectContent>
											{subareaOptions.map((opt) => (
												<SelectItem key={opt.id} value={opt.id}>
													{opt.locationName} - {opt.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{/* Day of Week Select */}
						<form.Field name="dayOfWeek">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="dayOfWeek">
										{t("settings.coverageRules.dayOfWeek", "Day of Week")}
									</Label>
									<Select
										value={field.state.value}
										onValueChange={(v) => field.handleChange(v as DayOfWeek)}
									>
										<SelectTrigger id="dayOfWeek">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{DAYS_OF_WEEK.map((day) => (
												<SelectItem key={day.value} value={day.value}>
													{day.label}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{/* Time Range */}
						<div className="grid grid-cols-2 gap-4">
							<form.Field name="startTime">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="startTime">
											{t("settings.coverageRules.startTime", "Start Time")}
										</Label>
										<Input
											id="startTime"
											type="time"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="endTime">
								{(field) => (
									<div className="grid gap-2">
										<Label htmlFor="endTime">
											{t("settings.coverageRules.endTime", "End Time")}
										</Label>
										<Input
											id="endTime"
											type="time"
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
									</div>
								)}
							</form.Field>
						</div>

						{/* Minimum Staff Count */}
						<form.Field name="minimumStaffCount">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor="minimumStaffCount">
										{t("settings.coverageRules.minimumStaffCount", "Minimum Staff Count")}
									</Label>
									<Input
										id="minimumStaffCount"
										type="number"
										min={1}
										max={100}
										value={field.state.value}
										onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 1)}
									/>
									<p className="text-muted-foreground text-sm">
										{t(
											"settings.coverageRules.minimumStaffHint",
											"The minimum number of staff required during this time block.",
										)}
									</p>
								</div>
							)}
						</form.Field>
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting
								? t("common.saving", "Saving...")
								: isEditing
									? t("common.save", "Save")
									: t("common.create", "Create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
