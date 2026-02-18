"use client";

import {
	IconAddressBook,
	IconEdit,
	IconPlus,
	IconRefresh,
	IconTrash,
} from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteCustomer,
	getCustomers,
	type CustomerData,
} from "@/app/[locale]/(app)/settings/customers/actions";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { queryKeys } from "@/lib/query";
import { CustomerDialog } from "./customer-dialog";

interface CustomerManagementProps {
	organizationId: string;
}

export function CustomerManagement({ organizationId }: CustomerManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editingCustomer, setEditingCustomer] = useState<CustomerData | null>(null);
	const [deletingCustomer, setDeletingCustomer] = useState<CustomerData | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);

	const {
		data: customersResult,
		isLoading,
		isFetching,
		refetch,
	} = useQuery({
		queryKey: queryKeys.customers.list(organizationId),
		queryFn: async () => {
			const result = await getCustomers(organizationId);
			if (!result.success) throw new Error(result.error ?? "Unknown error");
			return result.data;
		},
	});

	const customers = customersResult || [];

	const handleCreate = () => {
		setEditingCustomer(null);
		setDialogOpen(true);
	};

	const handleEdit = (cust: CustomerData) => {
		setEditingCustomer(cust);
		setDialogOpen(true);
	};

	const handleSuccess = () => {
		queryClient.invalidateQueries({ queryKey: queryKeys.customers.list(organizationId) });
		setDialogOpen(false);
		setEditingCustomer(null);
	};

	const handleDelete = async () => {
		if (!deletingCustomer) return;
		setIsDeleting(true);
		const result = await deleteCustomer(deletingCustomer.id).then((response) => response, () => null);
		if (!result) {
			toast.error(t("settings.customers.deleteFailed", "Failed to delete customer"));
			setIsDeleting(false);
			setDeletingCustomer(null);
			return;
		}

		if (result.success) {
			toast.success(t("settings.customers.deleted", "Customer deleted"));
			queryClient.invalidateQueries({ queryKey: queryKeys.customers.list(organizationId) });
		} else {
			toast.error(result.error || t("settings.customers.deleteFailed", "Failed to delete customer"));
		}

			setIsDeleting(false);
			setDeletingCustomer(null);
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex items-center justify-between">
				<div className="flex flex-col gap-2">
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("settings.customers.title", "Customers")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.customers.description",
							"Manage customer contacts for project assignments",
						)}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isFetching}>
						<IconRefresh className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
						<span className="sr-only">{t("common.refresh", "Refresh")}</span>
					</Button>
					<Button onClick={handleCreate}>
						<IconPlus className="mr-2 h-4 w-4" />
						{t("settings.customers.create", "Add Customer")}
					</Button>
				</div>
			</div>

			{isLoading ? (
				<Card>
					<CardContent className="p-6">
						<div className="space-y-4">
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
							<Skeleton className="h-10 w-full" />
						</div>
					</CardContent>
				</Card>
			) : customers.length === 0 ? (
				<Card>
					<CardContent className="flex flex-col items-center justify-center py-12">
						<IconAddressBook className="h-12 w-12 text-muted-foreground" />
						<h3 className="mt-4 text-lg font-medium">
							{t("settings.customers.empty.title", "No customers yet")}
						</h3>
						<p className="mt-2 text-sm text-muted-foreground">
							{t(
								"settings.customers.empty.description",
								"Add your first customer to assign them to projects.",
							)}
						</p>
						<Button onClick={handleCreate} className="mt-4">
							<IconPlus className="mr-2 h-4 w-4" />
							{t("settings.customers.create", "Add Customer")}
						</Button>
					</CardContent>
				</Card>
			) : (
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.customers.list.title", "All Customers")}</CardTitle>
						<CardDescription>
							{t("settings.customers.list.description", "{count} customers total", {
								count: customers.length,
							})}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.customers.column.name", "Company Name")}</TableHead>
									<TableHead>
										{t("settings.customers.column.contactPerson", "Contact Person")}
									</TableHead>
									<TableHead>{t("settings.customers.column.email", "Email")}</TableHead>
									<TableHead>{t("settings.customers.column.phone", "Phone")}</TableHead>
									<TableHead className="w-[100px]" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{customers.map((cust) => (
									<TableRow key={cust.id}>
										<TableCell>
											<div className="font-medium">{cust.name}</div>
											{cust.address && (
												<div className="text-sm text-muted-foreground line-clamp-1">
													{cust.address}
												</div>
											)}
										</TableCell>
										<TableCell>
											{cust.contactPerson || (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{cust.email ? (
												<a
													href={`mailto:${cust.email}`}
													className="text-sm text-primary hover:underline"
												>
													{cust.email}
												</a>
											) : (
												<span className="text-muted-foreground">-</span>
											)}
										</TableCell>
										<TableCell>
											{cust.phone || <span className="text-muted-foreground">-</span>}
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-1">
												<Button
													variant="ghost"
													size="sm"
													onClick={() => handleEdit(cust)}
												>
													<IconEdit className="h-4 w-4" />
												</Button>
												<Button
													variant="ghost"
													size="sm"
													onClick={() => setDeletingCustomer(cust)}
												>
													<IconTrash className="h-4 w-4 text-destructive" />
												</Button>
											</div>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			)}

			<CustomerDialog
				organizationId={organizationId}
				customer={editingCustomer}
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSuccess={handleSuccess}
			/>

			<AlertDialog open={!!deletingCustomer} onOpenChange={() => setDeletingCustomer(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.customers.delete.title", "Delete Customer")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.customers.delete.description",
								'Are you sure you want to delete "{name}"? Projects assigned to this customer will keep working but the customer reference will be removed.',
								{ name: deletingCustomer?.name ?? "" },
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDelete}
							disabled={isDeleting}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{t("common.delete", "Delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
