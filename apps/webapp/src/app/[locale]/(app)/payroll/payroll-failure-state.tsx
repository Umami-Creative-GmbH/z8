import { IconScale } from "@tabler/icons-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export type PayrollFailureTranslator = (
	key: string,
	fallback: string,
) => string;

export function PayrollFailureState({
	code,
	t,
	offerWorkBalances = false,
	exportEntry,
}: {
	code?: string;
	t: PayrollFailureTranslator;
	/**
	 * The payroll access covers only employees who have left (#995): instead
	 * of a dead end, point to the Work balances page, where payroll still
	 * records their overtime payouts.
	 */
	offerWorkBalances?: boolean;
	/**
	 * Beside the Work balances link: the export of a period in which one of
	 * those employees was still employed (#1001).
	 */
	exportEntry?: ReactNode;
}) {
	const accessDenied =
		code === "AuthenticationError" || code === "AuthorizationError";
	if (accessDenied && offerWorkBalances) {
		return (
			<div className="@container/main flex flex-1 flex-col items-center justify-center gap-6 p-6">
				<Card className="w-full max-w-md text-center">
					<CardHeader>
						<CardTitle>
							{t(
								"payroll.onlyFormerEmployees.title",
								"Only employees who have left are in your payroll access",
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"payroll.onlyFormerEmployees.description",
								"You can still record and cancel their overtime payouts, and export below the months in which they were employed.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button asChild>
							<Link href="/payroll/work-balances">
								<IconScale aria-hidden="true" className="size-4" />
								{t("payroll.workBalances.open", "Work balances")}
							</Link>
						</Button>
					</CardContent>
				</Card>
				{exportEntry}
			</div>
		);
	}
	const title = accessDenied
		? t("payroll.accessDenied.title", "No payroll access")
		: t("payroll.unavailable.title", "Payroll temporarily unavailable");
	const description = accessDenied
		? t(
				"payroll.accessDenied.description",
				"You do not have access to payroll data for the active organization.",
			)
		: t(
				"payroll.unavailable.description",
				"Payroll data could not be prepared safely.",
			);
	const help = accessDenied
		? t(
				"payroll.accessDenied.help",
				"Ask an organization administrator to assign payroll access if you need this workspace.",
			)
		: t(
				"payroll.unavailable.help",
				"Please try again later. If the problem continues, contact an organization administrator.",
			);

	return (
		<div className="@container/main flex flex-1 items-center justify-center p-6">
			<Card className="max-w-md text-center">
				<CardHeader>
					<CardTitle>{title}</CardTitle>
					<CardDescription>{description}</CardDescription>
				</CardHeader>
				<CardContent className="text-muted-foreground text-sm">
					{help}
				</CardContent>
			</Card>
		</div>
	);
}
