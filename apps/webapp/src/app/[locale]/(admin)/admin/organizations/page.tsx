"use client";

import { useState, useTransition, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { DateTime } from "luxon";
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
import {
	listOrganizationsAction,
	suspendOrganizationAction,
	unsuspendOrganizationAction,
	deleteOrganizationAction,
} from "./actions";

const PAGE_SIZE = 20;

export default function OrganizationsPage() {
	const router = useRouter();
	const searchParams = useSearchParams();

	const [organizations, setOrganizations] = useState<PlatformOrganization[]>([]);
	const [total, setTotal] = useState(0);
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState(searchParams.get("search") ?? "");
	const [status, setStatus] = useState<"all" | "active" | "suspended" | "deleted">(
		(searchParams.get("status") as "all" | "active" | "suspended" | "deleted") ?? "all",
	);
	const [isLoading, setIsLoading] = useState(true);
	const [isPending, startTransition] = useTransition();
	const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

	// Dialog states
	const [suspendDialogOrg, setSuspendDialogOrg] = useState<PlatformOrganization | null>(null);
	const [suspendReason, setSuspendReason] = useState("");
	const [deleteDialogOrg, setDeleteDialogOrg] = useState<PlatformOrganization | null>(null);
	const [deleteImmediate, setDeleteImmediate] = useState(false);
	const [deleteSkipNotification, setDeleteSkipNotification] = useState(false);
	const [deleteConfirmName, setDeleteConfirmName] = useState("");

	// Fetch organizations with explicit parameters to avoid race conditions
	const fetchOrganizations = async (
		searchVal = search,
		statusVal = status,
		pageVal = page,
	) => {
		setIsLoading(true);
		const result = await listOrganizationsAction({ search: searchVal, status: statusVal }, pageVal, PAGE_SIZE);
		if (result.success) {
			setOrganizations(result.data.data);
			setTotal(result.data.total);
		} else {
			toast.error(result.error);
		}
		setIsLoading(false);
	};

	// Initial load
	useEffect(() => {
		fetchOrganizations();
	}, []);

	// Debounced search with immediate status change
	const handleFilterChange = useCallback((newSearch: string, newStatus: "all" | "active" | "suspended" | "deleted") => {
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
			startTransition(() => {
				fetchOrganizations(newSearch, newStatus, 1);
			});
			return;
		}

		// Debounce search input (300ms)
		searchTimeoutRef.current = setTimeout(() => {
			setPage(1);
			const params = new URLSearchParams();
			if (newSearch) params.set("search", newSearch);
			if (newStatus !== "all") params.set("status", newStatus);
			router.push(`/admin/organizations?${params.toString()}`);
			startTransition(() => {
				fetchOrganizations(newSearch, newStatus, 1);
			});
		}, 300);
	}, [status, router]);

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
				toast.success(`Organization "${suspendDialogOrg.name}" has been suspended`);
				setSuspendDialogOrg(null);
				setSuspendReason("");
				fetchOrganizations();
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
				toast.success(`Organization "${org.name}" has been unsuspended`);
				fetchOrganizations();
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
						? `Organization "${deleteDialogOrg.name}" has been scheduled for immediate deletion`
						: `Organization "${deleteDialogOrg.name}" has been scheduled for deletion in 5 days`,
				);
				setDeleteDialogOrg(null);
				setDeleteImmediate(false);
				setDeleteSkipNotification(false);
				setDeleteConfirmName("");
				fetchOrganizations();
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
				<h1 className="text-2xl font-semibold tracking-tight">Organization Management</h1>
				<p className="text-muted-foreground">
					View and manage all organizations on the platform
				</p>
			</div>

			{/* Filters */}
			<div className="flex flex-col gap-4 sm:flex-row">
				<div className="relative flex-1">
					<IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" aria-hidden="true" />
					<Input
						placeholder="Search by name or slug…"
						name="search"
						autoComplete="off"
						value={search}
						onChange={(e) => handleFilterChange(e.target.value, status)}
						className="pl-9"
					/>
				</div>
				<Select
					value={status}
					onValueChange={(v) => handleFilterChange(search, v as "all" | "active" | "suspended" | "deleted")}
				>
					<SelectTrigger className="w-full sm:w-40">
						<SelectValue placeholder="Status" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All</SelectItem>
						<SelectItem value="active">Active</SelectItem>
						<SelectItem value="suspended">Suspended</SelectItem>
						<SelectItem value="deleted">Deleted</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{/* Organizations Table */}
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
									<TableHead>Organization</TableHead>
									<TableHead>Employees</TableHead>
									<TableHead>Members</TableHead>
									<TableHead>Status</TableHead>
									<TableHead>Created</TableHead>
									<TableHead className="text-right">Actions</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{organizations.length === 0 ? (
									<TableRow>
										<TableCell colSpan={6} className="text-center text-muted-foreground">
											No organizations found
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
														<div className="text-sm text-muted-foreground">
															{org.slug}
														</div>
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
															Deleted
														</Badge>
														<div className="text-xs text-muted-foreground mt-1">
															{DateTime.fromJSDate(org.deletedAt).toRelative()}
														</div>
													</div>
												) : org.isSuspended ? (
													<div>
														<Badge variant="outline" className="border-yellow-500 text-yellow-700">
															<IconAlertTriangle className="size-3 mr-1" aria-hidden="true" />
															Suspended
														</Badge>
														{org.suspendedReason && (
															<div className="text-xs text-muted-foreground mt-1 max-w-32 truncate" title={org.suspendedReason}>
																{org.suspendedReason}
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
																	aria-label="Unsuspend organization"
																>
																	<IconPlayerPlay className="size-4" aria-hidden="true" />
																</Button>
															) : (
																<Button
																	variant="ghost"
																	size="sm"
																	onClick={() => setSuspendDialogOrg(org)}
																	aria-label="Suspend organization"
																>
																	<IconPlayerPause className="size-4" aria-hidden="true" />
																</Button>
															)}
															<Button
																variant="ghost"
																size="sm"
																onClick={() => setDeleteDialogOrg(org)}
																aria-label="Delete organization"
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
						Showing <span className="font-medium text-foreground">{(page - 1) * PAGE_SIZE + 1}</span> to{" "}
						<span className="font-medium text-foreground">{Math.min(page * PAGE_SIZE, total)}</span> of{" "}
						<span className="font-medium text-foreground">{total}</span> organizations
					</p>
					<div className="flex gap-2">
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								const newPage = page - 1;
								setPage(newPage);
								fetchOrganizations(search, status, newPage);
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
								fetchOrganizations(search, status, newPage);
							}}
							disabled={page >= totalPages}
						>
							Next
						</Button>
					</div>
				</div>
			)}

			{/* Suspend Dialog */}
			<Dialog open={!!suspendDialogOrg} onOpenChange={() => setSuspendDialogOrg(null)}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Suspend Organization</DialogTitle>
						<DialogDescription>
							Suspend "{suspendDialogOrg?.name}" and put it in read-only mode.
							Members will be able to view data but not create or edit anything.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4 py-4">
						<div className="space-y-2">
							<Label htmlFor="suspendReason">Reason</Label>
							<Textarea
								id="suspendReason"
								placeholder="Enter the reason for suspending this organization…"
								value={suspendReason}
								onChange={(e) => setSuspendReason(e.target.value)}
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setSuspendDialogOrg(null)}>
							Cancel
						</Button>
						<Button
							variant="default"
							onClick={handleSuspend}
							disabled={!suspendReason || isPending}
						>
							Suspend Organization
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Dialog */}
			<Dialog open={!!deleteDialogOrg} onOpenChange={() => {
				setDeleteDialogOrg(null);
				setDeleteImmediate(false);
				setDeleteSkipNotification(false);
				setDeleteConfirmName("");
			}}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete Organization</DialogTitle>
						<DialogDescription>
							This action will delete "{deleteDialogOrg?.name}" and all associated data.
							This cannot be undone.
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
								Delete immediately (skip 5-day grace period)
							</Label>
						</div>
						<div className="flex items-center space-x-2">
							<Checkbox
								id="skipNotification"
								checked={deleteSkipNotification}
								onCheckedChange={(checked) => setDeleteSkipNotification(checked as boolean)}
							/>
							<Label htmlFor="skipNotification" className="text-sm font-normal">
								Skip deletion notification to org members
							</Label>
						</div>
						<div className="space-y-2">
							<Label htmlFor="confirmName">
								Type "{deleteDialogOrg?.name}" to confirm
							</Label>
							<Input
								id="confirmName"
								value={deleteConfirmName}
								onChange={(e) => setDeleteConfirmName(e.target.value)}
								placeholder="Organization name"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setDeleteDialogOrg(null)}>
							Cancel
						</Button>
						<Button
							variant="destructive"
							onClick={handleDelete}
							disabled={deleteConfirmName !== deleteDialogOrg?.name || isPending}
						>
							Delete Organization
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}
