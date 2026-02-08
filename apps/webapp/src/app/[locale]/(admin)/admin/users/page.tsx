"use client";

import { IconBan, IconCheck, IconDevices, IconSearch, IconUser, IconX } from "@tabler/icons-react";
import { DateTime } from "luxon";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export default function UsersPage() {
	const router = useRouter();
	const searchParams = useSearchParams();

	const [users, setUsers] = useState<PlatformUser[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState(searchParams.get("search") ?? "");
	const [status, setStatus] = useState<"all" | "active" | "banned">(
		(searchParams.get("status") as "all" | "active" | "banned") ?? "all",
	);
	const [isLoading, setIsLoading] = useState(true);
	const [isPending, startTransition] = useTransition();
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Dialog states
	const [banDialogUser, setBanDialogUser] = useState<PlatformUser | null>(null);
	const [banReason, setBanReason] = useState("");
	const [banExpiry, setBanExpiry] = useState("");
	const [sessionsDialogUser, setSessionsDialogUser] = useState<PlatformUser | null>(null);
	const [sessions, setSessions] = useState<UserSession[]>([]);
	const [sessionsLoading, setSessionsLoading] = useState(false);

	// Fetch users with explicit parameters to avoid race conditions
	const fetchUsers = async (searchVal = search, statusVal = status, pageVal = page) => {
		setIsLoading(true);
		const result = await listUsersAction(
			{ search: searchVal, status: statusVal },
			pageVal,
			PAGE_SIZE,
		);
		if (result.success) {
			setUsers(result.data.data);
			setTotal(result.data.total);
		} else {
			toast.error(result.error);
		}
		setIsLoading(false);
	};

	// Initial load
	useEffect(() => {
		fetchUsers();
	}, []);

	// Debounced search with immediate status change
	const handleFilterChange = useCallback(
		(newSearch: string, newStatus: "all" | "active" | "banned") => {
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
				router.push(`/admin/users?${params.toString()}`);
				startTransition(() => {
					fetchUsers(newSearch, newStatus, 1);
				});
				return;
			}

			// Debounce search input (300ms)
			searchTimeoutRef.current = setTimeout(() => {
				setPage(1);
				const params = new URLSearchParams();
				if (newSearch) params.set("search", newSearch);
				if (newStatus !== "all") params.set("status", newStatus);
				router.push(`/admin/users?${params.toString()}`);
				startTransition(() => {
					fetchUsers(newSearch, newStatus, 1);
				});
			}, 300);
		},
		[status, router],
	);

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
				toast.success(`User ${banDialogUser.email} has been banned`);
				setBanDialogUser(null);
				setBanReason("");
				setBanExpiry("");
				fetchUsers();
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
				toast.success(`User ${user.email} has been unbanned`);
				fetchUsers();
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
				toast.success("Session revoked");
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
				toast.success(`Revoked ${result.data} sessions`);
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
				<h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
				<p className="text-muted-foreground">View and manage all users on the platform</p>
			</div>

			{/* Filters */}
			<div className="flex flex-col gap-4 sm:flex-row">
				<div className="relative flex-1">
					<IconSearch
						className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
						aria-hidden="true"
					/>
					<Input
						placeholder="Search by name or email…"
						name="search"
						autoComplete="off"
						value={search}
						onChange={(e) => handleFilterChange(e.target.value, status)}
						className="pl-9"
					/>
				</div>
				<Select
					value={status}
					onValueChange={(v) => handleFilterChange(search, v as "all" | "active" | "banned")}
				>
					<SelectTrigger className="w-full sm:w-40">
						<SelectValue placeholder="Status" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All Users</SelectItem>
						<SelectItem value="active">Active</SelectItem>
						<SelectItem value="banned">Banned</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Users Table */}
			<Card>
				<CardContent className="p-0">
					{isLoading ? (
						<div className="p-6 space-y-3">
							{[...Array(5)].map((_, i) => (
								<Skeleton key={i} className="h-14 w-full rounded-lg" />
							))}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>User</TableHead>
									<TableHead>Role</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Created</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{users.length === 0 ? (
									<TableRow>
										<TableCell colSpan={5} className="text-center text-muted-foreground">
											No users found
										</TableCell>
									</TableRow>
								) : (
									users.map((user) => (
										<TableRow key={user.id}>
											<TableCell>
												<div className="flex items-center gap-3">
													<div className="size-8 rounded-full bg-muted flex items-center justify-center">
														{user.image ? (
															<img
																src={user.image}
																alt={user.name}
																width={32}
																height={32}
																className="size-8 rounded-full"
															/>
														) : (
															<IconUser className="size-4" aria-hidden="true" />
														)}
													</div>
													<div>
														<div className="font-medium">{user.name}</div>
														<div className="text-sm text-muted-foreground">{user.email}</div>
													</div>
												</div>
											</TableCell>
											<TableCell>
												{user.role === "admin" ? (
													<Badge variant="default">Admin</Badge>
												) : (
													<Badge variant="secondary">User</Badge>
												)}
											</TableCell>
											<TableCell>
												{user.banned ? (
													<div>
														<Badge variant="destructive">Banned</Badge>
														{user.banExpires && (
															<div className="text-xs text-muted-foreground mt-1">
																Until{" "}
																{DateTime.fromJSDate(user.banExpires).toLocaleString(
																	DateTime.DATE_SHORT,
																)}
															</div>
														)}
													</div>
												) : (
													<Badge variant="outline" className="border-green-500 text-green-700">
														<IconCheck className="size-3 mr-1" aria-hidden="true" />
														Active
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
														aria-label="View sessions"
													>
														<IconDevices className="size-4" aria-hidden="true" />
													</Button>
													{user.banned ? (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => handleUnban(user)}
															disabled={isPending}
															aria-label="Unban user"
														>
															<IconCheck className="size-4" aria-hidden="true" />
														</Button>
													) : (
														<Button
															variant="ghost"
															size="sm"
															onClick={() => setBanDialogUser(user)}
															disabled={user.role === "admin"}
															aria-label="Ban user"
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
						Showing{" "}
						<span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}</span> to{" "}
						<span className="font-medium text-foreground">{Math.min(page * PAGE_SIZE, total)}</span>{" "}
						of <span className="font-medium text-foreground">{total}</span> users
					</p>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								const newPage = page - 1;
								setPage(newPage);
								fetchUsers(search, status, newPage);
							}}
							disabled={page === 1}
						>
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								const newPage = page + 1;
								setPage(newPage);
								fetchUsers(search, status, newPage);
							}}
							disabled={page >= totalPages}
						>
							Next
						</Button>
					</div>
				</div>
			)}

			{/* Ban Dialog */}
			<Dialog open={!!banDialogUser} onOpenChange={() => setBanDialogUser(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Ban User</DialogTitle>
						<DialogDescription>
							Ban {banDialogUser?.email} from accessing the platform.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="reason">Reason</Label>
							<Textarea
								id="reason"
								placeholder="Enter the reason for banning this user…"
								value={banReason}
								onChange={(e) => setBanReason(e.target.value)}
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="expiry">Expiry Date (optional)</Label>
							<Input
								id="expiry"
								type="datetime-local"
								value={banExpiry}
								onChange={(e) => setBanExpiry(e.target.value)}
							/>
							<p className="text-xs text-muted-foreground">Leave empty for permanent ban</p>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setBanDialogUser(null)}>
							Cancel
						</Button>
						<Button variant="destructive" onClick={handleBan} disabled={!banReason || isPending}>
							Ban User
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Sessions Dialog */}
			<Dialog open={!!sessionsDialogUser} onOpenChange={() => setSessionsDialogUser(null)}>
				<DialogContent className="max-w-2xl">
					<DialogHeader>
						<DialogTitle>User Sessions</DialogTitle>
						<DialogDescription>Active sessions for {sessionsDialogUser?.email}</DialogDescription>
					</DialogHeader>
					<div className="py-4">
						{sessionsLoading ? (
							<div className="space-y-2">
								{[...Array(3)].map((_, i) => (
									<Skeleton key={i} className="h-12 w-full" />
								))}
							</div>
						) : sessions.length === 0 ? (
							<p className="text-center text-muted-foreground py-8">No active sessions</p>
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
													: "Unknown device"}
											</div>
											<div className="text-xs text-muted-foreground">
												{session.ipAddress ?? "Unknown IP"} • Created{" "}
												{DateTime.fromJSDate(session.createdAt).toRelative()}
											</div>
										</div>
										<Button
											variant="ghost"
											size="sm"
											onClick={() => handleRevokeSession(session.id)}
											disabled={isPending}
											aria-label="Revoke session"
										>
											<IconX className="size-4" aria-hidden="true" />
										</Button>
									</div>
								))}
							</div>
						)}
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setSessionsDialogUser(null)}>
							Close
						</Button>
						{sessions.length > 0 && (
							<Button variant="destructive" onClick={handleRevokeAllSessions} disabled={isPending}>
								Revoke All Sessions
							</Button>
						)}
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
