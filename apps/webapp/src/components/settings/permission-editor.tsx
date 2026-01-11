"use client";

import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useEffect, useState } from "react";
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

const PERMISSION_LABELS = {
	canCreateTeams: {
		label: "Create Teams",
		description: "Allow creating new teams within the organization",
	},
	canManageTeamMembers: {
		label: "Manage Team Members",
		description: "Allow adding and removing team members",
	},
	canManageTeamSettings: {
		label: "Manage Team Settings",
		description: "Allow editing team information and settings",
	},
	canApproveTeamRequests: {
		label: "Approve Team Requests",
		description: "Allow approving vacation and time-off requests",
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
	const [loading, setLoading] = useState(false);
	const [teamScope, setTeamScope] = useState<string>(currentPermissions?.teamId || "all");
	const [permissions, setPermissions] = useState({
		canCreateTeams: currentPermissions?.canCreateTeams || false,
		canManageTeamMembers: currentPermissions?.canManageTeamMembers || false,
		canManageTeamSettings: currentPermissions?.canManageTeamSettings || false,
		canApproveTeamRequests: currentPermissions?.canApproveTeamRequests || false,
	});

	useEffect(() => {
		if (currentPermissions) {
			setPermissions({
				canCreateTeams: currentPermissions.canCreateTeams,
				canManageTeamMembers: currentPermissions.canManageTeamMembers,
				canManageTeamSettings: currentPermissions.canManageTeamSettings,
				canApproveTeamRequests: currentPermissions.canApproveTeamRequests,
			});
			setTeamScope(currentPermissions.teamId || "all");
		}
	}, [currentPermissions]);

	const handlePermissionChange = (permission: keyof typeof permissions, checked: boolean) => {
		setPermissions((prev) => ({
			...prev,
			[permission]: checked,
		}));
	};

	const hasAnyPermission = Object.values(permissions).some((p) => p);

	const handleSave = async () => {
		setLoading(true);

		try {
			const result = await grantTeamPermissions({
				employeeId,
				organizationId,
				teamId: teamScope === "all" ? null : teamScope,
				permissions,
			});

			if (result.success) {
				toast.success("Permissions updated successfully");
				onSuccess?.();
			} else {
				toast.error(result.error || "Failed to update permissions");
			}
		} catch (_error) {
			toast.error("An unexpected error occurred");
		} finally {
			setLoading(false);
		}
	};

	const handleRevoke = async () => {
		setLoading(true);

		try {
			const result = await revokeTeamPermissions(
				employeeId,
				organizationId,
				teamScope === "all" ? undefined : teamScope,
			);

			if (result.success) {
				toast.success("Permissions revoked successfully");
				onSuccess?.();
			} else {
				toast.error(result.error || "Failed to revoke permissions");
			}
		} catch (_error) {
			toast.error("An unexpected error occurred");
		} finally {
			setLoading(false);
		}
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
				<CardTitle>Team Permissions</CardTitle>
				<CardDescription>
					Configure permissions for {employeeName}. Admins automatically have all permissions.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				{/* Team Scope Selection */}
				<div className="space-y-2">
					<Label htmlFor="teamScope">Permission Scope</Label>
					<Select value={teamScope} onValueChange={setTeamScope}>
						<SelectTrigger id="teamScope">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All Teams (Organization-wide)</SelectItem>
							{availableTeams.map((team) => (
								<SelectItem key={team.id} value={team.id}>
									{team.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<p className="text-sm text-muted-foreground">
						{teamScope === "all"
							? "Permissions apply to all teams in the organization"
							: "Permissions apply only to the selected team"}
					</p>
				</div>

				{/* Permission Checkboxes */}
				<div className="space-y-4">
					<Label className="text-base font-semibold">Permissions</Label>
					<div className="space-y-4">
						{Object.entries(PERMISSION_LABELS).map(([key, { label, description }]) => (
							<div key={key} className="flex items-start space-x-3 rounded-lg border p-3">
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
										{label}
									</Label>
									<p className="mt-1 text-sm text-muted-foreground">{description}</p>
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
								Revoke All
							</Button>
						)}
					</div>
					<div className="flex gap-2">
						{onCancel && (
							<Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
								Cancel
							</Button>
						)}
						<Button onClick={handleSave} disabled={loading || !isChanged || !hasAnyPermission}>
							{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							<IconCheck className="mr-2 size-4" />
							Save Permissions
						</Button>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
