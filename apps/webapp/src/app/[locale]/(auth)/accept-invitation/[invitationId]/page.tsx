import { AcceptInvitationForm } from "@/components/accept-invitation-form";

interface AcceptInvitationPageProps {
	params: Promise<{ invitationId: string }>;
}

export default async function AcceptInvitationPage({ params }: AcceptInvitationPageProps) {
	const { invitationId } = await params;
	return <AcceptInvitationForm invitationId={invitationId} />;
}
