import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { TwoFactorVerificationForm } from "@/components/two-factor-verification-form";
import { auth } from "@/lib/auth";

export default async function Verify2FAPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	const session = await auth.api.getSession({ headers: await headers() });

	// Pending 2FA uses Better Auth's temporary 2FA cookie before a full session exists.
	if (session) {
		redirect("/");
	}

	return <TwoFactorVerificationForm />;
}
