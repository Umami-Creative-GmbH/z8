"use client";

import { IconBan, IconCheck, IconDevices, IconSearch, IconUser, IconX } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
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
import { useRouter } from "@/navigation";
import {
	banUserAction,
	listUserSessionsAction,
	listUsersAction,
	revokeAllUserSessionsAction,
	revokeSessionAction,
	unbanUserAction,
} from "./actions";

const PAGE_SIZE = 20;
const LOADING_ROW_KEYS = ["loading-1", "loading-2", "loading-3", "loading-4", "loading-5"];
const SESSION_LOADING_KEYS = ["session-loading-1", "session-loading-2", "session-loading-3"];
type UserStatusFilter = "all" | "active" | "banned";

function getUserStatusFilter(status: string | null): UserStatusFilter {
	return status === "active" || status === "banned" ? status : "all";
}

function getRedactedUserLabel(userId: string): string {
	return `User ${
		userId
			.replace(/^usr_/, "")
			.replace(/[^a-zA-Z0-9]/g, "")
			.slice(0, 6) || "redacted"
	}`;
}

export default function UsersPage() {
	return (
		<Suspense fallback={<UsersPageSkeleton />}>
			<UsersPageBody />
		</Suspense>
	);
}

function UsersPageSkeleton() {
	return (
		<div className="space-y-8">
			<div className="space-y-2">
				<Skeleton className="h-8 w-52" />
				<Skeleton className="h-5 w-full max-w-lg" />
			</div>
			<div className="flex flex-col gap-4 sm:flex-row">
				<Skeleton className="h-10 flex-1" />
				<Skeleton className="h-10 w-full sm:w-40" />
			</div>
			<Card>
				<CardContent className="space-y-3 p-6">
					{LOADING_ROW_KEYS.map((key) => (
						<Skeleton key={key} className="h-14 w-full rounded-lg" />
					))}
				</CardContent>
			</Card>
		</div>
	);
}

function UsersPageBody() {
	const searchParams = useSearchParams();
	const initialSearch = searchParams.get("search") ?? "";
	const initialStatus = getUserStatusFilter(searchParams.get("status"));
	const initialOrganizationId = searchParams.get("organizationId") ?? "";
	const stateKey = `${initialSearch}:${initialStatus}:${initialOrganizationId}`;

	return (
		<UsersPageContent
			key={stateKey}
			initialSearch={initialSearch}
			initialStatus={initialStatus}
			initialOrganizationId={initialOrganizationId}
		/>
	);
}

function UsersPageContent({
	initialSearch,
	initialStatus,
	initialOrganizationId,
}: {
	initialSearch: string;
	initialStatus: UserStatusFilter;
	initialOrganizationId: string;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();

	const [page, setPage] = useState(1);
	const [search, setSearch] = useState(initialSearch);
	const [status, setStatus] = useState<UserStatusFilter>(initialStatus);
	const [organizationId] = useState(initialOrganizationId);
	const [isPending, startTransition] = useTransition();
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// ActionPanel states
	const [banDialogUser, setBanDialogUser] = useState<PlatformUser | null>(null);
	const [banReason, setBanReason] = useState("");
	const [banExpiry, setBanExpiry] = useState("");
	const [sessionsDialogUser, setSessionsDialogUser] = useState<PlatformUser | null>(null);
	const [sessions, setSessions] = useState<UserSession[]>([]);
	const [sessionsLoading, setSessionsLoading] = useState(false);

	const { data, isLoading } = useQuery({
		queryKey: ["admin-users", search, status, organizationId, page],
		queryFn: async () => {
			const result = await listUsersAction(
				{ search, status, organizationId: organizationId || undefined },
				page,
				PAGE_SIZE,
			);
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		retry: false,
	});

	const users = data?.data ?? [];
	const total = data?.total ?? 0;

	// Debounced search with immediate status change
	const handleFilterChange = (newSearch: string, newStatus: UserStatusFilter) => {
		// Clear any pending search timeout
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current);
		}

		setSearch(newSearch);

		// If only status changed, fetch immediately
		if (newStatus !== status) {
			setStatus(newStatus);
			setPage(1);
			const params = new URLSearchParams();
			if (newSearch) params.set("search", newSearch);
			if (newStatus !== "all") params.set("status", newStatus);
			if (organizationId) params.set("organizationId", organizationId);
			router.push(`/platform-admin/users?${params.toString()}`);
			return;
		}

		// Debounce search input (300ms)
		searchTimeoutRef.current = setTimeout(() => {
			setPage(1);
			const params = new URLSearchParams();
			if (newSearch) params.set("search", newSearch);
			if (newStatus !== "all") params.set("status", newStatus);
			if (organizationId) params.set("organizationId", organizationId);
			router.push(`/platform-admin/users?${params.toString()}`);
		}, 300);
	};

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (searchTimeoutRef.current) {
				clearTimeout(searchTimeoutRef.current);
			}
		};
	}, []);

	// Ban user
	const handleBan = async () => {
		if (!banDialogUser) return;

		startTransition(async () => {
			const result = await banUserAction(banDialogUser.id, banReason, banExpiry || null);
			if (result.success) {
				toast.success(
					t("admin:admin.users.toasts.banned", "User {email} has been banned", {
						email: banDialogUser.email,
					}),
				);
				setBanDialogUser(null);
				setBanReason("");
				setBanExpiry("");
				queryClient.invalidateQueries({ queryKey: ["admin-users"] });
			} else {
				toast.error(result.error);
			}
		});
	};

	// Unban user
	const handleUnban = async (user: PlatformUser) => {
		startTransition(async () => {
			const result = await unbanUserAction(user.id);
			if (result.success) {
				toast.success(
					t("admin:admin.users.toasts.unbanned", "User {email} has been unbanned", {
						email: user.email,
					}),
				);
				queryClient.invalidateQueries({ queryKey: ["admin-users"] });
			} else {
				toast.error(result.error);
			}
		});
	};

	// Open sessions dialog
	const handleViewSessions = async (user: PlatformUser) => {
		setSessionsDialogUser(user);
		setSessionsLoading(true);
		const result = await listUserSessionsAction(user.id);
		if (result.success) {
			setSessions(result.data);
		} else {
			toast.error(result.error);
		}
		setSessionsLoading(false);
	};

	// Revoke session
	const handleRevokeSession = async (sessionId: string) => {
		startTransition(async () => {
			const result = await revokeSessionAction(sessionId);
			if (result.success) {
				toast.success(t("admin:admin.users.toasts.sessionRevoked", "Session revoked"));
				setSessions(sessions.filter((s) => s.id !== sessionId));
			} else {
				toast.error(result.error);
			}
		});
	};

	// Revoke all sessions
	const handleRevokeAllSessions = async () => {
		if (!sessionsDialogUser) return;

		startTransition(async () => {
			const result = await revokeAllUserSessionsAction(sessionsDialogUser.id);
			if (result.success) {
				toast.success(
					t("admin:admin.users.toasts.sessionsRevoked", "Revoked {count} sessions", {
						count: result.data,
					}),
				);
				setSessions([]);
			} else {
				toast.error(result.error);
			}
		});
	};

	const totalPages = Math.ceil(total / PAGE_SIZE);

	return (
		<div className="space-y-8">
			{/* Page Header */}
			<div className="space-y-1">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("admin:admin.users.title", "User Management")}
				</h1>
				<p className="text-muted-foreground">
					{t("admin:admin.users.description", "View and manage all users on the platform")}
				</p>
			</div>

			{/* Filters */}
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
						onChange={(e) => handleFilterChange(e.target.value, status)}
						className="pl-9"
					/>
				</div>
				<Select
					value={status}
					onValueChange={(v) => handleFilterChange(search, v as UserStatusFilter)}
				>
					<SelectTrigger className="w-full sm:w-40">
						<SelectValue placeholder={t("common.status", "Status")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">
							{t("admin:admin.users.filters.allUsers", "All Users")}
						</SelectItem>
						<SelectItem value="active">{t("common.active", "Active")}</SelectItem>
						<SelectItem value="banned">
							{t("admin:admin.users.filters.banned", "Banned")}
						</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Users Table */}
			<Card>
				<CardContent className="p-0">
					{isLoading ? (
						<div className="p-6 space-y-3">
							{LOADING_ROW_KEYS.map((key) => (
								<Skeleton key={key} className="h-14 w-full rounded-lg" />
							))}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("admin:admin.users.table.user", "User")}</TableHead>
									<TableHead>
										{t("admin:admin.users.table.organizations", "Organizations")}
									</TableHead>
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
										<TableRow key={user.id}>
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
													<Badge variant="default">
														{t("admin:admin.users.badges.admin", "Admin")}
													</Badge>
												) : (
													<Badge variant="secondary">
														{t("admin:admin.users.badges.user", "User")}
													</Badge>
												)}
											</TableCell>
											<TableCell>
												{user.banned ? (
													<div>
														<Badge variant="destructive">
															{t("admin:admin.users.badges.banned", "Banned")}
														</Badge>
														{user.banExpires && (
															<div className="text-xs text-muted-foreground mt-1">
																{t("admin:admin.users.badges.banExpiresUntil", "Until {date}", {
																	date: DateTime.fromJSDate(user.banExpires).toLocaleString(
																		DateTime.DATE_SHORT,
																	),
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
											<TableCell>
												{DateTime.fromJSDate(user.createdAt).toLocaleString(DateTime.DATE_MED)}
											</TableCell>
											<TableCell className="text-right">
												<div className="flex justify-end gap-2">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleViewSessions(user)}
														aria-label={t(
															"admin:admin.users.sessionsDialog.title",
															"User Sessions",
														)}
													>
														<IconDevices className="size-4" aria-hidden="true" />
													</Button>
													{user.banned ? (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleUnban(user)}
															disabled={isPending}
															aria-label={t(
																"admin:admin.users.toasts.unbanned",
																"User {email} has been unbanned",
																{ email: user.email },
															)}
														>
															<IconCheck className="size-4" aria-hidden="true" />
														</Button>
													) : (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => setBanDialogUser(user)}
															disabled={user.role === "admin"}
															aria-label={t("admin:admin.users.banDialog.title", "Ban User")}
														>
															<IconBan className="size-4" aria-hidden="true" />
														</Button>
													)}
												</div>
											</TableCell>
										</TableRow>
									))
								)}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<p className="text-sm text-muted-foreground">
						{t("admin:admin.users.pagination.showing", "Showing {from} to {to} of {total} users", {
							from: (page - 1) * PAGE_SIZE + 1,
							to: Math.min(page * PAGE_SIZE, total),
							total,
						})}
					</p>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								const newPage = page - 1;
								setPage(newPage);
							}}
							disabled={page === 1}
						>
							{t("common.previous", "Previous")}
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								const newPage = page + 1;
								setPage(newPage);
							}}
							disabled={page >= totalPages}
						>
							{t("common.next", "Next")}
						</Button>
					</div>
				</div>
			)}

			{/* Ban confirmation */}
			<AlertDialog open={!!banDialogUser} onOpenChange={() => setBanDialogUser(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("admin:admin.users.banDialog.title", "Ban User")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"admin:admin.users.banDialog.description",
								"Ban {email} from accessing the platform.",
								{
									email: banDialogUser?.email ?? "",
								},
							)}
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
								onChange={(e) => setBanReason(e.target.value)}
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
								onChange={(e) => setBanExpiry(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">
								{t("admin:admin.users.banDialog.permanentBanHint", "Leave empty for permanent ban")}
							</p>
						</div>
					</div>
					<AlertDialogFooter>
						<AlertDialogCancel onClick={() => setBanDialogUser(null)}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction asChild>
							<Button
								variant="destructive"
								onClick={(event) => {
									event.preventDefault();
									handleBan();
								}}
								disabled={!banReason || isPending}
							>
								{t("admin:admin.users.banDialog.confirmButton", "Ban User")}
							</Button>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			{/* Sessions ActionPanel */}
			<ActionPanel open={!!sessionsDialogUser} onOpenChange={() => setSessionsDialogUser(null)}>
				<ActionPanelContent size="wide">
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("admin:admin.users.sessionsDialog.title", "User Sessions")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t("admin:admin.users.sessionsDialog.description", "Active sessions for {email}", {
								email: sessionsDialogUser?.email ?? "",
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
									<div
										key={session.id}
										className="flex items-center justify-between p-3 rounded-lg border"
									>
										<div>
											<div className="font-medium text-sm">
												{session.userAgent
													? `${session.userAgent.substring(0, 50)}…`
													: t("admin:admin.users.sessionsDialog.unknownDevice", "Unknown device")}
											</div>
											<div className="text-xs text-muted-foreground">
												{session.ipAddress ??
													t("admin:admin.users.sessionsDialog.unknownIp", "Unknown IP")}{" "}
												• Created {DateTime.fromJSDate(session.createdAt).toRelative()}
											</div>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => handleRevokeSession(session.id)}
											disabled={isPending}
											aria-label={t("admin:admin.users.toasts.sessionRevoked", "Session revoked")}
										>
											<IconX className="size-4" aria-hidden="true" />
										</Button>
									</div>
								))}
							</div>
						)}
					</ActionPanelBody>
					<ActionPanelFooter>
						<Button variant="outline" onClick={() => setSessionsDialogUser(null)}>
							{t("common.close", "Close")}
						</Button>
						{sessions.length > 0 && (
							<Button variant="destructive" onClick={handleRevokeAllSessions} disabled={isPending}>
								{t("admin:admin.users.sessionsDialog.revokeAll", "Revoke All Sessions")}
							</Button>
						)}
					</ActionPanelFooter>
				</ActionPanelContent>
			</ActionPanel>
		</div>
	);
}
