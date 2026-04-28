"use client";

import { useTranslate } from "@tolgee/react";
import { CalendarIcon, Loader2, MapPin, Trash2, Users } from "lucide-react";
import { DateTime } from "luxon";
import { type ComponentProps, useState } from "react";
import { z } from "zod";
import type { ShiftTemplate, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { SkillWarningAlert, SkillWarningBadge } from "@/components/scheduling/skill-warning-alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { DialogFooter } from "@/components/ui/dialog";
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
import { cn } from "@/lib/utils";
import type { ShiftDialogEmployee, ShiftDialogLocation } from "./use-shift-dialog-data";
import type { ShiftDialogFormApi, ShiftDialogFormValues } from "./use-shift-dialog-form";

interface ShiftDialogSectionsProps {
	form: ShiftDialogFormApi;
	formValues: ShiftDialogFormValues;
	isManager: boolean;
	templates: ShiftTemplate[];
	locations: ShiftDialogLocation[];
	employees: ShiftDialogEmployee[];
	skillValidation: ComponentProps<typeof SkillWarningAlert>["validation"];
	isValidatingSkills: boolean;
	isEditing: boolean;
	shift: ShiftWithRelations | null;
}

interface ShiftDialogFooterProps {
	isEditing: boolean;
	isManager: boolean;
	isPending: boolean;
	isSaving: boolean;
	isDeleting: boolean;
	isSaveDisabled?: boolean;
	onDelete: () => void;
	onCancel: () => void;
}

function getFieldErrorMessage(error: unknown) {
	if (typeof error === "string") {
		return error;
	}

	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}

	return null;
}

function FieldErrorText({ errors }: { errors: readonly unknown[] }) {
	const message = errors[0] ? getFieldErrorMessage(errors[0]) : null;

	if (!message) {
		return null;
	}

	return (
		<p className="text-sm font-medium text-destructive" aria-live="polite">
			{message}
		</p>
	);
}

export function ShiftDialogSections({
	form,
	formValues,
	isManager,
	templates,
	locations,
	employees,
	skillValidation,
	isValidatingSkills,
	isEditing,
	shift,
}: ShiftDialogSectionsProps) {
	const { t } = useTranslate();

	return (
		<>
			<form.Field
				name="date"
				validators={{
					onChange: z.date(),
				}}
			>
				{(field) => (
					<div className="flex flex-col space-y-2">
						<Label htmlFor="shift-dialog-date">{t("scheduling.shiftDialog.date", "Date")}</Label>
						<Popover>
							<PopoverTrigger asChild>
								<Button
									id="shift-dialog-date"
									variant="outline"
									className={cn(
										"w-full pl-3 text-left font-normal",
										!field.state.value && "text-muted-foreground",
									)}
									disabled={!isManager}
								>
									{field.state.value ? (
										DateTime.fromJSDate(field.state.value).toLocaleString(DateTime.DATE_MED)
									) : (
										<span>{t("scheduling.shiftDialog.pickDate", "Pick a date")}</span>
									)}
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
						<FieldErrorText errors={field.state.meta.errors} />
					</div>
				)}
			</form.Field>

			{isManager && templates.length > 0 && (
				<form.Field name="templateId">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor="shift-dialog-template">
								{t("scheduling.shiftDialog.templateOptional", "Template (Optional)")}
							</Label>
							<Select
								onValueChange={(value) => field.handleChange(value === "none" ? null : value)}
								value={field.state.value || "none"}
							>
								<SelectTrigger id="shift-dialog-template">
									<SelectValue
										placeholder={t("scheduling.shiftDialog.selectTemplate", "Select a template")}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">
										{t("scheduling.shiftDialog.noTemplate", "No template")}
									</SelectItem>
									{templates
										.filter((template) => template.isActive)
										.map((template) => (
											<SelectItem key={template.id} value={template.id}>
												{template.name} ({template.startTime} - {template.endTime})
											</SelectItem>
										))}
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								{t(
									"scheduling.shiftDialog.templateHint",
									"Selecting a template will auto-fill the times",
								)}
							</p>
						</div>
					)}
				</form.Field>
			)}

			<div className="grid grid-cols-2 gap-4">
				<form.Field
					name="startTime"
					validators={{
						onChange: z.string().regex(/^\d{2}:\d{2}$/, "Invalid time format"),
					}}
				>
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor="shift-dialog-start-time">
								{t("scheduling.shiftDialog.startTime", "Start Time")}
							</Label>
							<Input
								id="shift-dialog-start-time"
								name="startTime"
								autoComplete="off"
								type="time"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								disabled={!isManager}
							/>
							<FieldErrorText errors={field.state.meta.errors} />
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
							<Label htmlFor="shift-dialog-end-time">
								{t("scheduling.shiftDialog.endTime", "End Time")}
							</Label>
							<Input
								id="shift-dialog-end-time"
								name="endTime"
								autoComplete="off"
								type="time"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								disabled={!isManager}
							/>
							<FieldErrorText errors={field.state.meta.errors} />
						</div>
					)}
				</form.Field>
			</div>

			{isManager && (
				<form.Field name="subareaId">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor="shift-dialog-subarea">
								<span className="flex items-center gap-2">
									<MapPin className="h-4 w-4" aria-hidden="true" />
									{t("scheduling.shiftDialog.subarea", "Subarea")}
									<span className="text-destructive">*</span>
								</span>
							</Label>
							<Select onValueChange={field.handleChange} value={field.state.value}>
								<SelectTrigger id="shift-dialog-subarea">
									<SelectValue
										placeholder={t("scheduling.shiftDialog.selectSubarea", "Select a subarea…")}
									/>
								</SelectTrigger>
								<SelectContent>
									{locations.flatMap((location) =>
										location.subareas
											.filter((subarea) => subarea.isActive)
											.map((subarea) => (
												<SelectItem key={subarea.id} value={subarea.id}>
													{location.name} – {subarea.name}
												</SelectItem>
											)),
									)}
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								{t("scheduling.shiftDialog.subareaHint", "Where this shift will take place")}
							</p>
						</div>
					)}
				</form.Field>
			)}

			{isManager && (
				<form.Field name="employeeId">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor="shift-dialog-employee">
								<span className="flex items-center gap-2">
									<Users className="h-4 w-4" aria-hidden="true" />
									{t("scheduling.shiftDialog.assignTo", "Assign To")}
								</span>
							</Label>
							<Select
								onValueChange={(value) => field.handleChange(value === "open" ? null : value)}
								value={field.state.value || "open"}
							>
								<SelectTrigger id="shift-dialog-employee">
									<SelectValue
										placeholder={t("scheduling.shiftDialog.selectEmployee", "Select an employee")}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="open">
										<span className="flex items-center gap-2">
											<Badge variant="secondary">
												{t("scheduling.shiftDialog.openShift", "Open Shift")}
											</Badge>
											<span className="text-muted-foreground">
												{t("scheduling.shiftDialog.anyoneCanPickUp", "Anyone can pick up")}
											</span>
										</span>
									</SelectItem>
									{employees.map((employee) => (
										<SelectItem key={employee.id} value={employee.id}>
											<span className="flex items-center gap-2">
												{employee.firstName} {employee.lastName}
												{field.state.value === employee.id &&
													skillValidation &&
													!skillValidation.isQualified && (
														<SkillWarningBadge validation={skillValidation} />
													)}
											</span>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								{t(
									"scheduling.shiftDialog.openShiftHint",
									'Leave as "Open Shift" to allow employees to claim it',
								)}
							</p>
						</div>
					)}
				</form.Field>
			)}

			{isManager && formValues.employeeId && formValues.subareaId && (
				<SkillWarningAlert validation={skillValidation} isLoading={isValidatingSkills} />
			)}

			{isManager && (
				<form.Field name="notes">
					{(field) => (
						<div className="space-y-2">
							<Label htmlFor="shift-dialog-notes">
								{t("scheduling.shiftDialog.notesOptional", "Notes (Optional)")}
							</Label>
							<Textarea
								id="shift-dialog-notes"
								name="notes"
								autoComplete="off"
								placeholder={t(
									"scheduling.shiftDialog.notesPlaceholder",
									"Any special instructions or notes…",
								)}
								className="resize-none"
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
							/>
						</div>
					)}
				</form.Field>
			)}

			{isEditing && shift && (
				<div className="flex items-center gap-2 text-sm">
					<span className="text-muted-foreground">{t("common.status", "Status")}:</span>
					<Badge variant={shift.status === "published" ? "default" : "secondary"}>
						{shift.status === "published"
							? t("scheduling.shiftDialog.published", "Published")
							: t("scheduling.shiftDialog.draft", "Draft")}
					</Badge>
				</div>
			)}
		</>
	);
}

export function ShiftDialogFooterActions({
	isEditing,
	isManager,
	isPending,
	isSaving,
	isDeleting,
	isSaveDisabled,
	onDelete,
	onCancel,
}: ShiftDialogFooterProps) {
	const { t } = useTranslate();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	return (
		<DialogFooter className="gap-2 sm:gap-0">
			{isEditing && isManager && (
				<Button
					type="button"
					variant="destructive"
					onClick={() => {
						if (showDeleteConfirm) {
							onDelete();
							return;
						}

						setShowDeleteConfirm(true);
					}}
					disabled={isPending}
				>
					{isDeleting ? (
						<Loader2 className="h-4 w-4 animate-spin" />
					) : (
						<>
							<Trash2 className="h-4 w-4 mr-2" />
							{showDeleteConfirm
								? t("scheduling.shiftDialog.confirmDelete", "Confirm Delete")
								: t("common.delete", "Delete")}
						</>
					)}
				</Button>
			)}
			<Button
				type="button"
				variant="outline"
				onClick={() => {
					setShowDeleteConfirm(false);
					onCancel();
				}}
				disabled={isPending}
			>
				{t("common.cancel", "Cancel")}
			</Button>
			{isManager && (
				<Button type="submit" disabled={isPending || isSaveDisabled}>
					{isSaving ? (
						<>
							<Loader2 className="h-4 w-4 mr-2 animate-spin" />
							{t("common.saving", "Saving…")}
						</>
					) : isEditing ? (
						t("scheduling.shiftDialog.updateShift", "Update Shift")
					) : (
						t("scheduling.shiftDialog.createShift", "Create Shift")
					)}
				</Button>
			)}
		</DialogFooter>
	);
}
