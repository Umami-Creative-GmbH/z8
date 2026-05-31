"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	grantTeamPermissions,
	revokeTeamPermissions,
} from "@/app/[locale]/(app)/settings/permissions/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";

interface PermissionEditorProps {
	employeeId: string;
	employeeName: string;
	organizationId: string;
	currentPermissions?: {
		teamId: string | null;
		canCreateTeams: boolean;
		canManageTeamMembers: boolean;
		canManageTeamSettings: boolean;
		canApproveTeamRequests: boolean;
	};
	availableTeams: Array<{
		id: string;
		name: string;
	}>;
	onSuccess?: () => void;
	onCancel?: () => void;
}

const PERMISSION_KEYS = {
	canCreateTeams: {
		labelKey: "settings.permissions.createTeams",
		descriptionKey: "settings.permissions.createTeamsDescription",
		labelFallback: "Create Teams",
		descriptionFallback: "Allow creating new teams within the organization",
	},
	canManageTeamMembers: {
		labelKey: "settings.permissions.manageTeamMembers",
		descriptionKey: "settings.permissions.manageTeamMembersDescription",
		labelFallback: "Manage Team Members",
		descriptionFallback: "Allow adding and removing team members",
	},
	canManageTeamSettings: {
		labelKey: "settings.permissions.manageTeamSettings",
		descriptionKey: "settings.permissions.manageTeamSettingsDescription",
		labelFallback: "Manage Team Settings",
		descriptionFallback: "Allow editing team information and settings",
	},
	canApproveTeamRequests: {
		labelKey: "settings.permissions.approveTeamRequests",
		descriptionKey: "settings.permissions.approveTeamRequestsDescription",
		labelFallback: "Approve Team Requests",
		descriptionFallback: "Allow approving vacation and time-off requests",
	},
};

export function PermissionEditor({
	employeeId,
	employeeName,
	organizationId,
	currentPermissions,
	availableTeams,
	onSuccess,
	onCancel,
}: PermissionEditorProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);
	const [teamScope, setTeamScope] = useState<string>(currentPermissions?.teamId || "all");
	const [permissions, setPermissions] = useState({
		canCreateTeams: currentPermissions?.canCreateTeams || false,
		canManageTeamMembers: currentPermissions?.canManageTeamMembers || false,
		canManageTeamSettings: currentPermissions?.canManageTeamSettings || false,
		canApproveTeamRequests: currentPermissions?.canApproveTeamRequests || false,
	});

	const handlePermissionChange = (permission: keyof typeof permissions, checked: boolean) => {
		setPermissions((prev) => ({
			...prev,
			[permission]: checked,
		}));
	};

	const hasAnyPermission = Object.values(permissions).some((p) => p);

	const handleSave = async () => {
		setLoading(true);

		const result = await grantTeamPermissions({
			employeeId,
			organizationId,
			teamId: teamScope === "all" ? null : teamScope,
			permissions,
		}).then(
			(response) => response,
			() => null,
		);

		if (!result) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			setLoading(false);
			return;
		}

		if (result.success) {
			toast.success(t("settings.permissions.updateSuccess", "Permissions updated successfully"));
			onSuccess?.();
		} else {
			toast.error(
				result.error || t("settings.permissions.updateError", "Failed to update permissions"),
			);
		}

		setLoading(false);
	};

	const handleRevoke = async () => {
		setLoading(true);

		const result = await revokeTeamPermissions(
			employeeId,
			organizationId,
			teamScope === "all" ? undefined : teamScope,
		).then(
			(response) => response,
			() => null,
		);

		if (!result) {
			toast.error(t("common.unexpectedError", "An unexpected error occurred"));
			setLoading(false);
			return;
		}

		if (result.success) {
			toast.success(t("settings.permissions.revokeSuccess", "Permissions revoked successfully"));
			onSuccess?.();
		} else {
			toast.error(
				result.error || t("settings.permissions.revokeError", "Failed to revoke permissions"),
			);
		}

		setLoading(false);
	};

	const isChanged =
		teamScope !== (currentPermissions?.teamId || "all") ||
		permissions.canCreateTeams !== currentPermissions?.canCreateTeams ||
		permissions.canManageTeamMembers !== currentPermissions?.canManageTeamMembers ||
		permissions.canManageTeamSettings !== currentPermissions?.canManageTeamSettings ||
		permissions.canApproveTeamRequests !== currentPermissions?.canApproveTeamRequests;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("settings.permissions.title", "Team Permissions")}</CardTitle>
				<CardDescription>
					{t(
						"settings.permissions.description",
						"Configure permissions for {employeeName}. Admins automatically have all permissions.",
						{ employeeName },
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Team Scope Selection */}
				<div className="space-y-2">
					<Label htmlFor="teamScope">{t("settings.permissions.scope", "Permission Scope")}</Label>
					<Select value={teamScope} onValueChange={setTeamScope}>
						<SelectTrigger id="teamScope">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">
								{t("settings.permissions.allTeams", "All Teams (Organization-wide)")}
							</SelectItem>
							{availableTeams.map((team) => (
								<SelectItem key={team.id} value={team.id}>
									{team.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-sm text-muted-foreground">
						{teamScope === "all"
							? t(
									"settings.permissions.allTeamsHelp",
									"Permissions apply to all teams in the organization",
								)
							: t(
									"settings.permissions.selectedTeamHelp",
									"Permissions apply only to the selected team",
								)}
					</p>
				</div>

				{/* Permission Checkboxes */}
				<div className="space-y-4">
					<Label className="text-base font-semibold">
						{t("settings.permissions.permissions", "Permissions")}
					</Label>
					<div className="space-y-4">
						{Object.entries(PERMISSION_KEYS).map(([key, item]) => (
							<div key={key} className="flex items-start gap-x-3 rounded-lg border p-3">
								<Checkbox
									id={key}
									checked={permissions[key as keyof typeof permissions]}
									onCheckedChange={(checked) =>
										handlePermissionChange(key as keyof typeof permissions, checked as boolean)
									}
									disabled={loading}
								/>
								<div className="flex-1">
									<Label
										htmlFor={key}
										className="cursor-pointer font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
									>
										{t(item.labelKey, item.labelFallback)}
									</Label>
									<p className="mt-1 text-sm text-muted-foreground">
										{t(item.descriptionKey, item.descriptionFallback)}
									</p>
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Action Buttons */}
				<div className="flex justify-between pt-4">
					<div>
						{currentPermissions && hasAnyPermission && (
							<Button type="button" variant="destructive" onClick={handleRevoke} disabled={loading}>
								{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
								<IconX className="mr-2 size-4" />
								{t("settings.permissions.revokeAll", "Revoke All")}
							</Button>
						)}
					</div>
					<div className="flex gap-2">
						{onCancel && (
							<Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
								{t("common.cancel", "Cancel")}
							</Button>
						)}
						<Button onClick={handleSave} disabled={loading || !isChanged || !hasAnyPermission}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							<IconCheck className="mr-2 size-4" />
							{t("settings.permissions.save", "Save Permissions")}
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
