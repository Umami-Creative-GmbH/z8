"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useReducer, useRef, useTransition } from "react";
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

interface UsersPageState {
	page: number;
	search: string;
	status: UserStatusFilter;
	banDialogUser: PlatformUser | null;
	banReason: string;
	banExpiry: string;
	sessionsDialogUser: PlatformUser | null;
	sessions: UserSession[];
	sessionsLoading: boolean;
}

type UsersPageAction =
	| { type: "pageChanged"; page: number }
	| { type: "filtersChanged"; search: string; status: UserStatusFilter }
	| { type: "banDialogOpened"; user: PlatformUser }
	| { type: "banDialogClosed" }
	| { type: "banReasonChanged"; value: string }
	| { type: "banExpiryChanged"; value: string }
	| { type: "banCompleted" }
	| { type: "sessionsOpened"; user: PlatformUser }
	| { type: "sessionsLoaded"; sessions: UserSession[] }
	| { type: "sessionsLoadingFinished" }
	| { type: "sessionsClosed" }
	| { type: "sessionRevoked"; sessionId: string }
	| { type: "allSessionsRevoked" };

function usersPageReducer(state: UsersPageState, action: UsersPageAction): UsersPageState {
	switch (action.type) {
		case "pageChanged":
			return { ...state, page: action.page };
		case "filtersChanged":
			return { ...state, page: 1, search: action.search, status: action.status };
		case "banDialogOpened":
			return { ...state, banDialogUser: action.user };
		case "banDialogClosed":
			return { ...state, banDialogUser: null };
		case "banReasonChanged":
			return { ...state, banReason: action.value };
		case "banExpiryChanged":
			return { ...state, banExpiry: action.value };
		case "banCompleted":
			return { ...state, banDialogUser: null, banReason: "", banExpiry: "" };
		case "sessionsOpened":
			return { ...state, sessionsDialogUser: action.user, sessionsLoading: true };
		case "sessionsLoaded":
			return { ...state, sessions: action.sessions, sessionsLoading: false };
		case "sessionsLoadingFinished":
			return { ...state, sessionsLoading: false };
		case "sessionsClosed":
			return { ...state, sessionsDialogUser: null };
		case "sessionRevoked":
			return {
				...state,
				sessions: state.sessions.filter((session) => session.id !== action.sessionId),
			};
		case "allSessionsRevoked":
			return { ...state, sessions: [] };
	}
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

	const [state, dispatch] = useReducer(usersPageReducer, {
		page: 1,
		search: initialSearch,
		status: initialStatus,
		banDialogUser: null,
		banReason: "",
		banExpiry: "",
		sessionsDialogUser: null,
		sessions: [],
		sessionsLoading: false,
	});
	const {
		page,
		search,
		status,
		banDialogUser,
		banReason,
		banExpiry,
		sessionsDialogUser,
		sessions,
		sessionsLoading,
	} = state;
	const organizationId = initialOrganizationId;
	const [isPending, startTransition] = useTransition();
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

		dispatch({ type: "filtersChanged", search: newSearch, status: newStatus });

		if (newStatus !== status) {
			const params = new URLSearchParams();
			if (newSearch) params.set("search", newSearch);
			if (newStatus !== "all") params.set("status", newStatus);
			if (organizationId) params.set("organizationId", organizationId);
			router.push(`/platform-admin/users?${params.toString()}`);
			return;
		}

		searchTimeoutRef.current = setTimeout(() => {
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
				dispatch({ type: "banCompleted" });
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
		dispatch({ type: "sessionsOpened", user });
		const result = await listUserSessionsAction(user.id);
		if (result.success) {
			dispatch({ type: "sessionsLoaded", sessions: result.data });
		} else {
			toast.error(result.error);
			dispatch({ type: "sessionsLoadingFinished" });
		}
	};

	const handleRevokeSession = async (sessionId: string) => {
		startTransition(async () => {
			const result = await revokeSessionAction(sessionId);
			if (result.success) {
				toast.success(t("admin:admin.users.toasts.sessionRevoked", "Session revoked"));
				dispatch({ type: "sessionRevoked", sessionId });
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
				dispatch({ type: "allSessionsRevoked" });
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
				onOpenBan={(user) => dispatch({ type: "banDialogOpened", user })}
			/>
			<PlatformAdminUsersPagination
				page={page}
				total={total}
				totalPages={totalPages}
				pageSize={PAGE_SIZE}
				onPageChange={(nextPage) => dispatch({ type: "pageChanged", page: nextPage })}
			/>
			<PlatformAdminBanUserDialog
				user={banDialogUser}
				banReason={banReason}
				banExpiry={banExpiry}
				isPending={isPending}
				onReasonChange={(value) => dispatch({ type: "banReasonChanged", value })}
				onExpiryChange={(value) => dispatch({ type: "banExpiryChanged", value })}
				onClose={() => dispatch({ type: "banDialogClosed" })}
				onConfirm={handleBan}
			/>
			<PlatformAdminUserSessionsPanel
				user={sessionsDialogUser}
				sessions={sessions}
				sessionsLoading={sessionsLoading}
				isPending={isPending}
				onClose={() => dispatch({ type: "sessionsClosed" })}
				onRevokeSession={handleRevokeSession}
				onRevokeAllSessions={handleRevokeAllSessions}
			/>
		</div>
	);
}
