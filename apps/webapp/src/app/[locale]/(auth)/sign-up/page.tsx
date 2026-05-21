import { Suspense } from "react";
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

async function SignUpPageContent({ searchParams }: PageProps) {
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

export default function Page(props: PageProps) {
	return (
		<Suspense fallback={null}>
			<SignUpPageContent {...props} />
		</Suspense>
	);
}
