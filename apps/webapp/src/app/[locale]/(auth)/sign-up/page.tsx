import { SignupForm } from "@/components/signup-form";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

interface PageProps {
	searchParams: Promise<{ inviteCode?: string }>;
}

export default async function Page({ searchParams }: PageProps) {
	const { inviteCode } = await searchParams;
	return <SignupForm inviteCode={inviteCode} />;
}
