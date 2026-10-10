import { IconScale } from "@tabler/icons-react";
import Link from "next/link";
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
}: {
	code?: string;
	t: PayrollFailureTranslator;
	/**
	 * The payroll access covers only employees who have left (#995): instead
	 * of a dead end, point to the Work balances page, where payroll still
	 * records their overtime payouts.
	 */
	offerWorkBalances?: boolean;
}) {
	const accessDenied =
		code === "AuthenticationError" || code === "AuthorizationError";
	if (accessDenied && offerWorkBalances) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<Card className="max-w-md text-center">
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
								"There is no payroll period to prepare, but you can still record and cancel their overtime payouts.",
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
