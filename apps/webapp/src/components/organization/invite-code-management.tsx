"use client";

import {
	IconCheck,
	IconCopy,
	IconLoader2,
	IconPlus,
	IconQrcode,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import type { InviteCodeWithRelations } from "@/app/[locale]/(app)/settings/organization/invite-code-actions";
import {
	deleteInviteCode,
	getInviteBaseUrl,
	listInviteCodes,
} from "@/app/[locale]/(app)/settings/organization/invite-code-actions";
import { useConfirmedAction } from "@/components/settings/confirm-action-dialog";
import { describeFailure } from "@/components/settings/confirm-action-utils";
import { DeleteConfirmDialog } from "@/components/settings/delete-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { EditDeleteMenu } from "@/components/ui/edit-delete-menu";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDisplayContext } from "@/hooks/use-display-context";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import {
	meetsSettingsAccess,
	type SettingsAccess,
} from "@/lib/organization-action/settings-access-level";
import { queryKeys } from "@/lib/query";
import { InviteCodeDialog } from "./invite-code-dialog";
import { InviteCodeQRDialog } from "./invite-code-qr-dialog";

interface InviteCodeManagementProps {
	organizationId: string;
	organizationToday: string;
	/** The viewer's settings access, worked out on the server (ADR 0002). */
	settingsAccess: SettingsAccess | null;
}

// Semantic status tints; the badge always carries the status label as text.
const statusColors = {
	active: "border-success/40 bg-success/10 text-success",
	paused: "border-warning/40 bg-warning/10 text-warning",
	expired: "border-destructive/40 bg-destructive/10 text-destructive",
	archived: "",
};

function formatUsage(code: InviteCodeWithRelations) {
	if (code.maxUses === null) {
		return `${code.currentUses} / ∞`;
	}
	return `${code.currentUses} / ${code.maxUses}`;
}

function InviteCodeMobileCard({
	code,
	copiedCode,
	onCopyCode,
	onCopyUrl,
	onOpenQr,
	onEdit,
	onDelete,
	urlActionsDisabled,
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
	urlActionsDisabled: boolean;
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
								<IconCheck className="size-4 text-success" aria-hidden="true" />
							) : (
								<IconCopy className="size-4" aria-hidden="true" />
							)}
						</Button>
					</div>
					<div className="truncate font-medium">{code.label}</div>
					{code.description && (
						<div className="line-clamp-2 text-sm text-muted-foreground">
							{code.description}
						</div>
					)}
				</div>

				<EditDeleteMenu
					onEdit={() => onEdit(code)}
					onDelete={() => onDelete(code)}
				/>
			</div>

			<div className="mt-4 grid grid-cols-2 gap-3 text-sm">
				<div>
					<div className="text-muted-foreground">
						{t("settings.inviteCodes.targetTeam", "Target team")}
					</div>
					<div className="font-medium">{code.defaultTeam?.name || "-"}</div>
				</div>
				<div>
					<div className="text-muted-foreground">
						{t("settings.inviteCodes.status", "Status")}
					</div>
					<Badge variant="secondary" className={statusColors[code.status]}>
						{t(`settings.inviteCodes.status.${code.status}`, code.status)}
					</Badge>
				</div>
				<div>
					<div className="text-muted-foreground">
						{t("settings.inviteCodes.usage", "Usage")}
					</div>
					<div className="font-medium">{formatUsage(code)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">
						{t("settings.inviteCodes.expires", "Expires")}
					</div>
					<div className="font-medium">{formatDate(code.expiresAt)}</div>
				</div>
				<div>
					<div className="text-muted-foreground">
						{t("settings.inviteCodes.approval", "Approval")}
					</div>
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
					disabled={urlActionsDisabled}
				>
					<IconCopy className="mr-2 size-4" aria-hidden="true" />
					{t("settings.inviteCodes.copyUrl", "Copy invite URL")}
				</Button>
				<Button
					variant="outline"
					className="min-w-0 whitespace-normal text-center"
					onClick={() => onOpenQr(code)}
					disabled={urlActionsDisabled}
				>
					<IconQrcode className="mr-2 size-4" aria-hidden="true" />
					{t("settings.inviteCodes.qrCode", "QR Code")}
				</Button>
			</div>
		</div>
	);
}

function InviteCodeDesktopTable({
	inviteCodes,
	copiedCode,
	urlActionsDisabled,
	formatDate,
	onCopyCode,
	onCopyUrl,
	onOpenQr,
	onEdit,
	onDelete,
	t,
}: {
	inviteCodes: InviteCodeWithRelations[];
	copiedCode: string | null;
	urlActionsDisabled: boolean;
	formatDate: (date: Date | null | undefined) => string;
	onCopyCode: (code: string) => void;
	onCopyUrl: (code: string) => void;
	onOpenQr: (code: InviteCodeWithRelations) => void;
	onEdit: (code: InviteCodeWithRelations) => void;
	onDelete: (code: InviteCodeWithRelations) => void;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<div className="hidden md:block">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>{t("settings.inviteCodes.code", "Code")}</TableHead>
						<TableHead>{t("settings.inviteCodes.label", "Label")}</TableHead>
						<TableHead>
							{t("settings.inviteCodes.targetTeam", "Target team")}
						</TableHead>
						<TableHead>{t("settings.inviteCodes.status", "Status")}</TableHead>
						<TableHead>{t("settings.inviteCodes.usage", "Usage")}</TableHead>
						<TableHead>
							{t("settings.inviteCodes.expires", "Expires")}
						</TableHead>
						<TableHead>
							{t("settings.inviteCodes.approval", "Approval")}
						</TableHead>
						<TableHead className="text-right">
							{t("common.actions", "Actions")}
						</TableHead>
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
												onClick={() => onCopyCode(code.code)}
												aria-label={t(
													"settings.inviteCodes.copyCode",
													"Copy code",
												)}
											>
												{copiedCode === code.code ? (
													<IconCheck className="size-4 text-success" aria-hidden="true" />
												) : (
													<IconCopy className="size-4" aria-hidden="true" />
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
							<TableCell>{code.defaultTeam?.name || "-"}</TableCell>
							<TableCell>
								<Badge
									variant="secondary"
									className={statusColors[code.status]}
								>
									{t(`settings.inviteCodes.status.${code.status}`, code.status)}
								</Badge>
							</TableCell>
							<TableCell>{formatUsage(code)}</TableCell>
							<TableCell>{formatDate(code.expiresAt)}</TableCell>
							<TableCell>
								<Badge
									variant={code.requiresApproval ? "default" : "secondary"}
								>
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
												onClick={() => onCopyUrl(code.code)}
												disabled={urlActionsDisabled}
												aria-label={t(
													"settings.inviteCodes.copyUrl",
													"Copy invite URL",
												)}
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
												onClick={() => onOpenQr(code)}
												disabled={urlActionsDisabled}
												aria-label={t("settings.inviteCodes.qrCode", "QR Code")}
											>
												<IconQrcode className="size-4" />
											</Button>
										</TooltipTrigger>
										<TooltipContent>
											{t("settings.inviteCodes.qrCode", "QR Code")}
										</TooltipContent>
									</Tooltip>
									<EditDeleteMenu
										onEdit={() => onEdit(code)}
										onDelete={() => onDelete(code)}
									/>
								</div>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function InviteCodeDialogStack({
	organizationId,
	organizationToday,
	inviteBaseUrl,
	createDialogOpen,
	editingCode,
	qrDialogCode,
	deleteDialogCode,
	deleteOpen,
	deletePending,
	deleteError,
	onCloseEditor,
	onCloseQr,
	onDeleteOpenChange,
	onDelete,
	t,
}: {
	organizationId: string;
	organizationToday: string;
	inviteBaseUrl: string;
	createDialogOpen: boolean;
	editingCode: InviteCodeWithRelations | null;
	qrDialogCode: InviteCodeWithRelations | null;
	deleteDialogCode: InviteCodeWithRelations | null;
	deleteOpen: boolean;
	deletePending: boolean;
	deleteError: string | null;
	onCloseEditor: () => void;
	onCloseQr: () => void;
	onDeleteOpenChange: (open: boolean) => void;
	onDelete: () => void;
	t: ReturnType<typeof useTranslate>["t"];
}) {
	return (
		<>
			<InviteCodeDialog
				organizationId={organizationId}
				minExpiryDate={organizationToday}
				inviteCode={editingCode}
				open={createDialogOpen || !!editingCode}
				onOpenChange={(open) => !open && onCloseEditor()}
			/>
			<InviteCodeQRDialog
				inviteCode={qrDialogCode}
				inviteBaseUrl={inviteBaseUrl}
				open={!!qrDialogCode}
				onOpenChange={(open) => !open && onCloseQr()}
			/>
			<DeleteConfirmDialog
				open={deleteOpen}
				onOpenChange={onDeleteOpenChange}
				title={t("settings.inviteCodes.deleteTitle", "Delete Invite Code")}
				description={t(
					"settings.inviteCodes.deleteDescription",
					'Are you sure you want to delete the invite code "{code}"? This action cannot be undone.',
					{ code: deleteDialogCode?.code || "" },
				)}
				isDeleting={deletePending}
				error={deleteError}
				onConfirm={onDelete}
			/>
		</>
	);
}

export function InviteCodeManagement({
	organizationId,
	organizationToday,
	settingsAccess,
}: InviteCodeManagementProps) {
	const { t } = useTranslate();
	const displayContext = useDisplayContext();
	const queryClient = useQueryClient();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editingCode, setEditingCode] =
		useState<InviteCodeWithRelations | null>(null);
	const [qrDialogCode, setQrDialogCode] =
		useState<InviteCodeWithRelations | null>(null);
	const deletion = useConfirmedAction<InviteCodeWithRelations>();
	const [copiedCode, setCopiedCode] = useState<string | null>(null);

	const canManage =
		meetsSettingsAccess(settingsAccess, "orgAdmin");

	// Fetch invite codes
	const { data: inviteCodesResult, isLoading } = useQuery({
		queryKey: queryKeys.inviteCodes.list(organizationId),
		queryFn: () => listInviteCodes(),
	});

	const inviteCodes = inviteCodesResult?.success ? inviteCodesResult.data : [];

	const { data: inviteBaseUrlResult } = useQuery({
		queryKey: ["invite-base-url", organizationId],
		queryFn: () => getInviteBaseUrl(),
		enabled: canManage,
	});

	const inviteBaseUrl =
		inviteBaseUrlResult?.success && inviteBaseUrlResult.data
			? inviteBaseUrlResult.data
			: "";
	const urlActionsDisabled = !inviteBaseUrl;
	const formatDate = (date: Date | null | undefined) =>
		date
			? formatInstant(instantFromDate(date), displayContext, "dateMedium")
			: "-";

	// Delete mutation
	const deleteMutation = useMutation({
		mutationFn: async (inviteCodeId: string) => {
			const result = await deleteInviteCode(inviteCodeId);
			if (!result.success) throw new Error(result.error || "Failed to delete");
		},
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeys.inviteCodes.list(organizationId),
			});
			toast.success(t("settings.inviteCodes.deleted", "Invite code deleted"));
		},
		// A failure is shown inside the confirmation dialog, which stays open for a retry.
	});

	const handleCopyCode = async (code: string) => {
		if (!inviteBaseUrl) return;
		const joinUrl = `${inviteBaseUrl}/join/${code}`;
		await navigator.clipboard.writeText(joinUrl);
		setCopiedCode(code);
		toast.success(
			t("settings.inviteCodes.urlCopied", "Invite URL copied to clipboard"),
		);
		setTimeout(() => setCopiedCode(null), 2000);
	};

	const handleCopyCodeOnly = async (code: string) => {
		await navigator.clipboard.writeText(code);
		setCopiedCode(code);
		toast.success(t("settings.inviteCodes.codeCopied", "Invite code copied"));
		setTimeout(() => setCopiedCode(null), 2000);
	};

	if (!canManage) {
		return null;
	}

	return (
		<Card>
			<CardHeader>
				<div className="flex items-start justify-between">
					<div>
						<CardTitle>
							{t("settings.inviteCodes.title", "Invite Codes")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.inviteCodes.description",
								"Create shareable codes for users to join your organization",
							)}
						</CardDescription>
					</div>
					<Button
						onClick={() => setCreateDialogOpen(true)}
						className="shrink-0 px-2 sm:px-4"
					>
						<IconPlus className="size-4" aria-hidden="true" />
						{t("settings.inviteCodes.createCode", "Create Code")}
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
						{t(
							"settings.inviteCodes.noCodes",
							"No invite codes yet. Create one to get started.",
						)}
					</div>
				) : (
					<>
						<InviteCodeDesktopTable
							inviteCodes={inviteCodes}
							copiedCode={copiedCode}
							urlActionsDisabled={urlActionsDisabled}
							formatDate={formatDate}
							onCopyCode={handleCopyCodeOnly}
							onCopyUrl={handleCopyCode}
							onOpenQr={setQrDialogCode}
							onEdit={setEditingCode}
							onDelete={deletion.request}
							t={t}
						/>
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
									onDelete={deletion.request}
									urlActionsDisabled={urlActionsDisabled}
									formatDate={formatDate}
									formatUsage={formatUsage}
									t={t}
								/>
							))}
						</div>
					</>
				)}
			</CardContent>

			<InviteCodeDialogStack
				organizationId={organizationId}
				organizationToday={organizationToday}
				inviteBaseUrl={inviteBaseUrl}
				createDialogOpen={createDialogOpen}
				editingCode={editingCode}
				qrDialogCode={qrDialogCode}
				deleteDialogCode={deletion.target}
				deleteOpen={deletion.open}
				deletePending={deletion.isPending}
				deleteError={deletion.error}
				onCloseEditor={() => {
					setCreateDialogOpen(false);
					setEditingCode(null);
				}}
				onCloseQr={() => setQrDialogCode(null)}
				onDeleteOpenChange={deletion.onOpenChange}
				onDelete={() =>
					void deletion.confirm(
						(code) => deleteMutation.mutateAsync(code.id),
						(failure) =>
							describeFailure(
								failure,
								t("settings.inviteCodes.deleteFailed", "Failed to delete invite code"),
							),
					)
				}
				t={t}
			/>
		</Card>
	);
}
