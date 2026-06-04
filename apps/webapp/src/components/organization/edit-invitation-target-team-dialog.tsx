"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { updateInvitationTargetTeam } from "@/app/[locale]/(app)/settings/organizations/actions";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
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
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query";
import type { InvitationWithInviter } from "./organizations-page-client";

type TargetTeamOption = { id: string; name: string };

export function resolveInvitationTargetTeamUpdate(
	targetTeamId: string | null,
	teams: TargetTeamOption[],
) {
	return {
		targetTeamId,
		targetTeam: targetTeamId ? (teams.find((team) => team.id === targetTeamId) ?? null) : null,
	};
}

interface EditInvitationTargetTeamDialogProps {
	organizationId: string;
	invitation: InvitationWithInviter | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onUpdated: (update: {
		targetTeamId: string | null;
		targetTeam: { id: string; name: string } | null;
	}) => void;
}

export function EditInvitationTargetTeamDialog({
	organizationId,
	invitation,
	open,
	onOpenChange,
	onUpdated,
}: EditInvitationTargetTeamDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [targetTeamDraft, setTargetTeamDraft] = useState<{
		invitationId: string | null;
		value: string;
	} | null>(null);

	const { data: teamsResult } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: () => listTeams(organizationId),
		enabled: open,
	});
	const teams = teamsResult?.success ? teamsResult.data : [];
	const invitationId = invitation?.id;
	const selectedTargetTeamId =
		open && targetTeamDraft?.invitationId === (invitationId ?? null)
			? targetTeamDraft.value
			: (invitation?.targetTeamId ?? "none");

	const updateMutation = useMutation({
		mutationFn: ({ targetTeamId }: { targetTeamId: string | null }) => {
			if (!invitation) {
				throw new Error("Invitation is required");
			}

			return updateInvitationTargetTeam({
				invitationId: invitation.id,
				organizationId,
				targetTeamId,
			});
		},
		onSuccess: (result, variables) => {
			if (result.success) {
				const update = resolveInvitationTargetTeamUpdate(variables.targetTeamId, teams);

				toast.success(
					t("organization.members.targetTeamUpdateSuccess", "Invitation target team updated"),
				);
				queryClient.invalidateQueries({ queryKey: queryKeys.invitations.list(organizationId) });
				onUpdated(update);
				onOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t("organization.members.targetTeamUpdateError", "Failed to update target team"),
				);
			}
		},
		onError: (error) => {
			toast.error(
				error instanceof Error
					? error.message
					: t("organization.members.targetTeamUpdateError", "Failed to update target team"),
			);
		},
	});

	const submittedTargetTeamId = selectedTargetTeamId === "none" ? null : selectedTargetTeamId;
	const handleTargetTeamChange = (value: string) => {
		setTargetTeamDraft({ invitationId: invitationId ?? null, value });
	};

	return (
		<ActionPanel open={open} onOpenChange={onOpenChange}>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("organization.members.editTargetTeam", "Edit target team")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"organization.members.editTargetTeamDescription",
							"Choose which team this pending invitation should join after acceptance.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody className="space-y-5">
					<div className="space-y-2">
						<Label htmlFor="invitationTargetTeam">
							{t("organization.members.targetTeam", "Target Team")}
						</Label>
						<Select
							value={selectedTargetTeamId}
							onValueChange={handleTargetTeamChange}
							disabled={updateMutation.isPending}
						>
							<SelectTrigger
								id="invitationTargetTeam"
								aria-label={t("organization.members.targetTeam", "Target Team")}
							>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="none">
									{t("organization.members.noTargetTeam", "No team")}
								</SelectItem>
								{teams.map((team) => (
									<SelectItem key={team.id} value={team.id}>
										{team.name}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
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
					<Button
						type="button"
						onClick={() => updateMutation.mutate({ targetTeamId: submittedTargetTeamId })}
						disabled={!invitation || updateMutation.isPending}
					>
						{updateMutation.isPending && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{t("common.save", "Save")}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
