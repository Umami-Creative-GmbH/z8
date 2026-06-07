import { IconBan, IconCheck, IconDevices, IconSearch, IconUser, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
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
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import type { PlatformUser, UserSession } from "@/lib/effect/services/platform-admin.service";

const USER_LOADING_ROW_KEYS = ["loading-1", "loading-2", "loading-3", "loading-4", "loading-5"];
const SESSION_LOADING_KEYS = ["session-loading-1", "session-loading-2", "session-loading-3"];

export type UserStatusFilter = "all" | "active" | "banned";

function getRedactedUserLabel(userId: string): string {
	return `User ${
		userId
			.replace(/^usr_/, "")
			.replace(/[^a-zA-Z0-9]/g, "")
			.slice(0, 6) || "redacted"
	}`;
}

export function PlatformAdminUsersPageHeader() {
	const { t } = useTranslate();

	return (
		<div className="space-y-1">
			<h1 className="text-2xl font-semibold tracking-tight">
				{t("admin:admin.users.title", "User Management")}
			</h1>
			<p className="text-muted-foreground">
				{t("admin:admin.users.description", "View and manage all users on the platform")}
			</p>
		</div>
	);
}

export function PlatformAdminUserFilters({
	search,
	status,
	onFilterChange,
}: {
	search: string;
	status: UserStatusFilter;
	onFilterChange: (search: string, status: UserStatusFilter) => void;
}) {
	const { t } = useTranslate();

	return (
		<div className="flex flex-col gap-4 sm:flex-row">
			<div className="relative flex-1">
				<IconSearch
					className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					aria-label={t("admin:admin.users.searchLabel", "Search users by email")}
					placeholder={t("admin:admin.users.searchPlaceholder", "Search by email…")}
					name="search"
					autoComplete="off"
					value={search}
					onChange={(event) => onFilterChange(event.target.value, status)}
					className="pl-9"
				/>
			</div>
			<Select value={status} onValueChange={(value) => onFilterChange(search, value as UserStatusFilter)}>
				<SelectTrigger className="w-full sm:w-40">
					<SelectValue placeholder={t("common.status", "Status")} />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">{t("admin:admin.users.filters.allUsers", "All Users")}</SelectItem>
					<SelectItem value="active">{t("common.active", "Active")}</SelectItem>
					<SelectItem value="banned">
						{t("admin:admin.users.filters.banned", "Banned")}
					</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

export function PlatformAdminUsersTable({
	users,
	isLoading,
	isPending,
	onViewSessions,
	onUnban,
	onOpenBan,
}: {
	users: PlatformUser[];
	isLoading: boolean;
	isPending: boolean;
	onViewSessions: (user: PlatformUser) => void;
	onUnban: (user: PlatformUser) => void;
	onOpenBan: (user: PlatformUser) => void;
}) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardContent className="p-0">
				{isLoading ? (
					<div className="p-6 space-y-3">
						{USER_LOADING_ROW_KEYS.map((key) => (
							<Skeleton key={key} className="h-14 w-full rounded-lg" />
						))}
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>{t("admin:admin.users.table.user", "User")}</TableHead>
								<TableHead>{t("admin:admin.users.table.organizations", "Organizations")}</TableHead>
								<TableHead>{t("admin:admin.users.table.role", "Role")}</TableHead>
								<TableHead>{t("common.status", "Status")}</TableHead>
								<TableHead>{t("admin:admin.users.table.created", "Created")}</TableHead>
								<TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.length === 0 ? (
								<TableRow>
									<TableCell colSpan={6} className="text-center text-muted-foreground">
										{t("admin:admin.users.table.noUsersFound", "No users found")}
									</TableCell>
								</TableRow>
							) : (
								users.map((user) => (
									<PlatformAdminUserTableRow
										key={user.id}
										user={user}
										isPending={isPending}
										onViewSessions={onViewSessions}
										onUnban={onUnban}
										onOpenBan={onOpenBan}
									/>
								))
							)}
						</TableBody>
					</Table>
				)}
			</CardContent>
		</Card>
	);
}

function PlatformAdminUserTableRow({
	user,
	isPending,
	onViewSessions,
	onUnban,
	onOpenBan,
}: {
	user: PlatformUser;
	isPending: boolean;
	onViewSessions: (user: PlatformUser) => void;
	onUnban: (user: PlatformUser) => void;
	onOpenBan: (user: PlatformUser) => void;
}) {
	const { t } = useTranslate();

	return (
		<TableRow>
			<TableCell>
				<div className="flex items-center gap-3">
					<div className="size-8 rounded-full bg-muted flex items-center justify-center">
						<IconUser className="size-4" aria-hidden="true" />
					</div>
					<div>
						<div className="font-medium">{getRedactedUserLabel(user.id)}</div>
						<div className="text-sm text-muted-foreground">{user.email}</div>
					</div>
				</div>
			</TableCell>
			<TableCell>
				{user.organizations.length > 0 ? (
					<div className="flex flex-wrap gap-1.5">
						{user.organizations.map((org) => (
							<Badge key={org.id} variant="outline" className="gap-1 font-normal">
								<span>{org.name}</span>
								<span className="text-muted-foreground">·</span>
								<span className="text-muted-foreground">{org.role}</span>
							</Badge>
						))}
					</div>
				) : (
					<span className="text-sm text-muted-foreground">
						{t("admin:admin.users.table.noOrganizations", "No organizations")}
					</span>
				)}
			</TableCell>
			<TableCell>
				{user.role === "admin" ? (
					<Badge variant="default">{t("admin:admin.users.badges.admin", "Admin")}</Badge>
				) : (
					<Badge variant="secondary">{t("admin:admin.users.badges.user", "User")}</Badge>
				)}
			</TableCell>
			<TableCell>
				{user.banned ? (
					<div>
						<Badge variant="destructive">{t("admin:admin.users.badges.banned", "Banned")}</Badge>
						{user.banExpires && (
							<div className="text-xs text-muted-foreground mt-1">
								{t("admin:admin.users.badges.banExpiresUntil", "Until {date}", {
									date: DateTime.fromJSDate(user.banExpires).toLocaleString(DateTime.DATE_SHORT),
								})}
							</div>
						)}
					</div>
				) : (
					<Badge variant="outline" className="border-green-500 text-green-700">
						<IconCheck className="size-3 mr-1" aria-hidden="true" />
						{t("common.active", "Active")}
					</Badge>
				)}
			</TableCell>
			<TableCell>{DateTime.fromJSDate(user.createdAt).toLocaleString(DateTime.DATE_MED)}</TableCell>
			<TableCell className="text-right">
				<div className="flex justify-end gap-2">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onViewSessions(user)}
						aria-label={t("admin:admin.users.sessionsDialog.title", "User Sessions")}
					>
						<IconDevices className="size-4" aria-hidden="true" />
					</Button>
					{user.banned ? (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onUnban(user)}
							disabled={isPending}
							aria-label={t("admin:admin.users.toasts.unbanned", "User {email} has been unbanned", {
								email: user.email,
							})}
						>
							<IconCheck className="size-4" aria-hidden="true" />
						</Button>
					) : (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onOpenBan(user)}
							disabled={user.role === "admin"}
							aria-label={t("admin:admin.users.banDialog.title", "Ban User")}
						>
							<IconBan className="size-4" aria-hidden="true" />
						</Button>
					)}
				</div>
			</TableCell>
		</TableRow>
	);
}

export function PlatformAdminUsersPagination({
	page,
	total,
	totalPages,
	pageSize,
	onPageChange,
}: {
	page: number;
	total: number;
	totalPages: number;
	pageSize: number;
	onPageChange: (page: number) => void;
}) {
	const { t } = useTranslate();

	if (totalPages <= 1) {
		return null;
	}

	return (
		<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<p className="text-sm text-muted-foreground">
				{t("admin:admin.users.pagination.showing", "Showing {from} to {to} of {total} users", {
					from: (page - 1) * pageSize + 1,
					to: Math.min(page * pageSize, total),
					total,
				})}
			</p>
			<div className="flex gap-2">
				<Button variant="outline" size="sm" onClick={() => onPageChange(page - 1)} disabled={page === 1}>
					{t("common.previous", "Previous")}
				</Button>
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(page + 1)}
					disabled={page >= totalPages}
				>
					{t("common.next", "Next")}
				</Button>
			</div>
		</div>
	);
}

export function PlatformAdminBanUserDialog({
	user,
	banReason,
	banExpiry,
	isPending,
	onReasonChange,
	onExpiryChange,
	onClose,
	onConfirm,
}: {
	user: PlatformUser | null;
	banReason: string;
	banExpiry: string;
	isPending: boolean;
	onReasonChange: (reason: string) => void;
	onExpiryChange: (expiry: string) => void;
	onClose: () => void;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();

	return (
		<AlertDialog open={user !== null} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>{t("admin:admin.users.banDialog.title", "Ban User")}</AlertDialogTitle>
					<AlertDialogDescription>
						{t("admin:admin.users.banDialog.description", "Ban {email} from accessing the platform.", {
							email: user?.email ?? "",
						})}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="reason">{t("admin:admin.users.banDialog.reason", "Reason")}</Label>
						<Textarea
							id="reason"
							placeholder={t(
								"admin:admin.users.banDialog.reasonPlaceholder",
								"Enter the reason for banning this user…",
							)}
							value={banReason}
							onChange={(event) => onReasonChange(event.target.value)}
						/>
					</div>
					<div className="space-y-2">
						<Label htmlFor="expiry">
							{t("admin:admin.users.banDialog.expiry", "Expiry Date (optional)")}
						</Label>
						<Input
							id="expiry"
							type="datetime-local"
							value={banExpiry}
							onChange={(event) => onExpiryChange(event.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							{t("admin:admin.users.banDialog.permanentBanHint", "Leave empty for permanent ban")}
						</p>
					</div>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onClose}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction asChild>
						<Button
							variant="destructive"
							onClick={(event) => {
								event.preventDefault();
								onConfirm();
							}}
							disabled={!banReason || isPending}
						>
							{t("admin:admin.users.banDialog.confirmButton", "Ban User")}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

export function PlatformAdminUserSessionsPanel({
	user,
	sessions,
	sessionsLoading,
	isPending,
	onClose,
	onRevokeSession,
	onRevokeAllSessions,
}: {
	user: PlatformUser | null;
	sessions: UserSession[];
	sessionsLoading: boolean;
	isPending: boolean;
	onClose: () => void;
	onRevokeSession: (sessionId: string) => void;
	onRevokeAllSessions: () => void;
}) {
	const { t } = useTranslate();

	return (
		<ActionPanel open={user !== null} onOpenChange={(open) => !open && onClose()}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle>
						{t("admin:admin.users.sessionsDialog.title", "User Sessions")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t("admin:admin.users.sessionsDialog.description", "Active sessions for {email}", {
							email: user?.email ?? "",
						})}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="py-4">
					{sessionsLoading ? (
						<div className="space-y-2">
							{SESSION_LOADING_KEYS.map((key) => (
								<Skeleton key={key} className="h-12 w-full" />
							))}
						</div>
					) : sessions.length === 0 ? (
						<p className="text-center text-muted-foreground py-8">
							{t("admin:admin.users.sessionsDialog.noSessions", "No active sessions")}
						</p>
					) : (
						<div className="space-y-2">
							{sessions.map((session) => (
								<PlatformAdminSessionRow
									key={session.id}
									session={session}
									isPending={isPending}
									onRevokeSession={onRevokeSession}
								/>
							))}
						</div>
					)}
				</ActionPanelBody>
				<ActionPanelFooter>
					<Button variant="outline" onClick={onClose}>
						{t("common.close", "Close")}
					</Button>
					{sessions.length > 0 && (
						<Button variant="destructive" onClick={onRevokeAllSessions} disabled={isPending}>
							{t("admin:admin.users.sessionsDialog.revokeAll", "Revoke All Sessions")}
						</Button>
					)}
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function PlatformAdminSessionRow({
	session,
	isPending,
	onRevokeSession,
}: {
	session: UserSession;
	isPending: boolean;
	onRevokeSession: (sessionId: string) => void;
}) {
	const { t } = useTranslate();

	return (
		<div className="flex items-center justify-between p-3 rounded-lg border">
			<div>
				<div className="font-medium text-sm">
					{session.userAgent
						? `${session.userAgent.substring(0, 50)}…`
						: t("admin:admin.users.sessionsDialog.unknownDevice", "Unknown device")}
				</div>
				<div className="text-xs text-muted-foreground">
					{session.ipAddress ?? t("admin:admin.users.sessionsDialog.unknownIp", "Unknown IP")} • Created{" "}
					{DateTime.fromJSDate(session.createdAt).toRelative()}
				</div>
			</div>
			<Button
				variant="ghost"
				size="sm"
				onClick={() => onRevokeSession(session.id)}
				disabled={isPending}
				aria-label={t("admin:admin.users.toasts.sessionRevoked", "Session revoked")}
			>
				<IconX className="size-4" aria-hidden="true" />
			</Button>
		</div>
	);
}
