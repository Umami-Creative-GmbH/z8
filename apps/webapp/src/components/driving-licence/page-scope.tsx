"use client";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { useSession } from "@/lib/auth-client";

export function DrivingLicencePageLoading() {
	const { t } = useTranslate();
	return (
		<div aria-busy="true" className="page-frame space-y-4">
			<PageHeader title={t("drivingLicence.page.title", "Driving licence")} />
			<p role="status" className="text-sm text-muted-foreground">
				{t(
					"drivingLicence.page.reconciling",
					"Loading driving licence access for the current organization…",
				)}
			</p>
		</div>
	);
}

/** Server-granted panels may render only for the identity that authorized that snapshot. */
export function DrivingLicencePageScope({
	organizationId,
	userId,
	children,
}: {
	organizationId: string;
	userId: string;
	children: ReactNode;
}) {
	const { data: session } = useSession();
	if (
		session?.session.activeOrganizationId !== organizationId ||
		session.user.id !== userId
	) {
		return <DrivingLicencePageLoading />;
	}
	return children;
}
