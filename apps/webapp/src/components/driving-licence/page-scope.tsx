"use client";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { useSession } from "@/lib/auth-client";

/** `my`: My driving licence. `team`: the Team & organization page and its check pages (#1937). */
export type DrivingLicencePageKind = "my" | "team";

export function DrivingLicencePageTitle({ kind }: { kind: DrivingLicencePageKind }) {
	const { t } = useTranslate();
	return kind === "my"
		? t("drivingLicence.myPage.title", "My driving licence")
		: t("drivingLicence.teamPage.title", "Driving licences");
}

export function DrivingLicencePageLoading({ kind }: { kind: DrivingLicencePageKind }) {
	const { t } = useTranslate();
	return (
		<div aria-busy="true" className="page-frame space-y-4">
			<PageHeader title={<DrivingLicencePageTitle kind={kind} />} />
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
	kind,
	organizationId,
	userId,
	children,
}: {
	kind: DrivingLicencePageKind;
	organizationId: string;
	userId: string;
	children: ReactNode;
}) {
	const { data: session } = useSession();
	if (
		session?.session.activeOrganizationId !== organizationId ||
		session.user.id !== userId
	) {
		return <DrivingLicencePageLoading kind={kind} />;
	}
	return children;
}
