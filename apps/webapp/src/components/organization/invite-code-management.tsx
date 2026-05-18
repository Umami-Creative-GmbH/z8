"use client";

import {
	IconCheck,
	IconCopy,
	IconLoader2,
	IconPlus,
	IconQrcode,
	IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import type { InviteCodeWithRelations } from "@/app/[locale]/(app)/settings/organizations/invite-code-actions";
import {
	deleteInviteCode,
	getInviteBaseUrl,
	listInviteCodes,
} from "@/app/[locale]/(app)/settings/organizations/invite-code-actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { queryKeys } from "@/lib/query";
import { InviteCodeDialog } from "./invite-code-dialog";
import { InviteCodeQRDialog } from "./invite-code-qr-dialog";

interface InviteCodeManagementProps {
	organizationId: string;
	currentMemberRole: "owner" | "admin" | "member";
}

const statusColors = {
	active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
	paused: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
	expired: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
	archived: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
};

function InviteCodeMobileCard({
	code,
	copiedCode,
	onCopyCode,
	onCopyUrl,
	onOpenQr,
	onEdit,
	onDelete,
	formatDate,
	formatUsage,
	t,
}: {
	code: InviteCodeWithRelations;
	copiedCode: string | null;
	onCopyCode: (code: string) => void;
	onCopyUrl: (code: string) => void;
	onOpenQr: (code: InviteCodeWithRelations) => void;
	onEdit: (code: InviteCodeWithRelations) => void;
	onDelete: (code: InviteCodeWithRelations) => void;
	formatDate: (date: Date | null | undefined) => string;
	formatUsage: (code: InviteCodeWithRelations) => string;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<div className="rounded-xl border bg-card p-4 shadow-sm">
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0 space-y-1">
					<div className="flex min-w-0 items-center gap-2">
						<code className="block min-w-0 max-w-full truncate rounded-md bg-muted px-2.5 py-1 font-mono text-sm font-semibold tracking-[0.12em] sm:text-base sm:tracking-[0.18em]">
							{code.code}
						</code>
						<Button
							variant="ghost"
							size="sm"
							className="size-8 shrink-0 p-0"
							onClick={() => onCopyCode(code.code)}
							aria-label={t("settings.inviteCodes.copyCode", "Copy code")}
						>
							{copiedCode === code.code ? (
								<IconCheck className="size-4 text-green-600" aria-hidden="true" />
							) : (
								<IconCopy className="size-4" aria-hidden="true" />
							)}
						</Button>
					</div>
					<div className="truncate font-medium">{code.label}</div>
					{code.description && (
						<div className="line-clamp-2 text-sm text-muted-foreground">{code.description}</div>
					)}
				</div>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="sm" aria-label={t("common.moreActions", "More actions")}>
							•••
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						<DropdownMenuItem onClick={() => onEdit(code)}>{t("common.edit", "Edit")}</DropdownMenuItem>
						<DropdownMenuItem onClick={() => onDelete(code)} className="text-destructive">
							{t("common.delete", "Delete")}
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="mt-4 grid grid-cols-2 gap-3 text-sm">
				<div>
					<div className="text-muted-foreground">{t("settings.inviteCodes.status", "Status")}</div>
					<Badge variant="secondary" className={statusColors[code.status]}>
						{t(`settings.inviteCodes.status.${code.status}`, code.status)}
					</Badge>
				</div>
				<div>
					<div className="text-muted-foreground">{t("settings.inviteCodes.usage", "Usage")}</div>
					<div className="font-medium">{formatUsage(code)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">{t("settings.inviteCodes.expires", "Expires")}</div>
					<div className="font-medium">{formatDate(code.expiresAt)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">{t("settings.inviteCodes.approval", "Approval")}</div>
					<Badge variant={code.requiresApproval ? "default" : "secondary"}>
						{code.requiresApproval
							? t("settings.inviteCodes.required", "Required")
							: t("settings.inviteCodes.auto", "Auto")}
					</Badge>
				</div>
			</div>

			<div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
				<Button
					variant="outline"
					className="min-w-0 whitespace-normal text-center"
					onClick={() => onCopyUrl(code.code)}
				>
					<IconCopy className="mr-2 size-4" aria-hidden="true" />
					{t("settings.inviteCodes.copyUrl", "Copy invite URL")}
				</Button>
				<Button
					variant="outline"
					className="min-w-0 whitespace-normal text-center"
					onClick={() => onOpenQr(code)}
				>
					<IconQrcode className="mr-2 size-4" aria-hidden="true" />
					{t("settings.inviteCodes.qrCode", "QR Code")}
				</Button>
			</div>
		</div>
	);
}

export function InviteCodeManagement({
	organizationId,
	currentMemberRole,
}: InviteCodeManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editingCode, setEditingCode] = useState<InviteCodeWithRelations | null>(null);
	const [qrDialogCode, setQrDialogCode] = useState<InviteCodeWithRelations | null>(null);
	const [deleteDialogCode, setDeleteDialogCode] = useState<InviteCodeWithRelations | null>(null);
	const [copiedCode, setCopiedCode] = useState<string | null>(null);

	const canManage = currentMemberRole === "admin" || currentMemberRole === "owner";

	// Fetch invite codes
	const { data: inviteCodesResult, isLoading } = useQuery({
		queryKey: queryKeys.inviteCodes.list(organizationId),
		queryFn: () => listInviteCodes(organizationId),
	});

	const inviteCodes = inviteCodesResult?.success ? inviteCodesResult.data : [];

	const { data: inviteBaseUrlResult } = useQuery({
		queryKey: ["invite-base-url", organizationId],
		queryFn: () => getInviteBaseUrl(organizationId),
		enabled: canManage,
	});

	const inviteBaseUrl =
		inviteBaseUrlResult?.success && inviteBaseUrlResult.data
			? inviteBaseUrlResult.data
			: typeof window !== "undefined"
				? window.location.origin
				: "";

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: async (inviteCodeId: string) => {
			const result = await deleteInviteCode(inviteCodeId, organizationId);
			if (!result.success) throw new Error(result.error || "Failed to delete");
		},
		onSuccess: () => {
			queryClient.invalidateQueries({ queryKey: queryKeys.inviteCodes.list(organizationId) });
			toast.success(t("settings.inviteCodes.deleted", "Invite code deleted"));
			setDeleteDialogCode(null);
		},
		onError: (error) => {
			toast.error(error.message);
		},
	});

	const handleCopyCode = async (code: string) => {
		const joinUrl = `${inviteBaseUrl}/join/${code}`;
		await navigator.clipboard.writeText(joinUrl);
		setCopiedCode(code);
		toast.success(t("settings.inviteCodes.urlCopied", "Invite URL copied to clipboard"));
		setTimeout(() => setCopiedCode(null), 2000);
	};

	const handleCopyCodeOnly = async (code: string) => {
		await navigator.clipboard.writeText(code);
		setCopiedCode(code);
		toast.success(t("settings.inviteCodes.codeCopied", "Invite code copied"));
		setTimeout(() => setCopiedCode(null), 2000);
	};

	const formatDate = (date: Date | null | undefined) => {
		if (!date) return "-";
		return new Date(date).toLocaleDateString();
	};

	const formatUsage = (code: InviteCodeWithRelations) => {
		if (code.maxUses === null) {
			return `${code.currentUses} / ∞`;
		}
		return `${code.currentUses} / ${code.maxUses}`;
	};

	if (!canManage) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div>
						<CardTitle>{t("settings.inviteCodes.title", "Invite Codes")}</CardTitle>
						<CardDescription>
							{t(
								"settings.inviteCodes.description",
								"Create shareable codes for users to join your organization",
							)}
						</CardDescription>
					</div>
					<Button onClick={() => setCreateDialogOpen(true)} className="shrink-0 px-2 sm:px-4">
						<IconPlus className="size-4 sm:mr-2" />
						<span className="sr-only sm:not-sr-only">
							{t("settings.inviteCodes.createCode", "Create Code")}
						</span>
					</Button>
				</div>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center justify-center py-8">
						<IconLoader2 className="size-6 animate-spin text-muted-foreground" />
					</div>
				) : inviteCodes.length === 0 ? (
					<div className="text-center py-8 text-muted-foreground">
						{t("settings.inviteCodes.noCodes", "No invite codes yet. Create one to get started.")}
					</div>
				) : (
					<>
						<div className="hidden md:block">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>{t("settings.inviteCodes.code", "Code")}</TableHead>
										<TableHead>{t("settings.inviteCodes.label", "Label")}</TableHead>
										<TableHead>{t("settings.inviteCodes.status", "Status")}</TableHead>
										<TableHead>{t("settings.inviteCodes.usage", "Usage")}</TableHead>
										<TableHead>{t("settings.inviteCodes.expires", "Expires")}</TableHead>
										<TableHead>{t("settings.inviteCodes.approval", "Approval")}</TableHead>
										<TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{inviteCodes.map((code) => (
										<TableRow key={code.id}>
											<TableCell>
												<div className="flex items-center gap-2">
													<code className="font-mono text-sm bg-muted px-2 py-1 rounded">
														{code.code}
													</code>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																className="size-6 p-0"
																onClick={() => handleCopyCodeOnly(code.code)}
																aria-label={t("settings.inviteCodes.copyCode", "Copy code")}
															>
																{copiedCode === code.code ? (
																	<IconCheck className="size-4 text-green-600" />
																) : (
																	<IconCopy className="size-4" />
																)}
															</Button>
														</TooltipTrigger>
														<TooltipContent>
															{t("settings.inviteCodes.copyCode", "Copy code")}
														</TooltipContent>
													</Tooltip>
												</div>
											</TableCell>
											<TableCell>
												<div>
													<div className="font-medium">{code.label}</div>
													{code.description && (
														<div className="text-sm text-muted-foreground truncate max-w-[200px]">
															{code.description}
														</div>
													)}
												</div>
											</TableCell>
											<TableCell>
												<Badge variant="secondary" className={statusColors[code.status]}>
													{t(`settings.inviteCodes.status.${code.status}`, code.status)}
												</Badge>
											</TableCell>
											<TableCell>{formatUsage(code)}</TableCell>
											<TableCell>{formatDate(code.expiresAt)}</TableCell>
											<TableCell>
												<Badge variant={code.requiresApproval ? "default" : "secondary"}>
													{code.requiresApproval
														? t("settings.inviteCodes.required", "Required")
														: t("settings.inviteCodes.auto", "Auto")}
												</Badge>
											</TableCell>
											<TableCell className="text-right">
												<div className="flex items-center justify-end gap-1">
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																onClick={() => handleCopyCode(code.code)}
																aria-label={t("settings.inviteCodes.copyUrl", "Copy invite URL")}
															>
																<IconCopy className="size-4" />
															</Button>
														</TooltipTrigger>
														<TooltipContent>
															{t("settings.inviteCodes.copyUrl", "Copy invite URL")}
														</TooltipContent>
													</Tooltip>
													<Tooltip>
														<TooltipTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																onClick={() => setQrDialogCode(code)}
																aria-label={t("settings.inviteCodes.qrCode", "QR Code")}
															>
																<IconQrcode className="size-4" />
															</Button>
														</TooltipTrigger>
														<TooltipContent>
															{t("settings.inviteCodes.qrCode", "QR Code")}
														</TooltipContent>
													</Tooltip>
													<DropdownMenu>
														<DropdownMenuTrigger asChild>
															<Button
																variant="ghost"
																size="sm"
																aria-label={t("common.moreActions", "More actions")}
															>
																•••
															</Button>
														</DropdownMenuTrigger>
														<DropdownMenuContent align="end">
															<DropdownMenuItem onClick={() => setEditingCode(code)}>
																{t("common.edit", "Edit")}
															</DropdownMenuItem>
															<DropdownMenuItem
																onClick={() => setDeleteDialogCode(code)}
																className="text-destructive"
															>
																{t("common.delete", "Delete")}
															</DropdownMenuItem>
														</DropdownMenuContent>
													</DropdownMenu>
												</div>
											</TableCell>
										</TableRow>
									))}
								</TableBody>
							</Table>
						</div>
						<div className="space-y-3 md:hidden">
							{inviteCodes.map((code) => (
								<InviteCodeMobileCard
									key={code.id}
									code={code}
									copiedCode={copiedCode}
									onCopyCode={handleCopyCodeOnly}
									onCopyUrl={handleCopyCode}
									onOpenQr={setQrDialogCode}
									onEdit={setEditingCode}
									onDelete={setDeleteDialogCode}
									formatDate={formatDate}
									formatUsage={formatUsage}
									t={t}
								/>
							))}
						</div>
					</>
				)}
			</CardContent>

			{/* Create/Edit Dialog */}
			<InviteCodeDialog
				organizationId={organizationId}
				inviteCode={editingCode}
				open={createDialogOpen || !!editingCode}
				onOpenChange={(open) => {
					if (!open) {
						setCreateDialogOpen(false);
						setEditingCode(null);
					}
				}}
			/>

			{/* QR Code Dialog */}
			<InviteCodeQRDialog
				inviteCode={qrDialogCode}
				organizationId={organizationId}
				inviteBaseUrl={inviteBaseUrl}
				open={!!qrDialogCode}
				onOpenChange={(open) => {
					if (!open) setQrDialogCode(null);
				}}
			/>

			{/* Delete Confirmation Dialog */}
			<AlertDialog
				open={!!deleteDialogCode}
				onOpenChange={(open) => !open && setDeleteDialogCode(null)}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.inviteCodes.deleteTitle", "Delete Invite Code")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.inviteCodes.deleteDescription",
								'Are you sure you want to delete the invite code "{code}"? This action cannot be undone.',
								{ code: deleteDialogCode?.code || "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => deleteDialogCode && deleteMutation.mutate(deleteDialogCode.id)}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deleteMutation.isPending ? (
								<IconLoader2 className="size-4 animate-spin mr-2" />
							) : (
								<IconTrash className="size-4 mr-2" />
							)}
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</Card>
	);
}
