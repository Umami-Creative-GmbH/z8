import { redirect } from "next/navigation";
import { Suspense } from "react";
import { NoOrganizationError } from "@/components/errors/no-organization-error";
import { SectionCards, SectionCardsSkeleton } from "@/components/section-cards";
import {
	getOnboardingStatus,
	getPendingInvitationId,
	getUserOrganizations,
} from "@/lib/auth-helpers";
import { getOnboardingStepPath } from "@/lib/validations/onboarding";

async function DashboardPageContent() {
	// Fetch onboarding status and organizations in parallel to eliminate waterfall
	const [onboardingStatus, organizations, pendingInvitationId] =
		await Promise.all([
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
		</div>
	);
}

function DashboardPageLoading() {
	return (
		<div
			aria-label="Loading dashboard"
			className="@container/main flex flex-1 flex-col gap-2"
			role="status"
		>
			<div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
				<SectionCardsSkeleton aria-hidden="true" />
			</div>
		</div>
	);
}

export default function Page() {
	return (
		<Suspense fallback={<DashboardPageLoading />}>
			<DashboardPageContent />
		</Suspense>
	);
}
