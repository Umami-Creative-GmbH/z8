"use client";

import { IconBuilding, IconInbox } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { CreateOrganizationDialog } from "@/components/organization/create-organization-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "@/navigation";
import { useRouter } from "@/navigation";

interface NoOrganizationErrorProps {
	className?: string;
}

export function NoOrganizationError({ className }: NoOrganizationErrorProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);

	return (
		<>
			<Card className={className}>
				<CardHeader className="text-center">
					<div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-full bg-muted">
						<IconBuilding className="size-8 text-muted-foreground" />
					</div>
					<CardTitle className="text-2xl">
						{t("errors.noOrganization.title", "No Organization Found")}
					</CardTitle>
					<CardDescription className="text-base">
						{t(
							"errors.noOrganization.description",
							"You're not part of any organization yet. Create one to get started or wait for an invitation.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<Button className="w-full" size="lg" onClick={() => setCreateDialogOpen(true)}>
						<IconBuilding className="mr-2 size-5" />
						{t("errors.noOrganization.createOrg", "Create Organization")}
					</Button>

					<div className="relative">
						<div className="absolute inset-0 flex items-center">
							<span className="w-full border-t" />
						</div>
						<div className="relative flex justify-center text-xs uppercase">
							<span className="bg-card px-2 text-muted-foreground">
								{t("common.or", "Or")}
							</span>
						</div>
					</div>

					<div className="rounded-lg border border-dashed p-4 text-center">
						<IconInbox className="mx-auto mb-2 size-8 text-muted-foreground" />
						<p className="mb-1 font-medium">{t("errors.noOrganization.waiting", "Waiting for an invitation?")}</p>
						<p className="text-sm text-muted-foreground">
							{t(
								"errors.noOrganization.waitingDesc",
								"Your administrator will send you an invitation email. Check your inbox and spam folder.",
							)}
						</p>
					</div>
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
