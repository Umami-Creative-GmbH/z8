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
}: {
	code?: string;
	t: PayrollFailureTranslator;
}) {
	const accessDenied =
		code === "AuthenticationError" || code === "AuthorizationError";
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
