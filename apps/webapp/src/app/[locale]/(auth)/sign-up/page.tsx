import { SignupForm } from "@/components/signup-form";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

interface PageProps {
	searchParams: Promise<{
		callbackUrl?: string;
		inviteCode?: string;
		invitedEmail?: string;
		invitationId?: string;
		organizationName?: string;
	}>;
}

export default async function Page({ searchParams }: PageProps) {
	const { callbackUrl, inviteCode, invitedEmail, invitationId, organizationName } = await searchParams;
	return (
		<SignupForm
			callbackUrl={callbackUrl}
			initialEmail={invitedEmail}
			initialInvitationId={invitationId}
			initialOrganizationName={organizationName}
			inviteCode={inviteCode}
		/>
	);
}
