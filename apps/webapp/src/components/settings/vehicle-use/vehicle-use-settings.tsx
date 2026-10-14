"use client";

import { IconCar, IconTrash } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	removeVehicleUseAssignmentAction,
	saveVehicleUseSettingsAction,
	setVehicleUseAssignmentAction,
	type VehicleUseAdminData,
	type VehicleUseAssignmentData,
} from "@/app/[locale]/(app)/settings/vehicle-use/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import type { VehicleUseErrorCode } from "@/lib/time-tracking/vehicle-use/errors";
import type { VehicleUseMode } from "@/lib/time-tracking/vehicle-use/policy";
import type { VehicleUseAssignmentTarget } from "@/lib/time-tracking/vehicle-use/store";

interface VehicleUseSettingsProps {
	data: VehicleUseAdminData;
}

type Translate = ReturnType<typeof useTranslate>["t"];
type AssignmentTargetType = VehicleUseAssignmentTarget["type"];

/** Owner/admin vehicle use enablement (#1119): organization switch and asked/expected assignments. */
export function VehicleUseSettings({ data }: VehicleUseSettingsProps) {
	return (
		<div className="space-y-6">
			<VehicleUseSwitch
				key={String(data.settings.enabled)}
				initialEnabled={data.settings.enabled}
			/>
			<VehicleUseAssignments data={data} />
		</div>
	);
}

function vehicleUseErrorMessage(t: Translate, code: VehicleUseErrorCode): string {
	switch (code) {
		case "admin_only":
			return t(
				"settings.vehicleUse.error.adminOnly",
				"Only organization owners and admins can manage vehicle use.",
			);
		case "team_not_found":
			return t("settings.vehicleUse.error.teamNotFound", "That team no longer exists.");
		case "employee_not_found":
			return t("settings.vehicleUse.error.employeeNotFound", "That employee no longer exists.");
		case "assignment_not_found":
			return t(
				"settings.vehicleUse.error.assignmentNotFound",
				"That assignment no longer exists. Reload the page.",
			);
		case "invalid_target":
		case "invalid_selection":
			return t("settings.vehicleUse.error.invalidTarget", "Choose who the assignment applies to.");
		case "invalid_mode":
			return t("settings.vehicleUse.error.invalidMode", "Choose a mode for the assignment.");
		case "failed":
			return t("settings.vehicleUse.error.failed", "Something went wrong. Try again.");
	}
}

function VehicleUseSwitch({ initialEnabled }: { initialEnabled: boolean }) {
	const { t } = useTranslate();
	const router = useRouter();
	const [enabled, setEnabled] = useState(initialEnabled);
	const [saving, setSaving] = useState(false);

	const toggle = async (next: boolean) => {
		setSaving(true);
		setEnabled(next);
		await (async () => {
			const result = await saveVehicleUseSettingsAction({ enabled: next });
			if (!result.success) {
				setEnabled(!next);
				toast.error(vehicleUseErrorMessage(t, result.code));
				return;
			}
			toast.success(
				next
					? t("settings.vehicleUse.switchedOn", "Vehicle use is switched on")
					: t("settings.vehicleUse.switchedOff", "Vehicle use is switched off"),
			);
			router.refresh();
		})().finally(() => {
			setSaving(false);
		});
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCar className="size-5" aria-hidden="true" />
					{t("settings.vehicleUse.switchTitle", "Vehicle use")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.vehicleUse.switchDescription",
						"Let employees record the vehicle they drove, its odometer readings and the distance on their work. Switching it on applies to nobody until you assign it below.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="flex items-center justify-between gap-4 rounded-lg border p-4">
					<div className="min-w-0 space-y-1">
						<div className="font-medium">
							{t("settings.vehicleUse.enabled", "Record vehicle use")}
						</div>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.vehicleUse.enabledDescription",
								"Switching this off stops asking for vehicle use and stops flagging missing driving details. Vehicle use already recorded stays visible and in exports.",
							)}
						</p>
					</div>
					<Switch
						checked={enabled}
						onCheckedChange={(next) => void toggle(next)}
						disabled={saving}
						aria-label={t("settings.vehicleUse.enabled", "Record vehicle use")}
					/>
				</div>
			</CardContent>
		</Card>
	);
}

function modeOptions(t: Translate): { value: VehicleUseMode; label: string }[] {
	return [
		{ value: "asked", label: t("settings.vehicleUse.modeAsked", "Asked") },
		{
			value: "expected",
			label: t("settings.vehicleUse.modeExpected", "Vehicle use expected"),
		},
		{ value: "off", label: t("settings.vehicleUse.modeOff", "Off (excluded)") },
	];
}

function ModeItems({ options }: { options: { value: VehicleUseMode; label: string }[] }) {
	return options.map((option) => (
		<SelectItem key={option.value} value={option.value}>
			{option.label}
		</SelectItem>
	));
}

function targetOf(assignment: VehicleUseAssignmentData): VehicleUseAssignmentTarget {
	if (assignment.assignmentType === "team" && assignment.teamId) {
		return { type: "team", teamId: assignment.teamId };
	}
	if (assignment.assignmentType === "employee" && assignment.employeeId) {
		return { type: "employee", employeeId: assignment.employeeId };
	}
	return { type: "organization" };
}

function VehicleUseAssignments({ data }: VehicleUseSettingsProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, setPending] = useState(false);
	const modes = modeOptions(t);
	const teamNames = new Map(data.teams.map((team) => [team.id, team.name]));
	const employeeNames = new Map(data.employees.map((employee) => [employee.id, employee.name]));

	const runAssignmentChange = async (
		change: () => ReturnType<typeof setVehicleUseAssignmentAction>,
		successMessage: string,
		onSuccess?: () => void,
	) => {
		setPending(true);
		await (async () => {
			const result = await change();
			if (result.success) {
				toast.success(successMessage);
				onSuccess?.();
				router.refresh();
			} else {
				toast.error(vehicleUseErrorMessage(t, result.code));
			}
		})().finally(() => {
			setPending(false);
		});
	};

	const form = useForm({
		defaultValues: {
			targetType: "team" as AssignmentTargetType,
			teamId: "",
			employeeId: "",
			mode: "asked" as VehicleUseMode,
		},
		onSubmit: async ({ value, formApi }) => {
			const target: VehicleUseAssignmentTarget =
				value.targetType === "organization"
					? { type: "organization" }
					: value.targetType === "team"
						? { type: "team", teamId: value.teamId }
						: { type: "employee", employeeId: value.employeeId };
			await runAssignmentChange(
				() => setVehicleUseAssignmentAction({ target, mode: value.mode }),
				t("settings.vehicleUse.assignmentSaved", "Assignment saved"),
				() => formApi.reset(),
			);
		},
	});
	const targetType = useStore(form.store, (state) => state.values.targetType);
	const teamId = useStore(form.store, (state) => state.values.teamId);
	const employeeId = useStore(form.store, (state) => state.values.employeeId);
	const canAdd =
		!pending &&
		(targetType === "organization" ||
			(targetType === "team" && teamId !== "") ||
			(targetType === "employee" && employeeId !== ""));

	const targetLabel = (assignment: VehicleUseAssignmentData) =>
		assignment.assignmentType === "organization"
			? t("settings.vehicleUse.targetOrganization", "Whole organization")
			: assignment.assignmentType === "team"
				? t("settings.vehicleUse.targetTeamLabel", "Team: {name}", {
						name: teamNames.get(assignment.teamId ?? "") ?? assignment.teamId ?? "",
					})
				: t("settings.vehicleUse.targetEmployeeLabel", "Employee: {name}", {
						name: employeeNames.get(assignment.employeeId ?? "") ?? assignment.employeeId ?? "",
					});

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.vehicleUse.assignmentsTitle", "Who is asked")}</CardTitle>
				<CardDescription>
					{t(
						"settings.vehicleUse.assignmentsDescription",
						"Asked employees may record vehicle use when they clock. Employees with vehicle use expected are asked every time, and their work is flagged until the details are complete. Nobody is ever stopped from clocking. The most specific assignment wins: an employee's own over their primary team's, and a team's over the whole organization's.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-5">
				{data.assignments.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.vehicleUse.noAssignments",
							"Nobody is assigned. Vehicle use applies to nobody until you assign it.",
						)}
					</p>
				) : (
					<ul
						className="divide-y rounded-md border"
						aria-label={t("settings.vehicleUse.assignmentsList", "Vehicle use assignments")}
					>
						{data.assignments.map((assignment) => {
							const label = targetLabel(assignment);
							return (
								<li
									key={assignment.id}
									className="flex flex-wrap items-center justify-between gap-3 p-3"
								>
									<span className="min-w-0 truncate text-sm font-medium">{label}</span>
									<div className="flex items-center gap-2">
										<Select
											value={assignment.mode}
											items={modes}
											onValueChange={(value: VehicleUseMode | null) => {
												if (!value || value === assignment.mode) return;
												void runAssignmentChange(
													() =>
														setVehicleUseAssignmentAction({
															target: targetOf(assignment),
															mode: value,
														}),
													t("settings.vehicleUse.assignmentSaved", "Assignment saved"),
												);
											}}
											disabled={pending}
										>
											<SelectTrigger
												className="h-9 w-52"
												aria-label={t("settings.vehicleUse.modeFor", "Mode for {target}", {
													target: label,
												})}
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<ModeItems options={modes} />
											</SelectContent>
										</Select>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onClick={() =>
												void runAssignmentChange(
													() =>
														removeVehicleUseAssignmentAction({
															assignmentId: assignment.id,
														}),
													t("settings.vehicleUse.assignmentRemoved", "Assignment removed"),
												)
											}
											disabled={pending}
											aria-label={t("settings.vehicleUse.removeAssignment", "Remove {target}", {
												target: label,
											})}
										>
											<IconTrash className="size-4" aria-hidden="true" />
										</Button>
									</div>
								</li>
							);
						})}
					</ul>
				)}

				{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
				<form
					className="grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field name="targetType">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("settings.vehicleUse.targetType", "Applies to")}</TFormLabel>
								<Select
									name="targetType"
									value={field.state.value}
									onValueChange={(value: AssignmentTargetType) => field.handleChange(value)}
									disabled={pending}
								>
									<TFormControl>
										<SelectTrigger className="h-10 w-full" onBlur={field.handleBlur}>
											<SelectValue />
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										<SelectItem value="team">
											{t("settings.vehicleUse.targetTeam", "A team")}
										</SelectItem>
										<SelectItem value="employee">
											{t("settings.vehicleUse.targetEmployee", "An employee")}
										</SelectItem>
										<SelectItem value="organization">
											{t("settings.vehicleUse.targetOrganization", "Whole organization")}
										</SelectItem>
									</SelectContent>
								</Select>
							</TFormItem>
						)}
					</form.Field>

					{targetType === "team" ? (
						<form.Field name="teamId">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("settings.vehicleUse.team", "Team")}</TFormLabel>
									<Select
										name="teamId"
										value={field.state.value || null}
										onValueChange={(value: string | null) => field.handleChange(value ?? "")}
										disabled={pending}
									>
										<TFormControl>
											<SelectTrigger className="h-10 w-full" onBlur={field.handleBlur}>
												<SelectValue
													placeholder={t("settings.vehicleUse.selectTeam", "Select a team")}
												/>
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{data.teams.map((team) => (
												<SelectItem key={team.id} value={team.id}>
													{team.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
					) : targetType === "employee" ? (
						<form.Field name="employeeId">
							{(field) => (
								<TFormItem>
									<TFormLabel>{t("settings.vehicleUse.employee", "Employee")}</TFormLabel>
									<Select
										name="employeeId"
										value={field.state.value || null}
										onValueChange={(value: string | null) => field.handleChange(value ?? "")}
										disabled={pending}
									>
										<TFormControl>
											<SelectTrigger className="h-10 w-full" onBlur={field.handleBlur}>
												<SelectValue
													placeholder={t(
														"settings.vehicleUse.selectEmployee",
														"Select an employee",
													)}
												/>
											</SelectTrigger>
										</TFormControl>
										<SelectContent>
											{data.employees.map((employee) => (
												<SelectItem key={employee.id} value={employee.id}>
													{employee.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</TFormItem>
							)}
						</form.Field>
					) : (
						<div />
					)}

					<form.Field name="mode">
						{(field) => (
							<TFormItem>
								<TFormLabel>{t("settings.vehicleUse.mode", "Mode")}</TFormLabel>
								<Select
									name="mode"
									value={field.state.value}
									items={modes}
									onValueChange={(value: VehicleUseMode | null) => {
										if (value) field.handleChange(value);
									}}
									disabled={pending}
								>
									<TFormControl>
										<SelectTrigger className="h-10 w-full" onBlur={field.handleBlur}>
											<SelectValue />
										</SelectTrigger>
									</TFormControl>
									<SelectContent>
										<ModeItems options={modes} />
									</SelectContent>
								</Select>
							</TFormItem>
						)}
					</form.Field>

					<Button type="submit" disabled={!canAdd}>
						{t("settings.vehicleUse.addAssignment", "Add assignment")}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
