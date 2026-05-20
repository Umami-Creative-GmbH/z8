import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAbility } from "@/lib/auth-helpers";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

export default async function SuspendedBillingPage() {
	const [t, ability] = await Promise.all([getTranslate(), getAbility()]);
	const canManageBilling = ability?.can("manage", "OrgBilling") ?? false;

	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<Card className="w-full max-w-lg border-destructive/20">
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10">
						<IconAlertTriangle aria-hidden="true" className="size-6 text-destructive" />
					</div>
					<CardTitle>{t("billing.suspended.title", "Organization suspended")}</CardTitle>
					<CardDescription>
						{canManageBilling
							? t(
									"billing.suspended.adminDescription",
									"Your trial ended or subscription is no longer valid. Update billing to continue using Z8.",
								)
							: t(
									"billing.suspended.memberDescription",
									"This organization is suspended. Contact an organization admin to update billing.",
								)}
					</CardDescription>
				</CardHeader>
				{canManageBilling ? (
					<CardContent>
						<Button asChild className="w-full">
							<Link href="/settings/billing">
								{t("billing.suspended.goToBilling", "Go to billing")}
							</Link>
						</Button>
					</CardContent>
				) : null}
			</Card>
		</div>
	);
}
