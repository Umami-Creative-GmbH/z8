import { Suspense } from "react";
import { JoinOrganizationForm } from "@/components/join-organization-form";
import { AuthContentLoading } from "@/components/shells/auth-content-loading";

interface JoinPageProps {
	params: Promise<{ code: string }>;
}

async function JoinPageContent({ params }: JoinPageProps) {
	const { code } = await params;
	return <JoinOrganizationForm code={code} />;
}

export default function JoinPage(props: JoinPageProps) {
	return (
		<Suspense fallback={<AuthContentLoading />}>
			<JoinPageContent {...props} />
		</Suspense>
	);
}
