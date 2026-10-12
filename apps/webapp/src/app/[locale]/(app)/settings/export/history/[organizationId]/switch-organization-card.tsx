"use client";

import { IconBuildingSkyscraper } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { exportHistoryPath } from "@/lib/export/types";
import { Link } from "@/navigation";

/**
 * Offers a switch to the organization an export-ready link belongs to. It
 * names only that organization; its export history loads after the switch,
 * once the org-admin guard has run for it as the active organization.
 */
export function ExportHistorySwitchOrganizationCard({
	organizationId,
	organizationName,
}: {
	organizationId: string;
	organizationName: string;
}) {
	const { t } = useTranslate();
	const params = new URLSearchParams({
		organizationId,
		callbackUrl: exportHistoryPath(organizationId),
	});
	const organization = { organization: organizationName };

	return (
		<div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
			<Card className="mx-auto w-full max-w-xl">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconBuildingSkyscraper className="size-5" aria-hidden="true" />
						{t(
							"settings.dataExport.history.switchOrganizationTitle",
							"Switch organization to see this export",
						)}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.dataExport.history.switchOrganizationBody",
							"This export belongs to {organization}. Switch to that organization to open its export history; your access is checked again after switching.",
							organization,
						)}
					</CardDescription>
				</CardHeader>
				<CardFooter className="flex flex-wrap gap-2">
					<Button asChild>
						<Link href={`/init?${params}`}>
							{t(
								"settings.dataExport.history.switchOrganizationAction",
								"Switch to {organization}",
								organization,
							)}
						</Link>
					</Button>
				</CardFooter>
			</Card>
		</div>
	);
}
