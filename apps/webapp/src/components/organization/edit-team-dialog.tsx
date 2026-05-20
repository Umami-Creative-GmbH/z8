"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { updateTeam } from "@/app/[locale]/(app)/settings/teams/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { team } from "@/db/schema";
import type { TeamManagerOption } from "./create-team-dialog";

const NO_MANAGER_VALUE = "none";

interface EditTeamDialogProps {
	team: typeof team.$inferSelect | null;
	managerOptions: TeamManagerOption[];
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSuccess?: (updatedTeam: typeof team.$inferSelect) => void;
}

export function EditTeamDialog({
	team,
	managerOptions,
	open,
	onOpenChange,
	onSuccess,
}: EditTeamDialogProps) {
	const { t } = useTranslate();
	const updateMutation = useMutation({
		mutationFn: (data: {
			teamId: string;
			name?: string;
			description?: string;
			primaryManagerId?: string | null;
		}) =>
			updateTeam(data.teamId, {
				name: data.name,
				description: data.description,
				primaryManagerId: data.primaryManagerId,
			}),
		onSuccess: (result) => {
			if (!result.success) {
				toast.error(result.error || t("organization.teams.edit.updateError", "Failed to update team"));
				return;
			}
			toast.success(t("organization.teams.edit.updateSuccess", "Team updated successfully"));
			onOpenChange(false);
			onSuccess?.(result.data);
		},
		onError: () => {
			toast.error(t("organization.teams.edit.updateError", "Failed to update team"));
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (!team) return;

		const formData = new FormData(e.currentTarget as HTMLFormElement);
		const name = String(formData.get("name") ?? "").trim();
		const description = String(formData.get("description") ?? "").trim();
		const selectedPrimaryManagerId = String(formData.get("primaryManagerId") ?? NO_MANAGER_VALUE);
		const primaryManagerId =
			selectedPrimaryManagerId === NO_MANAGER_VALUE ? null : selectedPrimaryManagerId;

		updateMutation.mutate({
			teamId: team.id,
			name: name !== team.name ? name : undefined,
			description: description !== (team.description || "") ? description : undefined,
			primaryManagerId: primaryManagerId !== team.primaryManagerId ? primaryManagerId : undefined,
		});
	};

	if (!team) return null;

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("organization.teams.edit.title", "Edit Team")}</ActionPanelTitle>
					<ActionPanelDescription>{t("organization.teams.edit.description", "Update team name and description")}</ActionPanelDescription>
				</ActionPanelHeader>

				<form key={team.id} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
					<ActionPanelBody className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="name">{t("organization.teams.edit.nameLabel", "Team Name")}</Label>
							<Input
								id="name"
								name="name"
								defaultValue={team.name}
								placeholder={t("organization.teams.edit.namePlaceholder", "Engineering, Sales, Marketing...")}
								required
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="description">{t("organization.teams.edit.descriptionLabel", "Description (Optional)")}</Label>
							<Textarea
								id="description"
								name="description"
								defaultValue={team.description || ""}
								placeholder={t("organization.teams.edit.descriptionPlaceholder", "A brief description of this team")}
								rows={3}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="primaryManagerId">{t("organization.teams.edit.fallbackManagerLabel", "Fallback Manager")}</Label>
							<Select
								name="primaryManagerId"
								defaultValue={team.primaryManagerId ?? NO_MANAGER_VALUE}
							>
								<SelectTrigger id="primaryManagerId">
									<SelectValue placeholder={t("organization.teams.edit.fallbackManagerPlaceholder", "Select a fallback manager")} />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NO_MANAGER_VALUE}>{t("organization.teams.edit.noFallbackManager", "No fallback manager")}</SelectItem>
									{managerOptions.map((manager) => (
										<SelectItem key={manager.employeeId} value={manager.employeeId}>
											{manager.name}
											{manager.position ? ` (${manager.position})` : ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-xs text-muted-foreground">
								{t("organization.teams.edit.fallbackManagerHelp", "Used for approvals when a team member has no direct manager.")}
							</p>
						</div>
					</ActionPanelBody>

					<ActionPanelFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => onOpenChange(false)}
							disabled={updateMutation.isPending}
						>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={updateMutation.isPending}>
							{updateMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
							{t("common.saveChanges", "Save Changes")}
						</Button>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
