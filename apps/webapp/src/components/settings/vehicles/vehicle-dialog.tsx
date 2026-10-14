"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import type { VehicleDriverOption } from "@/app/[locale]/(app)/settings/vehicles/actions";
import { EmployeeMultiSelect } from "@/components/employee-select";
import { toSelectableEmployee } from "@/components/settings/access-grants/grant-editor";
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
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import {
	LICENCE_PLATE_MAX_LENGTH,
	licencePlateKey,
	VEHICLE_NAME_MAX_LENGTH,
	type VehicleChangeInput,
} from "@/lib/organization/vehicles/vehicle-rules";
import type { OrganizationVehicleView } from "@/lib/organization/vehicles/vehicles";

interface VehicleDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** The vehicle to edit; null creates one. */
	vehicle: OrganizationVehicleView | null;
	employees: VehicleDriverOption[];
	teams: Array<{ id: string; name: string }>;
	/** Saves the change; resolves true when it was accepted. */
	onSave: (change: VehicleChangeInput) => Promise<boolean>;
}

/** Creates or edits an organization vehicle: name, licence plate and assigned drivers. */
export function VehicleDialog(props: VehicleDialogProps) {
	// Remount per opening so a reopened dialog starts from fresh values.
	const key = props.vehicle ? `edit:${props.vehicle.id}` : `create:${String(props.open)}`;
	return <VehicleDialogContent key={key} {...props} />;
}

function toggle(values: string[], id: string): string[] {
	return values.includes(id) ? values.filter((value) => value !== id) : [...values, id];
}

function VehicleDialogContent({
	open,
	onOpenChange,
	vehicle,
	employees,
	teams,
	onSave,
}: VehicleDialogProps) {
	const { t } = useTranslate();
	const initialEmployeeIds = vehicle?.drivers.employees.map((driver) => driver.id) ?? [];
	// Departed employees can't be newly assigned, but one still assigned stays listed.
	const employeeOptions = employees
		.filter((employee) => employee.isActive || initialEmployeeIds.includes(employee.id))
		.map((employee) => toSelectableEmployee(employee, { isActive: employee.isActive }));

	const form = useForm({
		defaultValues: {
			name: vehicle?.name ?? "",
			licencePlate: vehicle?.licencePlate ?? "",
			employeeIds: initialEmployeeIds,
			teamIds: vehicle?.drivers.teams.map((driver) => driver.id) ?? [],
		},
		onSubmit: async ({ value }) => {
			const fields = {
				name: value.name.trim(),
				licencePlate: value.licencePlate.trim(),
				drivers: { employeeIds: value.employeeIds, teamIds: value.teamIds },
			};
			const saved = await onSave(
				vehicle
					? { kind: "update", vehicleId: vehicle.id, ...fields }
					: { kind: "create", ...fields },
			);
			if (saved) onOpenChange(false);
		},
	});

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>
						{vehicle
							? t("settings.vehicles.dialog.editTitle", "Edit vehicle")
							: t("settings.vehicles.dialog.createTitle", "Add vehicle")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.vehicles.dialog.description",
							"Assigned drivers get this vehicle suggested first. Anyone may still pick any active vehicle.",
						)}
					</DialogDescription>
				</DialogHeader>
				{/* Client-side TanStack Form submit (docs/refs/forms.md). */}
				{/* react-doctor-disable-next-line react-doctor/no-prevent-default */}
				<form
					className="space-y-4"
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Field
						name="name"
						validators={{
							onChange: ({ value }) => {
								const length = value.trim().length;
								return length === 0 || length > VEHICLE_NAME_MAX_LENGTH
									? t(
											"settings.vehicles.refusals.invalidName",
											"Enter a name of up to 100 characters.",
										)
									: undefined;
							},
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.vehicles.fields.name", "Name")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										value={field.state.value}
										maxLength={VEHICLE_NAME_MAX_LENGTH}
										placeholder={t(
											"settings.vehicles.fields.namePlaceholder",
											"e.g. Service van 3",
										)}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Field
						name="licencePlate"
						validators={{
							onChange: ({ value }) =>
								value.trim().length > LICENCE_PLATE_MAX_LENGTH ||
								licencePlateKey(value).length === 0
									? t(
											"settings.vehicles.refusals.invalidLicencePlate",
											"Enter a licence plate of up to 20 characters.",
										)
									: undefined,
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{t("settings.vehicles.fields.licencePlate", "Licence plate")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Input
										value={field.state.value}
										maxLength={LICENCE_PLATE_MAX_LENGTH}
										autoComplete="off"
										placeholder={t(
											"settings.vehicles.fields.licencePlatePlaceholder",
											"e.g. M-AB 1234",
										)}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>
									{t(
										"settings.vehicles.fields.licencePlateDescription",
										"Unique in your organization. Spaces, hyphens and upper or lower case don't make a plate different.",
									)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
					<form.Field name="teamIds">
						{(field) => (
							<fieldset className="space-y-3">
								<legend className="text-sm font-medium">
									{t("settings.vehicles.fields.teams", "Assigned teams")}
								</legend>
								{teams.length === 0 ? (
									<p className="text-muted-foreground text-sm">
										{t("settings.vehicles.fields.noTeams", "Your organization has no teams yet.")}
									</p>
								) : (
									<div className="grid gap-2 sm:grid-cols-2">
										{teams.map((team) => {
											const selected = field.state.value.includes(team.id);
											return (
												<button
													key={team.id}
													type="button"
													role="switch"
													aria-checked={selected}
													aria-label={team.name}
													onClick={() => field.handleChange(toggle(field.state.value, team.id))}
													className={`flex items-center justify-between gap-4 rounded-md border p-3 text-left text-sm transition-colors ${
														selected ? "border-primary/60 bg-primary/5" : "hover:bg-accent/50"
													}`}
												>
													<span className="min-w-0 truncate">{team.name}</span>
													<span
														aria-hidden="true"
														className={`inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors ${
															selected ? "bg-primary" : "bg-input dark:bg-input/80"
														}`}
													>
														<span
															className={`block size-4 rounded-full bg-background ring-0 transition-transform dark:bg-foreground ${
																selected
																	? "translate-x-[calc(100%-2px)] dark:bg-primary-foreground"
																	: "translate-x-0"
															}`}
														/>
													</span>
												</button>
											);
										})}
									</div>
								)}
								<p className="text-muted-foreground text-sm">
									{t(
										"settings.vehicles.fields.teamsDescription",
										"Every member of an assigned team gets this vehicle suggested first.",
									)}
								</p>
							</fieldset>
						)}
					</form.Field>
					<form.Field name="employeeIds">
						{(field) => (
							<EmployeeMultiSelect
								label={t("settings.vehicles.fields.employees", "Assigned employees")}
								placeholder={t("settings.vehicles.fields.selectEmployees", "Select employees")}
								value={field.state.value}
								onChange={field.handleChange}
								employees={employeeOptions}
							/>
						)}
					</form.Field>
					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<form.Subscribe selector={(state) => state.isSubmitting}>
							{(isSubmitting) => (
								<Button type="submit" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : null}
									{vehicle
										? t("settings.vehicles.dialog.save", "Save")
										: t("settings.vehicles.dialog.create", "Create vehicle")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
