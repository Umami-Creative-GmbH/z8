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
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import type { PlatformOrganization } from "@/lib/effect/services/platform-admin.service";
import { useRouter } from "@/navigation";
import {
	deleteOrganizationAction,
	listOrganizationsAction,
	suspendOrganizationAction,
	unsuspendOrganizationAction,
} from "./actions";

const PAGE_SIZE = 20;
const LOADING_ROW_KEYS = ["loading-1", "loading-2", "loading-3", "loading-4", "loading-5"];
type OrganizationStatusFilter = "all" | "active" | "suspended" | "deleted";

function getInitialFilters(): { search: string; status: OrganizationStatusFilter } {
	if (typeof window === "undefined") {
		return {
			search: "",
			status: "all" as const,
		};
	}

	const params = new URLSearchParams(window.location.search);
	const statusParam = params.get("status");
	const status: OrganizationStatusFilter =
		statusParam === "active" || statusParam === "suspended" || statusParam === "deleted"
			? statusParam
			: "all";

	return {
		search: params.get("search") ?? "",
		status,
	};
}

export default function OrganizationsPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const queryClient = useQueryClient();
	const initialFilters = getInitialFilters();

	const [page, setPage] = useState(1);
	const [search, setSearch] = useState(initialFilters.search);
	const [status, setStatus] = useState<OrganizationStatusFilter>(initialFilters.status);
	const [isPending, startTransition] = useTransition();
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Dialog states
	const [suspendDialogOrg, setSuspendDialogOrg] = useState<PlatformOrganization | null>(null);
	const [suspendReason, setSuspendReason] = useState("");
	const [deleteDialogOrg, setDeleteDialogOrg] = useState<PlatformOrganization | null>(null);
	const [deleteImmediate, setDeleteImmediate] = useState(false);
	const [deleteSkipNotification, setDeleteSkipNotification] = useState(false);
	const [deleteConfirmName, setDeleteConfirmName] = useState("");

	const { data, isLoading } = useQuery({
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
	const total = data?.total ?? 0;

	// Debounced search with immediate status change
	const handleFilterChange = useCallback(
		(newSearch: string, newStatus: OrganizationStatusFilter) => {
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
				router.push(`/admin/organizations?${params.toString()}`);
				return;
			}

			// Debounce search input (300ms)
			searchTimeoutRef.current = setTimeout(() => {
				setPage(1);
				const params = new URLSearchParams();
				if (newSearch) params.set("search", newSearch);
				if (newStatus !== "all") params.set("status", newStatus);
				router.push(`/admin/organizations?${params.toString()}`);
			}, 300);
		},
		[router, status],
	);

	// Cleanup timeout on unmount
	useEffect(() => {
		return () => {
			if (searchTimeoutRef.current) {
				clearTimeout(searchTimeoutRef.current);
			}
		};
	}, []);

	// Suspend organization
	const handleSuspend = async () => {
		if (!suspendDialogOrg) return;

		startTransition(async () => {
			const result = await suspendOrganizationAction(suspendDialogOrg.id, suspendReason);
			if (result.success) {
				toast.success(t("admin.organizations.toasts.suspended", "Organization \"{name}\" has been suspended", { name: suspendDialogOrg.name }));
				setSuspendDialogOrg(null);
				setSuspendReason("");
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
				toast.success(t("admin.organizations.toasts.unsuspended", "Organization \"{name}\" has been unsuspended", { name: org.name }));
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
						? t("admin.organizations.toasts.deletedImmediate", "Organization \"{name}\" has been scheduled for immediate deletion", { name: deleteDialogOrg.name })
						: t("admin.organizations.toasts.deletedGracePeriod", "Organization \"{name}\" has been scheduled for deletion in 5 days", { name: deleteDialogOrg.name }),
				);
				setDeleteDialogOrg(null);
				setDeleteImmediate(false);
				setDeleteSkipNotification(false);
				setDeleteConfirmName("");
				queryClient.invalidateQueries({ queryKey: ["admin-organizations"] });
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
					{t("admin.organizations.title", "Organization Management")}
				</h1>
				<p className="text-muted-foreground">
					{t("admin.organizations.description", "View and manage all organizations on the platform")}
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
						placeholder={t("admin.organizations.searchPlaceholder", "Search by name or slug…")}
						name="search"
						autoComplete="off"
						value={search}
						onChange={(e) => handleFilterChange(e.target.value, status)}
						className="pl-9"
					/>
				</div>
				<Select
					value={status}
					onValueChange={(v) => handleFilterChange(search, v as OrganizationStatusFilter)}
				>
					<SelectTrigger className="w-full sm:w-40">
						<SelectValue placeholder={t("common.status", "Status")} />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">{t("admin.organizations.filters.all", "All")}</SelectItem>
						<SelectItem value="active">{t("common.active", "Active")}</SelectItem>
						<SelectItem value="suspended">{t("admin.organizations.filters.suspended", "Suspended")}</SelectItem>
						<SelectItem value="deleted">{t("admin.organizations.filters.deleted", "Deleted")}</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Organizations Table */}
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
									<TableHead>{t("admin.organizations.table.organization", "Organization")}</TableHead>
									<TableHead>{t("admin.organizations.table.employees", "Employees")}</TableHead>
									<TableHead>{t("admin.organizations.table.members", "Members")}</TableHead>
									<TableHead>{t("common.status", "Status")}</TableHead>
									<TableHead>{t("admin.organizations.table.created", "Created")}</TableHead>
									<TableHead className="text-right">{t("common.actions", "Actions")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{organizations.length === 0 ? (
									<TableRow>
										<TableCell colSpan={6} className="text-center text-muted-foreground">
											{t("admin.organizations.table.noOrganizationsFound", "No organizations found")}
										</TableCell>
									</TableRow>
								) : (
									organizations.map((org) => (
										<TableRow key={org.id}>
											<TableCell>
												<div className="flex items-center gap-3">
													<div className="size-8 rounded bg-muted flex items-center justify-center">
														{org.logo ? (
															<img
																src={org.logo}
																alt={org.name}
																width={32}
																height={32}
																className="size-8 rounded"
															/>
														) : (
															<IconBuilding className="size-4" aria-hidden="true" />
														)}
													</div>
													<div>
														<div className="font-medium">{org.name}</div>
														<div className="text-sm text-muted-foreground">{org.slug}</div>
													</div>
												</div>
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-1">
													<IconUsers className="size-4 text-muted-foreground" aria-hidden="true" />
													{org.employeeCount}
												</div>
											</TableCell>
											<TableCell>{org.memberCount}</TableCell>
											<TableCell>
												{org.deletedAt ? (
													<div>
														<Badge variant="destructive">
															<IconTrash className="size-3 mr-1" aria-hidden="true" />
															{t("admin.organizations.badges.deleted", "Deleted")}
														</Badge>
														<div className="text-xs text-muted-foreground mt-1">
															{DateTime.fromJSDate(org.deletedAt).toRelative()}
														</div>
													</div>
												) : org.isSuspended ? (
													<div>
														<Badge variant="outline" className="border-yellow-500 text-yellow-700">
															<IconAlertTriangle className="size-3 mr-1" aria-hidden="true" />
															{t("admin.organizations.badges.suspended", "Suspended")}
														</Badge>
														{org.suspendedReason && (
															<div
																className="text-xs text-muted-foreground mt-1 max-w-32 truncate"
																title={org.suspendedReason}
															>
																{org.suspendedReason}
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
												{DateTime.fromJSDate(org.createdAt).toLocaleString(DateTime.DATE_MED)}
											</TableCell>
											<TableCell className="text-right">
												<div className="flex justify-end gap-2">
													{!org.deletedAt && (
														<>
															{org.isSuspended ? (
																<Button
																	variant="ghost"
																	size="sm"
																	onClick={() => handleUnsuspend(org)}
																	disabled={isPending}
																	aria-label={t("admin.organizations.toasts.unsuspended", "Organization \"{name}\" has been unsuspended", { name: org.name })}
																>
																	<IconPlayerPlay className="size-4" aria-hidden="true" />
																</Button>
															) : (
																<Button
																	variant="ghost"
																	size="sm"
																	onClick={() => setSuspendDialogOrg(org)}
																	aria-label={t("admin.organizations.suspendDialog.title", "Suspend Organization")}
																>
																	<IconPlayerPause className="size-4" aria-hidden="true" />
																</Button>
															)}
															<Button
																variant="ghost"
																size="sm"
																onClick={() => setDeleteDialogOrg(org)}
																aria-label={t("admin.organizations.deleteDialog.title", "Delete Organization")}
															>
																<IconTrash className="size-4" aria-hidden="true" />
															</Button>
														</>
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
						{t("admin.organizations.pagination.showing", "Showing {from} to {to} of {total} organizations", {
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

			{/* Suspend Dialog */}
			<Dialog open={!!suspendDialogOrg} onOpenChange={() => setSuspendDialogOrg(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("admin.organizations.suspendDialog.title", "Suspend Organization")}</DialogTitle>
						<DialogDescription>
							{t("admin.organizations.suspendDialog.description", "Suspend \"{name}\" and put it in read-only mode. Members will be able to view data but not create or edit anything.", { name: suspendDialogOrg?.name ?? "" })}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="suspendReason">{t("admin.organizations.suspendDialog.reason", "Reason")}</Label>
							<Textarea
								id="suspendReason"
								placeholder={t("admin.organizations.suspendDialog.reasonPlaceholder", "Enter the reason for suspending this organization…")}
								value={suspendReason}
								onChange={(e) => setSuspendReason(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setSuspendDialogOrg(null)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							variant="default"
							onClick={handleSuspend}
							disabled={!suspendReason || isPending}
						>
							{t("admin.organizations.suspendDialog.confirmButton", "Suspend Organization")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Dialog */}
			<Dialog
				open={!!deleteDialogOrg}
				onOpenChange={() => {
					setDeleteDialogOrg(null);
					setDeleteImmediate(false);
					setDeleteSkipNotification(false);
					setDeleteConfirmName("");
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("admin.organizations.deleteDialog.title", "Delete Organization")}</DialogTitle>
						<DialogDescription>
							{t("admin.organizations.deleteDialog.description", "This action will delete \"{name}\" and all associated data. This cannot be undone.", { name: deleteDialogOrg?.name ?? "" })}
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="flex items-center space-x-2">
							<Checkbox
								id="immediate"
								checked={deleteImmediate}
								onCheckedChange={(checked) => setDeleteImmediate(checked as boolean)}
							/>
							<Label htmlFor="immediate" className="text-sm font-normal">
								{t("admin.organizations.deleteDialog.immediateDelete", "Delete immediately (skip 5-day grace period)")}
							</Label>
						</div>
						<div className="flex items-center space-x-2">
							<Checkbox
								id="skipNotification"
								checked={deleteSkipNotification}
								onCheckedChange={(checked) => setDeleteSkipNotification(checked as boolean)}
							/>
							<Label htmlFor="skipNotification" className="text-sm font-normal">
								{t("admin.organizations.deleteDialog.skipNotification", "Skip deletion notification to org members")}
							</Label>
						</div>
						<div className="space-y-2">
							<Label htmlFor="confirmName">
								{t("admin.organizations.deleteDialog.confirmLabel", "Type \"{name}\" to confirm", { name: deleteDialogOrg?.name ?? "" })}
							</Label>
							<Input
								id="confirmName"
								value={deleteConfirmName}
								onChange={(e) => setDeleteConfirmName(e.target.value)}
								placeholder={t("admin.organizations.deleteDialog.confirmPlaceholder", "Organization name")}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteDialogOrg(null)}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							disabled={deleteConfirmName !== deleteDialogOrg?.name || isPending}
						>
							{t("admin.organizations.deleteDialog.confirmButton", "Delete Organization")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
