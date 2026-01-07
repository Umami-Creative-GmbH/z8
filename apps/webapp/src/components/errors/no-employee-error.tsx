"use client";

import { IconAlertCircle, IconBuilding, IconMail } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { CreateOrganizationDialog } from "@/components/organization/create-organization-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/navigation";

interface NoEmployeeErrorProps {
	feature?: string;
	showCreateOrg?: boolean;
	className?: string;
}

export function NoEmployeeError({
	feature = "access this feature",
	showCreateOrg = true,
	className,
}: NoEmployeeErrorProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);

	const handleContactAdmin = () => {
		// Open mailto link for contacting support/admin
		const subject = encodeURIComponent(t("errors.noEmployee.emailSubject", "Employee Profile Setup Required"));
		const body = encodeURIComponent(
			t(
				"errors.noEmployee.emailBody",
				"Hi,\n\nI need an employee profile set up to access the platform features. Could you please assist me with this?\n\nThank you!",
			),
		);
		window.location.href = `mailto:?subject=${subject}&body=${body}`;
	};

	return (
		<>
			<Card className={className}>
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-destructive/10">
						<IconAlertCircle className="size-8 text-destructive" />
					</div>
					<CardTitle className="text-2xl">
						{t("errors.noEmployee.title", "Employee Profile Required")}
					</CardTitle>
					<CardDescription className="text-base">
						{t(
							"errors.noEmployee.description",
							`You need an employee profile to ${feature}. Please create an organization or contact your administrator.`,
							{ feature },
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					{showCreateOrg && (
						<Button className="w-full" size="lg" onClick={() => setCreateDialogOpen(true)}>
							<IconBuilding className="mr-2 size-5" />
							{t("errors.noEmployee.createOrg", "Create Organization")}
						</Button>
					)}
					<Button variant="outline" className="w-full" size="lg" onClick={handleContactAdmin}>
						<IconMail className="mr-2 size-5" />
						{t("errors.noEmployee.contactAdmin", "Contact Administrator")}
					</Button>
					<p className="text-center text-sm text-muted-foreground">
						{t(
							"errors.noEmployee.helpText",
							"If you were invited to an organization, ask your administrator to set up your employee profile.",
						)}
					</p>
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
