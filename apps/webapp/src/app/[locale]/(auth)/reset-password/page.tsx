import { Suspense } from "react";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { AuthContentLoading } from "@/components/shells/auth-content-loading";

export default function Page() {
	return (
		<Suspense fallback={<AuthContentLoading />}>
			<ResetPasswordForm />
		</Suspense>
	);
}
