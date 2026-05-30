import { eq } from "drizzle-orm";
import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { db, invitation as invitationTable } from "@/db";

interface AcceptInvitationPageProps {
	params: Promise<{ invitationId: string }>;
}

type InvitationWithRelations = typeof invitationTable.$inferSelect & {
	organization: { name: string } | null;
	user: { name: string | null } | null;
};

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
	const typedInvitation = invitation as unknown as InvitationWithRelations | undefined;

	return (
		<AcceptInvitationForm
			invitation={
				typedInvitation
					? {
							email: typedInvitation.email,
							inviterName: typedInvitation.user?.name ?? null,
							isExpired: typedInvitation.expiresAt < new Date(),
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
