import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoOrganizationError } from "@/components/errors/no-organization-error";
import { SectionCards, SectionCardsSkeleton } from "@/components/section-cards";
import { getOnboardingStatus, getUserOrganizations } from "@/lib/auth-helpers";
import { getOnboardingStepPath } from "@/lib/validations/onboarding";

export default async function Page() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Fetch onboarding status and organizations in parallel to eliminate waterfall
	const [onboardingStatus, organizations] = await Promise.all([
		getOnboardingStatus(),
		getUserOrganizations(),
	]);

	// Redirect if onboarding not complete
	if (onboardingStatus && !onboardingStatus.onboardingComplete) {
		redirect(getOnboardingStepPath(onboardingStatus.onboardingStep));
	}
	const hasOrganizations = organizations.length > 0;

	if (!hasOrganizations) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoOrganizationError />
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-2">
			<div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
				<Suspense fallback={<SectionCardsSkeleton />}>
					<SectionCards />
				</Suspense>
			</div>
		</div>
	);
}
