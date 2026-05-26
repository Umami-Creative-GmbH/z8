"use client";

import { IconCalendar, IconLoader2, IconMapPin, IconTrash, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { type ComponentProps, useState } from "react";
import { z } from "zod";
import type { ShiftTemplate, ShiftWithRelations } from "@/app/[locale]/(app)/scheduling/types";
import { SkillWarningAlert, SkillWarningBadge } from "@/components/scheduling/skill-warning-alert";
import { ActionPanelFooter } from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { TimeInput } from "@/components/ui/time-input";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
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

	return <p className="text-sm font-medium text-destructive">{message}</p>;
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
						<Label>{t("scheduling:scheduling.shiftDialog.date", "Date")}</Label>
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
									{field.state.value ? (
										DateTime.fromJSDate(field.state.value).toLocaleString(DateTime.DATE_MED)
									) : (
										<span>{t("scheduling:scheduling.shiftDialog.pickDate", "Pick a date")}</span>
									)}
									<IconCalendar className="ml-auto size-4 opacity-50" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0" align="start">
								<Calendar
									mode="single"
									selected={field.state.value}
									onSelect={(date) => date && field.handleChange(date)}
									autoFocus
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
							<Label>{t("scheduling:scheduling.shiftDialog.template", "Template (Optional)")}</Label>
							<Select
								onValueChange={(value) => field.handleChange(value === "none" ? null : value)}
								value={field.state.value || "none"}
							>
								<SelectTrigger>
									<SelectValue
										placeholder={t("scheduling:scheduling.shiftDialog.selectTemplate", "Select a template")}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">
										{t("scheduling:scheduling.shiftDialog.noTemplate", "No template")}
									</SelectItem>
									{templates.flatMap((template) =>
										template.isActive ? [
											<SelectItem key={template.id} value={template.id}>
												{template.name} ({template.startTime} - {template.endTime})
											</SelectItem>
										] : [],
									)}
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								{t(
									"scheduling:scheduling.shiftDialog.templateHelp",
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
							<Label>{t("scheduling:scheduling.shiftDialog.startTime", "Start Time")}</Label>
							<TimeInput
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
							<Label>{t("scheduling:scheduling.shiftDialog.endTime", "End Time")}</Label>
							<TimeInput
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
							<Label>
								<span className="flex items-center gap-2">
									<IconMapPin className="size-4" aria-hidden="true" />
									{t("scheduling:scheduling.shiftDialog.subarea", "Subarea")}
									<span className="text-destructive">*</span>
								</span>
							</Label>
							<Select onValueChange={field.handleChange} value={field.state.value}>
								<SelectTrigger>
									<SelectValue
										placeholder={t("scheduling:scheduling.shiftDialog.selectSubarea", "Select a subarea…")}
									/>
								</SelectTrigger>
								<SelectContent>
									{locations.flatMap((location) =>
										location.subareas.flatMap((subarea) =>
											subarea.isActive ? [
												<SelectItem key={subarea.id} value={subarea.id}>
													{location.name} – {subarea.name}
												</SelectItem>
											] : [],
										),
									)}
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								{t(
									"scheduling:scheduling.shiftDialog.subareaHelp",
									"Where this shift will take place",
								)}
							</p>
						</div>
					)}
				</form.Field>
			)}

			{isManager && (
				<form.Field name="employeeId">
					{(field) => (
						<div className="space-y-2">
							<Label>
								<span className="flex items-center gap-2">
									<IconUsers className="size-4" aria-hidden="true" />
									{t("scheduling:scheduling.shiftDialog.assignTo", "Assign To")}
								</span>
							</Label>
							<Select
								onValueChange={(value) => field.handleChange(value === "open" ? null : value)}
								value={field.state.value || "open"}
							>
								<SelectTrigger>
									<SelectValue
										placeholder={t("scheduling:scheduling.shiftDialog.selectEmployee", "Select an employee")}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="open">
										<span className="flex items-center gap-2">
											<Badge variant="secondary">
												{t("scheduling:scheduling.shiftDialog.openShift", "Open Shift")}
											</Badge>
											<span className="text-muted-foreground">
												{t("scheduling:scheduling.shiftDialog.anyoneCanPickUp", "Anyone can pick up")}
											</span>
										</span>
									</SelectItem>
									{employees.map((employee) => (
										<SelectItem key={employee.id} value={employee.id}>
											<span className="flex items-center gap-2">
												{buildAuthUserDisplayName(employee.user) || employee.id}
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
									"scheduling:scheduling.shiftDialog.openShiftHelp",
									"Leave as \"Open Shift\" to allow employees to claim it",
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
							<Label>{t("scheduling:scheduling.shiftDialog.notes", "Notes (Optional)")}</Label>
							<Textarea
								placeholder={t(
									"scheduling:scheduling.shiftDialog.notesPlaceholder",
									"Any special instructions or notes...",
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
					<span className="text-muted-foreground">
						{t("scheduling:scheduling.shiftDialog.status", "Status:")}
					</span>
					<Badge variant={shift.status === "published" ? "default" : "secondary"}>
						{shift.status === "published"
							? t("scheduling:scheduling.shiftDialog.published", "Published")
							: t("scheduling:scheduling.shiftDialog.draft", "Draft")}
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
	onDelete,
	onCancel,
}: ShiftDialogFooterProps) {
	const { t } = useTranslate();
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

	return (
		<ActionPanelFooter className="gap-2 sm:gap-0">
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
						<IconLoader2 className="size-4 animate-spin" />
					) : (
						<>
							<IconTrash className="size-4 mr-2" />
							{showDeleteConfirm
								? t("scheduling:scheduling.shiftDialog.confirmDelete", "Confirm Delete")
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
				<Button type="submit" disabled={isPending}>
					{isSaving ? (
						<>
							<IconLoader2 className="size-4 mr-2 animate-spin" />
							{t("common.saving", "Saving...")}
						</>
					) : isEditing ? (
						t("scheduling:scheduling.shiftDialog.updateShift", "Update Shift")
					) : (
						t("scheduling:scheduling.shiftDialog.createShift", "Create Shift")
					)}
				</Button>
			)}
		</ActionPanelFooter>
	);
}
