"use client";

import { IconAlertCircle, IconBuilding, IconMail } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { CreateOrganizationDialog } from "@/components/organization/create-organization-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/navigation";
import { getNoEmployeeReason, type NoEmployeeReason } from "./no-employee-reason-action";

interface NoEmployeeErrorProps {
	feature?: string;
	showCreateOrg?: boolean;
	className?: string;
}

/** Why the viewer has no employee here; null (the generic message) until known or when unreadable. */
function useNoEmployeeReason(): NoEmployeeReason {
	const [reason, setReason] = useState<NoEmployeeReason>(null);
	useEffect(() => {
		let current = true;
		getNoEmployeeReason()
			.then((result) => {
				if (current && result.success) setReason(result.data);
			})
			.catch(() => {
				// The generic message stays.
			});
		return () => {
			current = false;
		};
	}, []);
	return reason;
}

type NoEmployeeCopy = {
	title: string;
	description: string;
	helpText: string;
	emailSubject: string;
	emailBody: string;
};

/** The texts for the reason, chosen once: a former employee (#1672) or anyone else. */
function useNoEmployeeCopy(reason: NoEmployeeReason, feature: string): NoEmployeeCopy {
	const { t } = useTranslate();
	if (reason === "former_employee") {
		return {
			title: t("errors.noEmployee.formerEmployee.title", "Your employment here has ended"),
			description: t(
				"errors.noEmployee.formerEmployee.description",
				"You are a member of this organization again, but your earlier employment ended. An administrator needs to rehire you before you can {feature}.",
				{ feature },
			),
			helpText: t(
				"errors.noEmployee.formerEmployee.helpText",
				"Ask your administrator to rehire you. Until then, you cannot use this organization.",
			),
			emailSubject: t("errors.noEmployee.formerEmployee.emailSubject", "Rehire Request"),
			emailBody: t(
				"errors.noEmployee.formerEmployee.emailBody",
				"Hi,\n\nI am a member of the organization again, but my earlier employment ended. Could you please rehire me so I can access the platform features?\n\nThank you!",
			),
		};
	}
	return {
		title: t("errors.noEmployee.title", "Employee Profile Required"),
		description: t(
			"errors.noEmployee.description",
			"You need an employee profile to {feature}. Please create an organization or contact your administrator.",
			{ feature },
		),
		helpText: t(
			"errors.noEmployee.helpText",
			"If you were invited to an organization, ask your administrator to set up your employee profile.",
		),
		emailSubject: t("errors.noEmployee.emailSubject", "Employee Profile Setup Required"),
		emailBody: t(
			"errors.noEmployee.emailBody",
			"Hi,\n\nI need an employee profile set up to access the platform features. Could you please assist me with this?\n\nThank you!",
		),
	};
}

export function NoEmployeeError({
	feature = "access this feature",
	showCreateOrg = true,
	className,
}: NoEmployeeErrorProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const reason = useNoEmployeeReason();
	const copy = useNoEmployeeCopy(reason, feature);
	// A former employee needs a rehire, not an organization of their own.
	const offerCreateOrg = showCreateOrg && reason !== "former_employee";

	const handleContactAdmin = () => {
		// Open mailto link for contacting support/admin
		const subject = encodeURIComponent(copy.emailSubject);
		const body = encodeURIComponent(copy.emailBody);
		window.location.href = `mailto:?subject=${subject}&body=${body}`;
	};

	return (
		<>
			<Card className={className}>
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
						<IconAlertCircle className="size-8 text-destructive" />
					</div>
					<CardTitle className="text-2xl">{copy.title}</CardTitle>
					<CardDescription className="text-base">{copy.description}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					{offerCreateOrg && (
						<Button className="w-full" size="lg" onClick={() => setCreateDialogOpen(true)}>
							<IconBuilding className="mr-2 size-5" />
							{t("errors.noEmployee.createOrg", "Create Organization")}
						</Button>
					)}
					<Button variant="outline" className="w-full" size="lg" onClick={handleContactAdmin}>
						<IconMail className="mr-2 size-5" />
						{t("errors.noEmployee.contactAdmin", "Contact Administrator")}
					</Button>
					<p className="text-center text-sm text-muted-foreground">{copy.helpText}</p>
				</CardContent>
			</Card>

			<CreateOrganizationDialog
				open={createDialogOpen}
				onOpenChange={setCreateDialogOpen}
				onSuccess={() => router.refresh()}
			/>
		</>
	);
}
