import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { AuthContentLoading } from "@/components/shells/auth-content-loading";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

export default function Page() {
	return (
		<Suspense fallback={<AuthContentLoading />}>
			<ResetPasswordForm />
		</Suspense>
	);
}
