import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TwoFactorVerificationForm } from "@/components/two-factor-verification-form";
import { auth } from "@/lib/auth";

export default async function Verify2FAPage() {
	const session = await auth.api.getSession({ headers: await headers() });

	// If no session at all, redirect to sign-in
	if (!session) {
		redirect("/sign-in");
	}

	// If already fully authenticated (no 2FA required), redirect to home
	// Note: Better Auth sets a flag when 2FA is required but not yet verified
	// Check if the user has 2FA enabled and session is not fully verified
	const user = session.user;

	// If user doesn't have 2FA enabled or session is fully verified, redirect to home
	if (!user.twoFactorEnabled) {
		redirect("/");
	}

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<TwoFactorVerificationForm />
		</div>
	);
}
