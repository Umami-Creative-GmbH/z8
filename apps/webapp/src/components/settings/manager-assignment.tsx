"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { assignManagers } from "@/app/[locale]/(app)/settings/employees/actions";
import { EmployeeMultiSelect, toSelectableEmployee } from "@/components/employee-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { UserAvatar } from "@/components/user-avatar";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import { useEmployeeClockStatuses } from "@/lib/query";

interface Manager {
	id: string;
	userId: string;
	user: {
		firstName?: string | null;
		lastName?: string | null;
		name: string;
		email: string;
		image: string | null;
	};
}

interface CurrentManager {
	id: string;
	isPrimary: boolean;
	manager: Manager;
}

interface ManagerAssignmentProps {
	employeeId: string;
	currentManagers: CurrentManager[];
	availableManagers: Manager[];
	onSuccess?: () => void;
	onCancel?: () => void;
}

function buildInitialManagerState(currentManagers: CurrentManager[]) {
	const selectedManagers = new Set(currentManagers.map((manager) => manager.manager.id));
	const primaryManager = currentManagers.find((manager) => manager.isPrimary)?.manager.id ?? "";

	return { selectedManagers, primaryManager };
}

export function ManagerAssignment({
	employeeId,
	currentManagers,
	availableManagers,
	onSuccess,
	onCancel,
}: ManagerAssignmentProps) {
	const { t } = useTranslate();
	const [initialManagerState] = useState(() => buildInitialManagerState(currentManagers));
	const [selectedManagers, setSelectedManagers] = useState<Set<string>>(
		() => initialManagerState.selectedManagers,
	);
	const [primaryManager, setPrimaryManager] = useState<string>(
		() => initialManagerState.primaryManager,
	);
	const [loading, setLoading] = useState(false);
	const presence = useEmployeeClockStatuses(
		availableManagers.map((manager) => manager.id),
		{ polling: false },
	);

	const handleManagersChange = (nextIds: string[]) => {
		const newSelected = new Set(nextIds);
		if (newSelected.size === 0) {
			setPrimaryManager("");
		} else if (!primaryManager || !newSelected.has(primaryManager)) {
			setPrimaryManager(nextIds[0]);
		}
		setSelectedManagers(newSelected);
	};

	const selectableManagers = availableManagers.map((manager) =>
		toSelectableEmployee({
			id: manager.id,
			userId: manager.userId,
			firstName: manager.user.firstName,
			lastName: manager.user.lastName,
			name: buildAuthUserDisplayName(manager.user),
			email: manager.user.email,
			image: manager.user.image,
			role: "manager",
			clockStatus: presence.getStatus(manager.id),
		}),
	);

	const handleSave = async () => {
		// Validate at least one manager selected
		if (selectedManagers.size === 0) {
			toast.error(
				t("settings.managerAssignment.validation.selectOne", "Please select at least one manager"),
			);
			return;
		}

		// Validate primary manager is selected
		if (!primaryManager || !selectedManagers.has(primaryManager)) {
			toast.error(
				t("settings.managerAssignment.validation.primary", "Please designate a primary manager"),
			);
			return;
		}

		setLoading(true);

		const managers = Array.from(selectedManagers).map((managerId) => ({
			managerId,
			isPrimary: managerId === primaryManager,
		}));

		const result = await assignManagers({ employeeId, data: { managers } }).catch(() => null);

		if (!result) {
			toast.error(t("settings.managerAssignment.unexpectedError", "An unexpected error occurred"));
			setLoading(false);
			return;
		}

		if (result.success) {
			toast.success(
				t("settings.managerAssignment.assignSuccess", "Managers assigned successfully"),
			);
			onSuccess?.();
		} else {
			toast.error(
				actionErrorMessage(t, result, {}, [
					"settings.managerAssignment.assignFailed",
					"Failed to assign managers",
				]),
			);
		}

		setLoading(false);
	};

	const isChanged =
		selectedManagers.size !== currentManagers.length ||
		!currentManagers.every((m) => selectedManagers.has(m.manager.id)) ||
		primaryManager !== currentManagers.find((m) => m.isPrimary)?.manager.id;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.managerAssignment.title", "Manager Assignment")}</CardTitle>
				<CardDescription>
					{t(
						"settings.managerAssignment.description",
						"Select one or more managers for this employee. Designate one as primary.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Manager Selection */}
				<EmployeeMultiSelect
					label={t("settings.managerAssignment.availableManagers", "Available Managers")}
					placeholder={t("settings.managerAssignment.selectManagers", "Select managers")}
					emptyMessage={t("settings.managerAssignment.empty", "No available managers")}
					value={Array.from(selectedManagers)}
					onChange={handleManagersChange}
					employees={selectableManagers}
					disabled={loading}
				/>

				{/* Primary Manager Selection */}
				{selectedManagers.size > 0 && (
					<div className="space-y-4">
						<Label className="text-base font-semibold">
							{t("settings.managerAssignment.primaryManager", "Primary Manager")}
						</Label>
						<RadioGroup value={primaryManager} onValueChange={setPrimaryManager} disabled={loading}>
							<div className="space-y-2">
								{Array.from(selectedManagers).map((managerId) => {
									const manager = availableManagers.find((m) => m.id === managerId);
									if (!manager) return null;

									const displayName = buildAuthUserDisplayName(manager.user);

									return (
										<div
											key={manager.id}
											className="flex items-center gap-x-3 rounded-lg border p-3"
										>
											<RadioGroupItem value={manager.id} id={`primary-${manager.id}`} />
											<Label
												htmlFor={`primary-${manager.id}`}
												className="flex flex-1 items-center gap-3 cursor-pointer"
											>
												<UserAvatar
													image={manager.user.image}
													seed={manager.id}
													name={displayName}
													size="sm"
													clockStatus={presence.getStatus(manager.id)}
												/>
												<div className="flex-1">
													<div className="font-medium">{displayName}</div>
													<div className="text-sm text-muted-foreground">{manager.user.email}</div>
												</div>
												{primaryManager === manager.id && (
													<IconCheck className="size-5 text-primary" aria-hidden="true" />
												)}
											</Label>
										</div>
									);
								})}
							</div>
						</RadioGroup>
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.managerAssignment.primaryDescription",
								"The primary manager will be the default for approvals and notifications",
							)}
						</p>
					</div>
				)}

				{/* Action Buttons */}
				<div className="flex justify-end gap-2 pt-4">
					{onCancel && (
						<Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
							<IconX className="mr-2 size-4" aria-hidden="true" />
							{t("common.cancel", "Cancel")}
						</Button>
					)}
					<Button onClick={handleSave} disabled={loading || !isChanged}>
						{loading && <IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />}
						<IconCheck className="mr-2 size-4" aria-hidden="true" />
						{t("settings.managerAssignment.save", "Save Managers")}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
