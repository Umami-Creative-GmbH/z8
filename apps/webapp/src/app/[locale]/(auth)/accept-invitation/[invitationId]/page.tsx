import { eq } from "drizzle-orm";
import { Suspense } from "react";
import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { AuthContentLoading } from "@/components/shells/auth-content-loading";
import { db, invitation as invitationTable } from "@/db";
import {
	compareInstants,
	instantFromDate,
	systemClock,
} from "@/lib/datetime/temporal-core";

interface AcceptInvitationPageProps {
	params: Promise<{ invitationId: string }>;
}

type InvitationWithRelations = typeof invitationTable.$inferSelect & {
	organization: { name: string } | null;
	user: { name: string | null } | null;
};

export default function AcceptInvitationPage(props: AcceptInvitationPageProps) {
	return (
		<Suspense fallback={<AuthContentLoading />}>
			<AcceptInvitationPageContent {...props} />
		</Suspense>
	);
}

async function AcceptInvitationPageContent({
	params,
}: AcceptInvitationPageProps) {
	const { invitationId } = await params;

	const invitation = await db.query.invitation.findFirst({
		where: eq(invitationTable.id, invitationId),
		with: {
			organization: {
				columns: {
					name: true,
				},
			},
			user: {
				columns: {
					name: true,
				},
			},
		},
	});
	const typedInvitation = invitation as unknown as
		| InvitationWithRelations
		| undefined;

	return (
		<AcceptInvitationForm
			invitation={
				typedInvitation
					? {
							email: typedInvitation.email,
							inviterName: typedInvitation.user?.name ?? null,
							isExpired:
								compareInstants(
									instantFromDate(typedInvitation.expiresAt),
									systemClock.nowInstant(),
								) < 0,
							organizationName: typedInvitation.organization?.name ?? null,
							role: typedInvitation.role ?? null,
							status: typedInvitation.status,
						}
					: null
			}
			invitationId={invitationId}
		/>
	);
}
