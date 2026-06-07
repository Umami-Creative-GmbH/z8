"use client";

import {
	IconAlertTriangle,
	IconBuilding,
	IconCheck,
	IconPlayerPause,
	IconPlayerPlay,
	IconSearch,
	IconTrash,
	IconUsers,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useReducer, useRef, useTransition } from "react";
import { toast } from "sonner";
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
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { PlatformOrganization } from "@/lib/effect/services/platform-admin.service";
import { Link, useRouter } from "@/navigation";
import {
	deleteOrganizationAction,
	listOrganizationsAction,
	suspendOrganizationAction,
	unsuspendOrganizationAction,
} from "./actions";
import {
	getInitialOrganizationsState,
	getOrganizationStatusFilter,
	organizationsReducer,
	type OrganizationStatusFilter,
} from "./state";

const PAGE_SIZE = 20;
const LOADING_ROW_KEYS = ["loading-1", "loading-2", "loading-3", "loading-4", "loading-5"];

export default function OrganizationsPage() {
	return (
		<Suspense fallback={<OrganizationsPageSkeleton />}>
			<OrganizationsPageBody />
		</Suspense>
	);
}

function OrganizationsPageSkeleton() {
	return (
		<div className="space-y-8">
			<div className="space-y-2">
				<Skeleton className="h-8 w-72" />
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

function OrganizationsPageBody() {
	const searchParams = useSearchParams();
	const initialSearch = searchParams.get("search") ?? "";
	const initialStatus = getOrganizationStatusFilter(searchParams.get("status"));
	const stateKey = `${initialSearch}:${initialStatus}`;

	return (
		<OrganizationsPageContent
			key={stateKey}
			initialSearch={initialSearch}
			initialStatus={initialStatus}
		/>
	);
}

function OrganizationsPageContent({
	initialSearch,
	initialStatus,
}: {
	initialSearch: string;
	initialStatus: OrganizationStatusFilter;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();

	const [state, dispatch] = useReducer(
		organizationsReducer,
		{ search: initialSearch, status: initialStatus },
		getInitialOrganizationsState,
	);
	const {
		page,
		search,
		status,
		suspendDialogOrg,
		suspendReason,
		deleteDialogOrg,
		deleteImmediate,
		deleteSkipNotification,
		deleteConfirmName,
	} = state;
	const [isPending, startTransition] = useTransition();
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	const { data, error, isError, isLoading } = useQuery({
		queryKey: ["admin-organizations", search, status, page],
		queryFn: async () => {
			const result = await listOrganizationsAction({ search, status }, page, PAGE_SIZE);
			if (!result.success) {
				throw new Error(result.error);
			}
			return result.data;
		},
		retry: false,
	});

	const organizations = data?.data ?? [];
	const loadErrorMessage = error instanceof Error ? error.message : null;
	const total = data?.total ?? 0;
	const suspendOrganizationLabel = t(
		"admin:admin.organizations.actions.suspend",
		"Suspend organization",
	);
	const reactivateOrganizationLabel = t(
		"admin:admin.organizations.actions.reactivate",
		"Reactivate organization",
	);
	const deleteOrganizationLabel = t(
		"admin:admin.organizations.actions.delete",
		"Delete organization",
	);

	// Debounced search with immediate status change
	const handleFilterChange = (newSearch: string, newStatus: OrganizationStatusFilter) => {
		// Clear any pending search timeout
		if (searchTimeoutRef.current) {
			clearTimeout(searchTimeoutRef.current);
		}

		dispatch({ type: "filtersChanged", search: newSearch, status: newStatus });

		// If only status changed, fetch immediately
		if (newStatus !== status) {
			const params = new URLSearchParams();
			if (newSearch) params.set("search", newSearch);
			if (newStatus !== "all") params.set("status", newStatus);
			router.push(`/platform-admin/organizations?${params.toString()}`);
			return;
		}

		// Debounce search input (300ms)
		searchTimeoutRef.current = setTimeout(() => {
			const params = new URLSearchParams();
			if (newSearch) params.set("search", newSearch);
			if (newStatus !== "all") params.set("status", newStatus);
			router.push(`/platform-admin/organizations?${params.toString()}`);
		}, 300);
	};

	// Cleanup timeout on unmount
	useEffect(() => {
		const searchTimeout = searchTimeoutRef.current;

		return () => {
			if (searchTimeout) {
				clearTimeout(searchTimeout);
			}
		};
	}, []);

	// Suspend organization
	const handleSuspend = async () => {
		if (!suspendDialogOrg) return;

		startTransition(async () => {
			const result = await suspendOrganizationAction(suspendDialogOrg.id, suspendReason);
			if (result.success) {
				toast.success(
					t(
						"admin:admin.organizations.toasts.suspended",
						'Organization "{name}" has been suspended',
						{
							name: suspendDialogOrg.name,
						},
					),
				);
				dispatch({ type: "suspendCompleted" });
				queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
			} else {
				toast.error(result.error);
			}
		});
	};

	// Unsuspend organization
	const handleUnsuspend = async (org: PlatformOrganization) => {
		startTransition(async () => {
			const result = await unsuspendOrganizationAction(org.id);
			if (result.success) {
				toast.success(
					t(
						"admin:admin.organizations.toasts.unsuspended",
						'Organization "{name}" has been unsuspended',
						{ name: org.name },
					),
				);
				queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
			} else {
				toast.error(result.error);
			}
		});
	};

	// Delete organization
	const handleDelete = async () => {
		if (!deleteDialogOrg || deleteConfirmName !== deleteDialogOrg.name) return;

		startTransition(async () => {
			const result = await deleteOrganizationAction(
				deleteDialogOrg.id,
				deleteImmediate,
				deleteSkipNotification,
			);
			if (result.success) {
				toast.success(
					deleteImmediate
						? t(
								"admin:admin.organizations.toasts.deletedImmediate",
								'Organization "{name}" has been scheduled for immediate deletion',
								{ name: deleteDialogOrg.name },
							)
						: t(
								"admin:admin.organizations.toasts.deletedGracePeriod",
								'Organization "{name}" has been scheduled for deletion in 5 days',
								{ name: deleteDialogOrg.name },
							),
				);
				dispatch({ type: "deleteCompleted" });
				queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
			} else {
				toast.error(result.error);
			}
		});
	};

	const totalPages = Math.ceil(total / PAGE_SIZE);

	return (
		<div className="space-y-8">
			<OrganizationsHeader t={t} />
			<OrganizationsFilters
				t={t}
				search={search}
				status={status}
				onFilterChange={handleFilterChange}
			/>
			<OrganizationsTable
				t={t}
				organizations={organizations}
				isLoading={isLoading}
				isError={isError}
				loadErrorMessage={loadErrorMessage}
				isPending={isPending}
				onUnsuspend={handleUnsuspend}
				onOpenSuspend={(organization) => dispatch({ type: "suspendDialogOpened", organization })}
				onOpenDelete={(organization) => dispatch({ type: "deleteDialogOpened", organization })}
				suspendOrganizationLabel={suspendOrganizationLabel}
				reactivateOrganizationLabel={reactivateOrganizationLabel}
				deleteOrganizationLabel={deleteOrganizationLabel}
			/>
			<OrganizationsPagination
				t={t}
				page={page}
				total={total}
				totalPages={totalPages}
				onPageChange={(nextPage) => dispatch({ type: "pageChanged", page: nextPage })}
			/>
			<SuspendOrganizationDialog
				t={t}
				organization={suspendDialogOrg}
				reason={suspendReason}
				isPending={isPending}
				onReasonChange={(reason) => dispatch({ type: "suspendReasonChanged", reason })}
				onClose={() => dispatch({ type: "suspendDialogClosed" })}
				onConfirm={handleSuspend}
			/>
			<DeleteOrganizationDialog
				t={t}
				organization={deleteDialogOrg}
				deleteImmediate={deleteImmediate}
				deleteSkipNotification={deleteSkipNotification}
				deleteConfirmName={deleteConfirmName}
				isPending={isPending}
				onClose={() => dispatch({ type: "deleteDialogClosed" })}
				onImmediateChange={(value) => dispatch({ type: "deleteImmediateChanged", value })}
				onSkipNotificationChange={(value) =>
					dispatch({ type: "deleteSkipNotificationChanged", value })
				}
				onConfirmNameChange={(value) => dispatch({ type: "deleteConfirmNameChanged", value })}
				onConfirm={handleDelete}
			/>
		</div>
	);
}

type TFunction = ReturnType<typeof useTranslate>["t"];

function OrganizationsHeader({ t }: { t: TFunction }) {
	return (
		<div className="space-y-1">
			<h1 className="text-2xl font-semibold tracking-tight">
				{t("admin:admin.organizations.title", "Organization Management")}
			</h1>
			<p className="text-muted-foreground">
				{t(
					"admin:admin.organizations.description",
					"View and manage all organizations on the platform",
				)}
			</p>
		</div>
	);
}

function OrganizationsFilters({
	t,
	search,
	status,
	onFilterChange,
}: {
	t: TFunction;
	search: string;
	status: OrganizationStatusFilter;
	onFilterChange: (search: string, status: OrganizationStatusFilter) => void;
}) {
	return (
		<div className="flex flex-col gap-4 sm:flex-row">
			<div className="relative flex-1">
				<IconSearch
					className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground"
					aria-hidden="true"
				/>
				<Input
					placeholder={t("admin:admin.organizations.searchPlaceholder", "Search by name or slug…")}
					name="search"
					autoComplete="off"
					value={search}
					onChange={(e) => onFilterChange(e.target.value, status)}
					className="pl-9"
				/>
			</div>
			<Select
				value={status}
				onValueChange={(value) => onFilterChange(search, value as OrganizationStatusFilter)}
			>
				<SelectTrigger className="w-full sm:w-40">
					<SelectValue placeholder={t("common.status", "Status")} />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="all">{t("admin:admin.organizations.filters.all", "All")}</SelectItem>
					<SelectItem value="active">{t("common.active", "Active")}</SelectItem>
					<SelectItem value="suspended">
						{t("admin:admin.organizations.filters.suspended", "Suspended")}
					</SelectItem>
					<SelectItem value="deleted">
						{t("admin:admin.organizations.filters.deleted", "Deleted")}
					</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}

function OrganizationsTable({
	t,
	organizations,
	isLoading,
	isError,
	loadErrorMessage,
	isPending,
	onUnsuspend,
	onOpenSuspend,
	onOpenDelete,
	suspendOrganizationLabel,
	reactivateOrganizationLabel,
	deleteOrganizationLabel,
}: {
	t: TFunction;
	organizations: PlatformOrganization[];
	isLoading: boolean;
	isError: boolean;
	loadErrorMessage: string | null;
	isPending: boolean;
	onUnsuspend: (organization: PlatformOrganization) => void;
	onOpenSuspend: (organization: PlatformOrganization) => void;
	onOpenDelete: (organization: PlatformOrganization) => void;
	suspendOrganizationLabel: string;
	reactivateOrganizationLabel: string;
	deleteOrganizationLabel: string;
}) {
	return (
		<Card>
			<CardContent className="p-0">
				{isLoading ? (
					<div className="p-6 space-y-3">
						{LOADING_ROW_KEYS.map((key) => (
							<Skeleton key={key} className="h-14 w-full rounded-lg" />
						))}
					</div>
				) : isError ? (
					<div className="flex items-start gap-3 p-6 text-sm">
						<IconAlertTriangle
							className="mt-0.5 size-5 shrink-0 text-destructive"
							aria-hidden="true"
						/>
						<div className="space-y-1">
							<p className="font-medium">
								{t(
									"admin:admin.organizations.table.loadErrorTitle",
									"Unable to load organizations",
								)}
							</p>
							{loadErrorMessage && <p className="text-muted-foreground">{loadErrorMessage}</p>}
						</div>
					</div>
				) : (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									{t("admin:admin.organizations.table.organization", "Organization")}
								</TableHead>
								<TableHead>{t("admin:admin.organizations.table.employees", "Employees")}</TableHead>
								<TableHead>{t("admin:admin.organizations.table.members", "Members")}</TableHead>
								<TableHead>{t("common.status", "Status")}</TableHead>
								<TableHead>{t("admin:admin.organizations.table.created", "Created")}</TableHead>
								<TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{organizations.length === 0 ? (
								<TableRow>
									<TableCell colSpan={6} className="text-center text-muted-foreground">
										{t(
											"admin:admin.organizations.table.noOrganizationsFound",
											"No organizations found",
										)}
									</TableCell>
								</TableRow>
							) : (
								organizations.map((organization) => (
									<OrganizationTableRow
										key={organization.id}
										t={t}
										organization={organization}
										isPending={isPending}
										onUnsuspend={onUnsuspend}
										onOpenSuspend={onOpenSuspend}
										onOpenDelete={onOpenDelete}
										suspendOrganizationLabel={suspendOrganizationLabel}
										reactivateOrganizationLabel={reactivateOrganizationLabel}
										deleteOrganizationLabel={deleteOrganizationLabel}
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

function OrganizationTableRow({
	t,
	organization,
	isPending,
	onUnsuspend,
	onOpenSuspend,
	onOpenDelete,
	suspendOrganizationLabel,
	reactivateOrganizationLabel,
	deleteOrganizationLabel,
}: {
	t: TFunction;
	organization: PlatformOrganization;
	isPending: boolean;
	onUnsuspend: (organization: PlatformOrganization) => void;
	onOpenSuspend: (organization: PlatformOrganization) => void;
	onOpenDelete: (organization: PlatformOrganization) => void;
	suspendOrganizationLabel: string;
	reactivateOrganizationLabel: string;
	deleteOrganizationLabel: string;
}) {
	const usersHref = `/platform-admin/users?organizationId=${encodeURIComponent(organization.id)}`;

	return (
		<TableRow>
			<TableCell>
				<div className="flex items-center gap-3">
					<div className="size-8 rounded bg-muted flex items-center justify-center">
						{organization.logo ? (
							<img
								src={organization.logo}
								alt={organization.name}
								width={32}
								height={32}
								className="size-8 rounded"
							/>
						) : (
							<IconBuilding className="size-4" aria-hidden="true" />
						)}
					</div>
					<div>
						<Link href={usersHref} className="font-medium hover:underline">
							{organization.name}
						</Link>
						<div className="text-sm text-muted-foreground">{organization.slug}</div>
					</div>
				</div>
			</TableCell>
			<TableCell>
				<div className="flex items-center gap-1">
					<IconUsers className="size-4 text-muted-foreground" aria-hidden="true" />
					{organization.employeeCount}
				</div>
			</TableCell>
			<TableCell>
				<Link href={usersHref} className="hover:underline">
					{organization.memberCount}
				</Link>
			</TableCell>
			<TableCell>
				<OrganizationStatusBadge t={t} organization={organization} />
			</TableCell>
			<TableCell>
				{DateTime.fromJSDate(organization.createdAt).toLocaleString(DateTime.DATE_MED)}
			</TableCell>
			<TableCell className="text-right">
				<OrganizationRowActions
					organization={organization}
					isPending={isPending}
					onUnsuspend={onUnsuspend}
					onOpenSuspend={onOpenSuspend}
					onOpenDelete={onOpenDelete}
					suspendOrganizationLabel={suspendOrganizationLabel}
					reactivateOrganizationLabel={reactivateOrganizationLabel}
					deleteOrganizationLabel={deleteOrganizationLabel}
				/>
			</TableCell>
		</TableRow>
	);
}

function OrganizationStatusBadge({
	t,
	organization,
}: {
	t: TFunction;
	organization: PlatformOrganization;
}) {
	if (organization.deletedAt) {
		return (
			<div>
				<Badge variant="destructive">
					<IconTrash className="size-3 mr-1" aria-hidden="true" />
					{t("admin:admin.organizations.badges.deleted", "Deleted")}
				</Badge>
				<div className="text-xs text-muted-foreground mt-1">
					{DateTime.fromJSDate(organization.deletedAt).toRelative()}
				</div>
			</div>
		);
	}

	if (organization.isSuspended) {
		return (
			<div>
				<Badge variant="outline" className="border-yellow-500 text-yellow-700">
					<IconAlertTriangle className="size-3 mr-1" aria-hidden="true" />
					{t("admin:admin.organizations.badges.suspended", "Suspended")}
				</Badge>
				{organization.suspendedReason && (
					<div
						className="text-xs text-muted-foreground mt-1 max-w-32 truncate"
						title={organization.suspendedReason}
					>
						{organization.suspendedReason}
					</div>
				)}
			</div>
		);
	}

	return (
		<Badge variant="outline" className="border-green-500 text-green-700">
			<IconCheck className="size-3 mr-1" aria-hidden="true" />
			{t("common.active", "Active")}
		</Badge>
	);
}

function OrganizationRowActions({
	organization,
	isPending,
	onUnsuspend,
	onOpenSuspend,
	onOpenDelete,
	suspendOrganizationLabel,
	reactivateOrganizationLabel,
	deleteOrganizationLabel,
}: {
	organization: PlatformOrganization;
	isPending: boolean;
	onUnsuspend: (organization: PlatformOrganization) => void;
	onOpenSuspend: (organization: PlatformOrganization) => void;
	onOpenDelete: (organization: PlatformOrganization) => void;
	suspendOrganizationLabel: string;
	reactivateOrganizationLabel: string;
	deleteOrganizationLabel: string;
}) {
	if (organization.deletedAt) {
		return <div className="flex justify-end gap-2" />;
	}

	return (
		<div className="flex justify-end gap-2">
			{organization.isSuspended ? (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onUnsuspend(organization)}
							disabled={isPending}
							aria-label={reactivateOrganizationLabel}
						>
							<IconPlayerPlay className="size-4" aria-hidden="true" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>{reactivateOrganizationLabel}</TooltipContent>
				</Tooltip>
			) : (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="sm"
							onClick={() => onOpenSuspend(organization)}
							aria-label={suspendOrganizationLabel}
						>
							<IconPlayerPause className="size-4" aria-hidden="true" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>{suspendOrganizationLabel}</TooltipContent>
				</Tooltip>
			)}
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => onOpenDelete(organization)}
						aria-label={deleteOrganizationLabel}
					>
						<IconTrash className="size-4" aria-hidden="true" />
					</Button>
				</TooltipTrigger>
				<TooltipContent>{deleteOrganizationLabel}</TooltipContent>
			</Tooltip>
		</div>
	);
}

function OrganizationsPagination({
	t,
	page,
	total,
	totalPages,
	onPageChange,
}: {
	t: TFunction;
	page: number;
	total: number;
	totalPages: number;
	onPageChange: (page: number) => void;
}) {
	if (totalPages <= 1) {
		return null;
	}

	return (
		<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
			<p className="text-sm text-muted-foreground">
				{t(
					"admin:admin.organizations.pagination.showing",
					"Showing {from} to {to} of {total} organizations",
					{
						from: (page - 1) * PAGE_SIZE + 1,
						to: Math.min(page * PAGE_SIZE, total),
						total,
					},
				)}
			</p>
			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					onClick={() => onPageChange(page - 1)}
					disabled={page === 1}
				>
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

function SuspendOrganizationDialog({
	t,
	organization,
	reason,
	isPending,
	onReasonChange,
	onClose,
	onConfirm,
}: {
	t: TFunction;
	organization: PlatformOrganization | null;
	reason: string;
	isPending: boolean;
	onReasonChange: (reason: string) => void;
	onClose: () => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={!!organization} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("admin:admin.organizations.suspendDialog.title", "Suspend Organization")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"admin:admin.organizations.suspendDialog.description",
							'Suspend "{name}" and put it in read-only mode. Members will be able to view data but not create or edit anything.',
							{ name: organization?.name ?? "" },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="space-y-4 py-4">
					<div className="space-y-2">
						<Label htmlFor="suspendReason">
							{t("admin:admin.organizations.suspendDialog.reason", "Reason")}
						</Label>
						<Textarea
							id="suspendReason"
							placeholder={t(
								"admin:admin.organizations.suspendDialog.reasonPlaceholder",
								"Enter the reason for suspending this organization…",
							)}
							value={reason}
							onChange={(e) => onReasonChange(e.target.value)}
						/>
					</div>
				</div>
				<AlertDialogFooter>
					<AlertDialogCancel onClick={onClose}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction
						onClick={(event) => {
							event.preventDefault();
							onConfirm();
						}}
						disabled={!reason || isPending}
					>
						{t("admin:admin.organizations.suspendDialog.confirmButton", "Suspend Organization")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function DeleteOrganizationDialog({
	t,
	organization,
	deleteImmediate,
	deleteSkipNotification,
	deleteConfirmName,
	isPending,
	onClose,
	onImmediateChange,
	onSkipNotificationChange,
	onConfirmNameChange,
	onConfirm,
}: {
	t: TFunction;
	organization: PlatformOrganization | null;
	deleteImmediate: boolean;
	deleteSkipNotification: boolean;
	deleteConfirmName: string;
	isPending: boolean;
	onClose: () => void;
	onImmediateChange: (value: boolean) => void;
	onSkipNotificationChange: (value: boolean) => void;
	onConfirmNameChange: (value: string) => void;
	onConfirm: () => void;
}) {
	return (
		<AlertDialog open={!!organization} onOpenChange={(open) => !open && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("admin:admin.organizations.deleteDialog.title", "Delete Organization")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"admin:admin.organizations.deleteDialog.description",
							'This action will delete "{name}" and all associated data. This cannot be undone.',
							{ name: organization?.name ?? "" },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="space-y-4 py-4">
					<div className="flex items-center gap-x-2">
						<Checkbox
							id="immediate"
							checked={deleteImmediate}
							onCheckedChange={(checked) => onImmediateChange(checked === true)}
						/>
						<Label htmlFor="immediate" className="text-sm font-normal">
							{t(
								"admin:admin.organizations.deleteDialog.immediateDelete",
								"Delete immediately (skip 5-day grace period)",
							)}
						</Label>
					</div>
					<div className="flex items-center gap-x-2">
						<Checkbox
							id="skipNotification"
							checked={deleteSkipNotification}
							onCheckedChange={(checked) => onSkipNotificationChange(checked === true)}
						/>
						<Label htmlFor="skipNotification" className="text-sm font-normal">
							{t(
								"admin:admin.organizations.deleteDialog.skipNotification",
								"Skip deletion notification to org members",
							)}
						</Label>
					</div>
					<div className="space-y-2">
						<Label htmlFor="confirmName">
							{t(
								"admin:admin.organizations.deleteDialog.confirmLabel",
								'Type "{name}" to confirm',
								{
									name: organization?.name ?? "",
								},
							)}
						</Label>
						<Input
							id="confirmName"
							value={deleteConfirmName}
							onChange={(e) => onConfirmNameChange(e.target.value)}
							placeholder={t(
								"admin:admin.organizations.deleteDialog.confirmPlaceholder",
								"Organization name",
							)}
						/>
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
							disabled={deleteConfirmName !== organization?.name || isPending}
						>
							{t("admin:admin.organizations.deleteDialog.confirmButton", "Delete Organization")}
						</Button>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
