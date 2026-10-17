"use client";

import { IconCar } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	removeVehicleUseAssignmentAction,
	saveVehicleUseSettingsAction,
	setVehicleUseAssignmentAction,
	type VehicleUseAdminData,
} from "@/app/[locale]/(app)/settings/vehicle-use/actions";
import {
	FeatureSettingsTabs,
	ScopedFeatureAssignments,
} from "@/components/settings/scoped-feature-assignments";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import type { VehicleUseErrorCode } from "@/lib/time-tracking/vehicle-use/errors";
import type { VehicleUseMode } from "@/lib/time-tracking/vehicle-use/policy";

interface VehicleUseSettingsProps {
	data: VehicleUseAdminData;
}

type Translate = ReturnType<typeof useTranslate>["t"];

/** Owner/admin vehicle use enablement (#1119): organization switch and asked/expected assignments. */
export function VehicleUseSettings({ data }: VehicleUseSettingsProps) {
	return (
		<FeatureSettingsTabs
			settings={
				<VehicleUseSwitch
					key={String(data.settings.enabled)}
					initialEnabled={data.settings.enabled}
				/>
			}
			assignments={<VehicleUseAssignments data={data} />}
		/>
	);
}
function vehicleUseErrorMessage(
	t: Translate,
	code: VehicleUseErrorCode,
): string {
	switch (code) {
		case "admin_only":
			return t(
				"settings.vehicleUse.error.adminOnly",
				"Only organization owners and admins can manage vehicle use.",
			);
		case "team_not_found":
			return t(
				"settings.vehicleUse.error.teamNotFound",
				"That team no longer exists.",
			);
		case "employee_not_found":
			return t(
				"settings.vehicleUse.error.employeeNotFound",
				"That employee no longer exists.",
			);
		case "assignment_not_found":
			return t(
				"settings.vehicleUse.error.assignmentNotFound",
				"That assignment no longer exists. Reload the page.",
			);
		case "invalid_target":
		case "invalid_selection":
			return t(
				"settings.vehicleUse.error.invalidTarget",
				"Choose who the assignment applies to.",
			);
		case "invalid_mode":
			return t(
				"settings.vehicleUse.error.invalidMode",
				"Choose a mode for the assignment.",
			);
		case "failed":
			return t(
				"settings.vehicleUse.error.failed",
				"Something went wrong. Try again.",
			);
	}
}

export function VehicleUseSwitch({ initialEnabled }: { initialEnabled: boolean }) {
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
						"settings.vehicleUse.switchTabDescription",
						"Let employees record the vehicle they drove, its odometer readings and the distance on their work. Switching it on applies to nobody until you add an assignment on the Assignments tab.",
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

export function VehicleUseAssignments({ data }: VehicleUseSettingsProps) {
	const { t } = useTranslate();
	const router = useRouter();
	return (
		<ScopedFeatureAssignments
			assignments={data.assignments.map((assignment) => ({
				...assignment,
				value: assignment.mode,
			}))}
			organizationLabel={t(
				"settings.vehicleUse.targetOrganization",
				"Whole organization",
			)}
			teams={data.teams}
			employees={data.employees}
			options={modeOptions(t)}
			valueLabel={t("settings.vehicleUse.mode", "Mode")}
			description={t(
				"settings.vehicleUse.assignmentsDescription",
				"Asked employees may record vehicle use when they clock. Employees with vehicle use expected are asked every time, and their work is flagged until the details are complete. Nobody is ever stopped from clocking. The most specific assignment wins: an employee's own over their primary team's, and a team's over the whole organization's.",
			)}
			onSave={async (target, mode) => {
				const result = await setVehicleUseAssignmentAction({ target, mode });
				if (!result.success) {
					toast.error(vehicleUseErrorMessage(t, result.code));
					return false;
				}
				toast.success(
					t("settings.vehicleUse.assignmentSaved", "Assignment saved"),
				);
				router.refresh();
				return true;
			}}
			onRemove={async (assignmentId) => {
				const result = await removeVehicleUseAssignmentAction({ assignmentId });
				if (!result.success) {
					toast.error(vehicleUseErrorMessage(t, result.code));
					return false;
				}
				toast.success(
					t("settings.vehicleUse.assignmentRemoved", "Assignment removed"),
				);
				router.refresh();
				return true;
			}}
		/>
	);
}
