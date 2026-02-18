"use client";

import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
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
import {
	createInviteCode,
	updateInviteCode,
	generateRandomCode,
} from "@/app/[locale]/(app)/settings/organizations/invite-code-actions";
import type { InviteCodeWithRelations } from "@/app/[locale]/(app)/settings/organizations/invite-code-actions";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { queryKeys } from "@/lib/query";

interface InviteCodeDialogProps {
	organizationId: string;
	inviteCode?: InviteCodeWithRelations | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

interface InviteCodeFormValues {
	code: string;
	label: string;
	description: string;
	maxUses: string;
	expiresAt: string;
	defaultTeamId: string;
	requiresApproval: boolean;
	status: "active" | "paused";
}

export function InviteCodeDialog({
	organizationId,
	inviteCode,
	open,
	onOpenChange,
}: InviteCodeDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!inviteCode;
	const formScopeKey = `${open}:${inviteCode?.id ?? "new"}`;

	const [draftState, setDraftState] = useState<{
		scopeKey: string;
		values: InviteCodeFormValues;
	} | null>(null);

	// Fetch teams for team selection
	const { data: teamsResult } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: () => listTeams(organizationId),
		enabled: open,
	});

	const teams = teamsResult?.success ? teamsResult.data : [];

	const generatedCodeQuery = useQuery({
		queryKey: ["invite-code", "generated", formScopeKey],
		queryFn: async () => {
			const result = await generateRandomCode();
			if (!result.success) {
				throw new Error(result.error || "Failed to generate invite code");
			}
			return result.data;
		},
		enabled: open && !isEditing,
	});

	const initialValues: InviteCodeFormValues = {
		code: inviteCode?.code || generatedCodeQuery.data || "",
		label: inviteCode?.label || "",
		description: inviteCode?.description || "",
		maxUses: inviteCode?.maxUses?.toString() || "",
		expiresAt: inviteCode?.expiresAt ? new Date(inviteCode.expiresAt).toISOString().split("T")[0] : "",
		defaultTeamId: inviteCode?.defaultTeamId || "",
		requiresApproval: inviteCode?.requiresApproval ?? true,
		status: inviteCode?.status === "paused" ? "paused" : "active",
	};

	const values =
		draftState?.scopeKey === formScopeKey
			? draftState.values
			: initialValues;

	const updateDraft = (updates: Partial<InviteCodeFormValues>) => {
		setDraftState((prev) => {
			const baseValues = prev?.scopeKey === formScopeKey ? prev.values : initialValues;
			return {
				scopeKey: formScopeKey,
				values: {
					...baseValues,
					...updates,
				},
			};
		});
	};

	// Generate new random code
	const handleGenerateCode = async () => {
		const result = await generateRandomCode();
		if (result.success) {
			updateDraft({ code: result.data });
		}
	};

	// Create mutation
	const createMutation = useMutation({
		mutationFn: async (formValues: InviteCodeFormValues) => {
			const result = await createInviteCode({
				organizationId,
				code: formValues.code || undefined,
				label: formValues.label,
				description: formValues.description || undefined,
				maxUses: formValues.maxUses ? parseInt(formValues.maxUses, 10) : undefined,
				expiresAt: formValues.expiresAt ? new Date(formValues.expiresAt) : undefined,
				defaultTeamId: formValues.defaultTeamId || undefined,
				requiresApproval: formValues.requiresApproval,
			});
			if (!result.success) throw new Error(result.error || "Failed to create invite code");
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.inviteCodes.list(organizationId) });
			toast.success(t("settings.inviteCodes.created", "Invite code created"));
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	// Update mutation
	const updateMutation = useMutation({
		mutationFn: async (formValues: InviteCodeFormValues) => {
			const result = await updateInviteCode(inviteCode!.id, organizationId, {
				label: formValues.label,
				description: formValues.description || null,
				maxUses: formValues.maxUses ? parseInt(formValues.maxUses, 10) : null,
				expiresAt: formValues.expiresAt ? new Date(formValues.expiresAt) : null,
				defaultTeamId: formValues.defaultTeamId || null,
				requiresApproval: formValues.requiresApproval,
				status: formValues.status,
			});
			if (!result.success) throw new Error(result.error || "Failed to update invite code");
			return result.data;
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.inviteCodes.list(organizationId) });
			toast.success(t("settings.inviteCodes.updated", "Invite code updated"));
			onOpenChange(false);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault();
		if (isEditing) {
			updateMutation.mutate(values);
		} else {
			createMutation.mutate(values);
		}
	};

	const isSubmitting = createMutation.isPending || updateMutation.isPending;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
				<form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
					<DialogHeader>
						<DialogTitle>
							{isEditing
								? t("settings.inviteCodes.editCode", "Edit Invite Code")
								: t("settings.inviteCodes.createCode", "Create Invite Code")}
						</DialogTitle>
						<DialogDescription>
							{isEditing
								? t(
										"settings.inviteCodes.editDescription",
										"Update the settings for this invite code",
									)
								: t(
										"settings.inviteCodes.createDescription",
										"Create a new invite code for users to join your organization",
									)}
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-4 py-4 overflow-y-auto flex-1 pr-2">
						{/* Code */}
						<div className="grid gap-2">
							<Label htmlFor="code">{t("settings.inviteCodes.code", "Code")}</Label>
							<div className="flex gap-2">
							<Input
								id="code"
								value={values.code}
								onChange={(e) => updateDraft({ code: e.target.value.toUpperCase() })}
								placeholder={t("settings.inviteCodes.codePlaceholder", "TEAM-ABC123")}
								disabled={isEditing}
								className="uppercase"
								/>
								{!isEditing && (
									<Button
										type="button"
										variant="outline"
										onClick={handleGenerateCode}
										aria-label={t("settings.inviteCodes.generateCode", "Generate new code")}
									>
										<IconRefresh className="h-4 w-4" />
									</Button>
								)}
							</div>
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.inviteCodes.codeHelp",
									"4-20 characters, letters, numbers, and hyphens only",
								)}
							</p>
						</div>

						{/* Label */}
						<div className="grid gap-2">
							<Label htmlFor="label">{t("settings.inviteCodes.label", "Label")} *</Label>
							<Input
								id="label"
								value={values.label}
								onChange={(e) => updateDraft({ label: e.target.value })}
								placeholder={t(
									"settings.inviteCodes.labelPlaceholder",
									"e.g., Public Recruitment 2024",
								)}
								required
							/>
						</div>

						{/* Description */}
						<div className="grid gap-2">
							<Label htmlFor="description">
								{t("settings.inviteCodes.description", "Description")}
							</Label>
							<Textarea
								id="description"
								value={values.description}
								onChange={(e) => updateDraft({ description: e.target.value })}
								placeholder={t(
									"settings.inviteCodes.descriptionPlaceholder",
									"Optional description...",
								)}
								rows={2}
							/>
						</div>

						{/* Max Uses */}
						<div className="grid gap-2">
							<Label htmlFor="maxUses">{t("settings.inviteCodes.maxUses", "Maximum Uses")}</Label>
							<Input
								id="maxUses"
								type="number"
								min="1"
								value={values.maxUses}
								onChange={(e) => updateDraft({ maxUses: e.target.value })}
								placeholder={t("settings.inviteCodes.unlimited", "Unlimited")}
							/>
							<p className="text-sm text-muted-foreground">
								{t("settings.inviteCodes.maxUsesHelp", "Leave empty for unlimited uses")}
							</p>
						</div>

						{/* Expires At */}
						<div className="grid gap-2">
							<Label htmlFor="expiresAt">
								{t("settings.inviteCodes.expiresAt", "Expiration Date")}
							</Label>
							<Input
								id="expiresAt"
								type="date"
								value={values.expiresAt}
								onChange={(e) => updateDraft({ expiresAt: e.target.value })}
								min={new Date().toISOString().split("T")[0]}
							/>
							<p className="text-sm text-muted-foreground">
								{t("settings.inviteCodes.expiresAtHelp", "Leave empty for no expiration")}
							</p>
						</div>

						{/* Default Team */}
						<div className="grid gap-2">
							<Label htmlFor="defaultTeam">
								{t("settings.inviteCodes.defaultTeam", "Default Team")}
							</Label>
							<Select
								value={values.defaultTeamId || "none"}
								onValueChange={(v) => updateDraft({ defaultTeamId: v === "none" ? "" : v })}
							>
								<SelectTrigger>
									<SelectValue
										placeholder={t("settings.inviteCodes.noDefaultTeam", "No default team")}
									/>
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="none">
										{t("settings.inviteCodes.noDefaultTeam", "No default team")}
									</SelectItem>
									{teams.map((team) => (
										<SelectItem key={team.id} value={team.id}>
											{team.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.inviteCodes.defaultTeamHelp",
									"New members will be suggested for this team during approval",
								)}
							</p>
						</div>

						{/* Requires Approval */}
						<div className="flex items-center space-x-2">
							<Checkbox
								id="requiresApproval"
								checked={values.requiresApproval}
								onCheckedChange={(checked) =>
									updateDraft({ requiresApproval: checked === true })
								}
							/>
							<Label htmlFor="requiresApproval" className="cursor-pointer">
								{t("settings.inviteCodes.requiresApproval", "Require admin approval")}
							</Label>
						</div>
						<p className="text-sm text-muted-foreground -mt-2">
							{t(
								"settings.inviteCodes.requiresApprovalHelp",
								"When enabled, new members will be pending until an admin approves them",
							)}
						</p>

						{/* Status (only for editing) */}
						{isEditing && (
							<div className="grid gap-2">
								<Label htmlFor="status">{t("settings.inviteCodes.status", "Status")}</Label>
							<Select
								value={values.status}
								onValueChange={(v) => updateDraft({ status: v as "active" | "paused" })}
							>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="active">
											{t("settings.inviteCodes.status.active", "Active")}
										</SelectItem>
										<SelectItem value="paused">
											{t("settings.inviteCodes.status.paused", "Paused")}
										</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</div>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting || !values.label.trim()}>
							{isSubmitting && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isEditing ? t("common.save", "Save") : t("settings.inviteCodes.create", "Create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
