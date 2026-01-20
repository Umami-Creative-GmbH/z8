import { JoinOrganizationForm } from "@/components/join-organization-form";

interface JoinPageProps {
	params: Promise<{ code: string }>;
}

export default async function JoinPage({ params }: JoinPageProps) {
	const { code } = await params;
	return <JoinOrganizationForm code={code} />;
}
