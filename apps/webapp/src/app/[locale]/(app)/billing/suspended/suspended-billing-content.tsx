import { IconAlertTriangle } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
	getRenderOrganizationIdentity,
	getRenderUserOrganizations,
} from "@/lib/auth/render-context";
import { getAbility } from "@/lib/auth-helpers";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

export async function SuspendedBillingContent() {
	const [t, ability, identity, organizations] = await Promise.all([
		getTranslate(),
		getAbility(),
		getRenderOrganizationIdentity(),
		getRenderUserOrganizations(),
	]);
	const canManageBilling = ability?.can("manage", "OrgBilling") ?? false;
	const organization = organizations.find(
		({ id }) => id === identity?.organizationId,
	);

	return (
		<div className="flex flex-1 items-center justify-center px-4 py-6 sm:p-6">
			<Card className="my-auto w-full max-w-xl gap-5 shadow-none">
				<CardHeader className="gap-4">
					<div className="flex size-10 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
						<IconAlertTriangle aria-hidden="true" className="size-5" />
					</div>
					<PageHeader
						scope={organization?.name}
						title={t("billing.suspended.title", "Organization suspended")}
						description={t(
							"billing.suspended.accessConsequence",
							"Access to this organization is paused until billing is updated.",
						)}
					/>
				</CardHeader>
				<CardContent className="space-y-4">
					<p className="break-words text-sm leading-relaxed text-muted-foreground">
						{canManageBilling
							? t(
									"billing.suspended.adminDescription",
									"Your trial ended or subscription is no longer valid. Update billing to continue using Z8.",
								)
							: t(
									"billing.suspended.memberDescription",
									"This organization is suspended. Contact an organization admin to update billing.",
								)}
					</p>
					{canManageBilling ? (
						<Button
							asChild
							className="h-auto min-h-11 w-full whitespace-normal text-center sm:w-auto"
						>
							<Link href="/settings/billing">
								{t("billing.suspended.goToBilling", "Go to billing")}
							</Link>
						</Button>
					) : null}
				</CardContent>
			</Card>
		</div>
	);
}
