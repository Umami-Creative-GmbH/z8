"use client";

import { IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
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

export function InviteCodeDialog({
	organizationId,
	inviteCode,
	open,
	onOpenChange,
}: InviteCodeDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const isEditing = !!inviteCode;

	// Form state
	const [code, setCode] = useState("");
	const [label, setLabel] = useState("");
	const [description, setDescription] = useState("");
	const [maxUses, setMaxUses] = useState<string>("");
	const [expiresAt, setExpiresAt] = useState<string>("");
	const [defaultTeamId, setDefaultTeamId] = useState<string>("");
	const [requiresApproval, setRequiresApproval] = useState(true);
	const [status, setStatus] = useState<"active" | "paused">("active");

	// Fetch teams for team selection
	const { data: teamsResult } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: () => listTeams(organizationId),
		enabled: open,
	});

	const teams = teamsResult?.success ? teamsResult.data : [];

	// Reset form when dialog opens/closes or inviteCode changes
	useEffect(() => {
		if (open) {
			if (inviteCode) {
				setCode(inviteCode.code);
				setLabel(inviteCode.label);
				setDescription(inviteCode.description || "");
				setMaxUses(inviteCode.maxUses?.toString() || "");
				setExpiresAt(
					inviteCode.expiresAt
						? new Date(inviteCode.expiresAt).toISOString().split("T")[0]
						: "",
				);
				setDefaultTeamId(inviteCode.defaultTeamId || "");
				setRequiresApproval(inviteCode.requiresApproval);
				setStatus(inviteCode.status === "paused" ? "paused" : "active");
			} else {
				// Generate a random code for new invites
				generateRandomCode().then((result) => {
					if (result.success) setCode(result.data);
				});
				setLabel("");
				setDescription("");
				setMaxUses("");
				setExpiresAt("");
				setDefaultTeamId("");
				setRequiresApproval(true);
				setStatus("active");
			}
		}
	}, [open, inviteCode]);

	// Generate new random code
	const handleGenerateCode = async () => {
		const result = await generateRandomCode();
		if (result.success) {
			setCode(result.data);
		}
	};

	// Create mutation
	const createMutation = useMutation({
		mutationFn: async () => {
			const result = await createInviteCode({
				organizationId,
				code: code || undefined,
				label,
				description: description || undefined,
				maxUses: maxUses ? parseInt(maxUses, 10) : undefined,
				expiresAt: expiresAt ? new Date(expiresAt) : undefined,
				defaultTeamId: defaultTeamId || undefined,
				requiresApproval,
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
		mutationFn: async () => {
			const result = await updateInviteCode(inviteCode!.id, organizationId, {
				label,
				description: description || null,
				maxUses: maxUses ? parseInt(maxUses, 10) : null,
				expiresAt: expiresAt ? new Date(expiresAt) : null,
				defaultTeamId: defaultTeamId || null,
				requiresApproval,
				status,
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
			updateMutation.mutate();
		} else {
			createMutation.mutate();
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
									value={code}
									onChange={(e) => setCode(e.target.value.toUpperCase())}
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
								value={label}
								onChange={(e) => setLabel(e.target.value)}
								placeholder={t("settings.inviteCodes.labelPlaceholder", "e.g., Public Recruitment 2024")}
								required
							/>
						</div>

						{/* Description */}
						<div className="grid gap-2">
							<Label htmlFor="description">{t("settings.inviteCodes.description", "Description")}</Label>
							<Textarea
								id="description"
								value={description}
								onChange={(e) => setDescription(e.target.value)}
								placeholder={t("settings.inviteCodes.descriptionPlaceholder", "Optional description...")}
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
								value={maxUses}
								onChange={(e) => setMaxUses(e.target.value)}
								placeholder={t("settings.inviteCodes.unlimited", "Unlimited")}
							/>
							<p className="text-sm text-muted-foreground">
								{t("settings.inviteCodes.maxUsesHelp", "Leave empty for unlimited uses")}
							</p>
						</div>

						{/* Expires At */}
						<div className="grid gap-2">
							<Label htmlFor="expiresAt">{t("settings.inviteCodes.expiresAt", "Expiration Date")}</Label>
							<Input
								id="expiresAt"
								type="date"
								value={expiresAt}
								onChange={(e) => setExpiresAt(e.target.value)}
								min={new Date().toISOString().split("T")[0]}
							/>
							<p className="text-sm text-muted-foreground">
								{t("settings.inviteCodes.expiresAtHelp", "Leave empty for no expiration")}
							</p>
						</div>

						{/* Default Team */}
						<div className="grid gap-2">
							<Label htmlFor="defaultTeam">{t("settings.inviteCodes.defaultTeam", "Default Team")}</Label>
							<Select
								value={defaultTeamId || "none"}
								onValueChange={(v) => setDefaultTeamId(v === "none" ? "" : v)}
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
								checked={requiresApproval}
								onCheckedChange={(checked) => setRequiresApproval(checked === true)}
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
								<Select value={status} onValueChange={(v) => setStatus(v as "active" | "paused")}>
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
						<Button type="submit" disabled={isSubmitting || !label.trim()}>
							{isSubmitting && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{isEditing
								? t("common.save", "Save")
								: t("settings.inviteCodes.create", "Create")}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
