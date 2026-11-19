"use client";

import { useTranslate } from "@tolgee/react";
import { Fragment, type ReactNode, useTransition } from "react";
import { useOrganization } from "@/components/providers/organization-context-provider";
import { useSession } from "@/lib/auth-client";
import { TravelExpenseLoadError } from "../travel-expense-load-error";

/** Retires displayed finance evidence; canonical readers still decide access. */
export function FinanceReadBoundary({
	children,
	requireEmployee = true,
	loading,
	errorMessage,
}: {
	children: ReactNode;
	/** Coverage settings also admit administrators without an employee profile. */
	requireEmployee?: boolean;
	loading?: ReactNode;
	errorMessage?: string;
}) {
	const current = useOrganization();
	const session = useSession();
	const { t } = useTranslate();
	const [isRetrying, startRetry] = useTransition();
	const organizationId = current.activeOrganizationId;
	const matches =
		!session.isPending &&
		!current.isLoading &&
		!current.error &&
		Boolean(organizationId) &&
		current.userId === session.data?.user.id &&
		organizationId === session.data?.session.activeOrganizationId &&
		(!requireEmployee ||
			(Boolean(current.employeeId) && current.organizationId === organizationId));
	if (!matches) {
		if (session.isPending || current.isLoading)
			return (
				loading ?? (
					<p role="status">
						{t("travelExpenses.finance.scope.loading", "Confirming finance access…")}
					</p>
				)
			);
		if (current.error)
			return (
				<TravelExpenseLoadError
					message={
						errorMessage ??
						t(
							"travelExpenses.finance.scope.failed",
							"Your current finance access could not be confirmed. Please retry.",
						)
					}
					retry={() => {
						startRetry(async () => {
							await current.refetch();
						});
					}}
					isRetrying={isRetrying}
				/>
			);
		return null;
	}
	const identity = JSON.stringify([
		current.userId,
		organizationId,
		current.employeeId,
		current.role,
	]);
	return <Fragment key={identity}>{children}</Fragment>;
}
