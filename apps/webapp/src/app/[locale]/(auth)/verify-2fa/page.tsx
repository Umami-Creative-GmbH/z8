import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { TwoFactorVerificationForm } from "@/components/two-factor-verification-form";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { auth } from "@/lib/auth";

export default function Verify2FAPage() {
	return (
		<Suspense fallback={<Verify2FAPageLoading />}>
			<Verify2FAPageContent />
		</Suspense>
	);
}

export async function Verify2FAPageContent() {
	const session = await auth.api.getSession({ headers: await headers() });

	// Pending 2FA uses Better Auth's temporary 2FA cookie before a full session exists.
	if (session) {
		redirect("/");
	}

	return (
		<div className="mx-auto w-full max-w-md">
			<TwoFactorVerificationForm />
		</div>
	);
}

function Verify2FAPageLoading() {
	return (
		<div
			className="mx-auto w-full max-w-md"
			role="status"
			aria-label="Loading two-factor verification"
		>
			<Card>
				<CardHeader className="space-y-2">
					<Skeleton aria-hidden="true" className="h-6 w-52" />
					<Skeleton aria-hidden="true" className="h-4 w-full max-w-xs" />
				</CardHeader>
				<CardContent className="space-y-4">
					<Skeleton
						aria-hidden="true"
						className="mx-auto h-10 w-64 max-w-full"
					/>
					<Skeleton aria-hidden="true" className="h-10 w-full" />
					<Skeleton aria-hidden="true" className="mx-auto h-9 w-44" />
				</CardContent>
			</Card>
		</div>
	);
}
