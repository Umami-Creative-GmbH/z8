"use client";

import { IconPlus } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { getMyTravelExpenseClaims } from "@/app/[locale]/(app)/travel-expenses/actions";
import { Button } from "@/components/ui/button";
import { queryKeys } from "@/lib/query";
import { TravelExpenseClaimDialog } from "./travel-expense-claim-dialog";
import { TravelExpenseList } from "./travel-expense-list";

interface TravelExpenseManagementProps {
	organizationId: string;
	employeeId: string;
}

export function TravelExpenseManagement({
	organizationId,
	employeeId,
}: TravelExpenseManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [isDialogOpen, setIsDialogOpen] = useState(false);

	const queryKey = queryKeys.travelExpenses.list({ organizationId, employeeId });

	const { data, isLoading, isFetching } = useQuery({
		queryKey,
		queryFn: async () => {
			const result = await getMyTravelExpenseClaims();
			if (!result.success) {
				throw new Error(
					result.error ||
						t("travelExpenses.errors.loadClaims", "Failed to load travel expense claims"),
				);
			}
			return result.data;
		},
	});

	const claims = data || [];

	const handleCreated = async () => {
		await queryClient.invalidateQueries({ queryKey: queryKeys.travelExpenses.list() });
		setIsDialogOpen(false);
	};

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			<div className="flex items-center justify-between px-4 lg:px-6">
				<div>
					<h1 className="text-2xl font-semibold tracking-tight">
						{t("travelExpenses.title", "Travel Expenses")}
					</h1>
					<p className="text-sm text-muted-foreground">
						{t("travelExpenses.description", "Create and track your travel expense claims")}
					</p>
				</div>
				<Button onClick={() => setIsDialogOpen(true)}>
					<IconPlus className="mr-2 size-4" aria-hidden="true" />
					{t("travelExpenses.actions.newClaim", "New Claim")}
				</Button>
			</div>

			<div className="px-4 lg:px-6">
				<TravelExpenseList claims={claims} isLoading={isLoading || isFetching} />
			</div>

			<TravelExpenseClaimDialog
				open={isDialogOpen}
				onOpenChange={setIsDialogOpen}
				onCreated={handleCreated}
			/>
		</div>
	);
}
