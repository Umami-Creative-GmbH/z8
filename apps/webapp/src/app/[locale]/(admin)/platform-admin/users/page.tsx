"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { PlatformUser, UserSession } from "@/lib/effect/services/platform-admin.service";
import {
	PlatformAdminBanUserDialog,
	PlatformAdminUserFilters,
	PlatformAdminUserSessionsPanel,
	PlatformAdminUsersPageHeader,
	PlatformAdminUsersPagination,
	PlatformAdminUsersTable,
	type UserStatusFilter,
} from "@/lib/platform-admin-users-page-sections";
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

function getUserStatusFilter(status: string | null): UserStatusFilter {
	return status === "active" || status === "banned" ? status : "all";
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

	const handleFilterChange = (newSearch: string, newStatus: UserStatusFilter) => {
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current);
		}

		setSearch(newSearch);

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

		searchTimeoutRef.current = setTimeout(() => {
			setPage(1);
			const params = new URLSearchParams();
			if (newSearch) params.set("search", newSearch);
			if (newStatus !== "all") params.set("status", newStatus);
			if (organizationId) params.set("organizationId", organizationId);
			router.push(`/platform-admin/users?${params.toString()}`);
		}, 300);
	};

	useEffect(() => {
		const searchTimeout = searchTimeoutRef.current;

		return () => {
			if (searchTimeout) {
				clearTimeout(searchTimeout);
			}
		};
	}, []);

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

	const handleRevokeSession = async (sessionId: string) => {
		startTransition(async () => {
			const result = await revokeSessionAction(sessionId);
			if (result.success) {
				toast.success(t("admin:admin.users.toasts.sessionRevoked", "Session revoked"));
				setSessions(sessions.filter((session) => session.id !== sessionId));
			} else {
				toast.error(result.error);
			}
		});
	};

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
			<PlatformAdminUsersPageHeader />
			<PlatformAdminUserFilters
				search={search}
				status={status}
				onFilterChange={handleFilterChange}
			/>
			<PlatformAdminUsersTable
				users={users}
				isLoading={isLoading}
				isPending={isPending}
				onViewSessions={handleViewSessions}
				onUnban={handleUnban}
				onOpenBan={setBanDialogUser}
			/>
			<PlatformAdminUsersPagination
				page={page}
				total={total}
				totalPages={totalPages}
				pageSize={PAGE_SIZE}
				onPageChange={setPage}
			/>
			<PlatformAdminBanUserDialog
				user={banDialogUser}
				banReason={banReason}
				banExpiry={banExpiry}
				isPending={isPending}
				onReasonChange={setBanReason}
				onExpiryChange={setBanExpiry}
				onClose={() => setBanDialogUser(null)}
				onConfirm={handleBan}
			/>
			<PlatformAdminUserSessionsPanel
				user={sessionsDialogUser}
				sessions={sessions}
				sessionsLoading={sessionsLoading}
				isPending={isPending}
				onClose={() => setSessionsDialogUser(null)}
				onRevokeSession={handleRevokeSession}
				onRevokeAllSessions={handleRevokeAllSessions}
			/>
		</div>
	);
}
