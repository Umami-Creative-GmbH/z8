import { eq } from "drizzle-orm";
import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { db, invitation as invitationTable } from "@/db";

interface AcceptInvitationPageProps {
	params: Promise<{ invitationId: string }>;
}

export default async function AcceptInvitationPage({ params }: AcceptInvitationPageProps) {
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

	return (
		<AcceptInvitationForm
			invitation={
				invitation
					? {
						email: invitation.email,
						inviterName: invitation.user?.name ?? null,
						isExpired: invitation.expiresAt < new Date(),
						organizationName: invitation.organization?.name ?? null,
						role: invitation.role ?? null,
						status: invitation.status,
					}
					: null
			}
			invitationId={invitationId}
		/>
	);
}
