import { Suspense } from "react";
import dynamic from "next/dynamic";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { NoOrganizationError } from "@/components/errors/no-organization-error";
import { SectionCards, SectionCardsSkeleton } from "@/components/section-cards";
import { getOnboardingStatus, getPendingInvitationId, getUserOrganizations } from "@/lib/auth-helpers";
import { getOnboardingStepPath } from "@/lib/validations/onboarding";

const AppTour = dynamic(() => import("@/components/tour/app-tour").then((m) => m.AppTour));

export default async function Page() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Fetch onboarding status and organizations in parallel to eliminate waterfall
	const [onboardingStatus, organizations, pendingInvitationId] = await Promise.all([
		getOnboardingStatus(),
		getUserOrganizations(),
		getPendingInvitationId(),
	]);
	const hasOrganizations = organizations.length > 0;

	if (!hasOrganizations && pendingInvitationId) {
		redirect(`/accept-invitation/${pendingInvitationId}`);
	}

	// Redirect if onboarding not complete
	if (onboardingStatus && !onboardingStatus.onboardingComplete) {
		redirect(getOnboardingStepPath(onboardingStatus.onboardingStep));
	}

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
			<AppTour />
		</div>
	);
}
