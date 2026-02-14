"use client";

import {
	IconBriefcase,
	IconBuilding,
	IconClock,
	IconLoader2,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/navigation";
import { startOnboarding, updateOnboardingStep, getOnboardingSummary } from "./actions";

export default function WelcomePage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [hasOrganization, setHasOrganization] = useState(false);
	const [organizationName, setOrganizationName] = useState<string | null>(null);

	// Mark onboarding as started and check if user already has an organization
	useEffect(() => {
		const init = async () => {
			await startOnboarding();
			// Check if user already has an organization (e.g., joined via invite code)
			const summary = await getOnboardingSummary();
			if (summary.success && summary.data?.hasOrganization) {
				setHasOrganization(true);
				setOrganizationName(summary.data.organizationName || null);
			}
		};
		init();
	}, []);

	const handleGetStarted = async () => {
		setLoading(true);
		// If user already has an organization (joined via invite code), skip to profile
		if (hasOrganization) {
			await updateOnboardingStep("profile");
			router.push("/onboarding/profile");
		} else {
			// Otherwise, go to organization setup
			await updateOnboardingStep("organization");
			router.push("/onboarding/organization");
		}
	};

	return (
		<>
			<ProgressIndicator currentStep="welcome" />

			<div className="mx-auto max-w-3xl text-center">
				{/* Hero Section */}
				<div className="mb-8">
					<div className="mb-4 inline-flex size-20 items-center justify-center rounded-full bg-primary/10">
						<IconBuilding className="size-10 text-primary" />
					</div>
					<h1 className="mb-4 text-4xl font-bold tracking-tight">
						{t("onboarding.welcome.title", "Welcome to Z8!")}
					</h1>
					<p className="text-lg text-muted-foreground">
						{t(
							"onboarding.welcome.subtitle",
							"Let's get you started with a quick setup. This will only take a few minutes.",
						)}
					</p>
				</div>

				{/* Feature Cards */}
				<div className="mb-10 grid gap-4 sm:grid-cols-3">
					<Card>
						<CardHeader className="pb-3">
							<div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10">
								<IconClock className="size-5 text-primary" />
							</div>
							<CardTitle className="text-base">
								{t("onboarding.welcome.features.timeTracking", "Time Tracking")}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								{t(
									"onboarding.welcome.features.timeTrackingDesc",
									"Clock in and out, track work hours, and manage time corrections",
								)}
							</CardDescription>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-3">
							<div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10">
								<IconBriefcase className="size-5 text-primary" />
							</div>
							<CardTitle className="text-base">
								{t("onboarding.welcome.features.absences", "Absence Management")}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								{t(
									"onboarding.welcome.features.absencesDesc",
									"Request time off, manage vacation days, and track holidays",
								)}
							</CardDescription>
						</CardContent>
					</Card>

					<Card>
						<CardHeader className="pb-3">
							<div className="mb-2 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10">
								<IconUsers className="size-5 text-primary" />
							</div>
							<CardTitle className="text-base">
								{t("onboarding.welcome.features.team", "Team Collaboration")}
							</CardTitle>
						</CardHeader>
						<CardContent>
							<CardDescription>
								{t(
									"onboarding.welcome.features.teamDesc",
									"Work with your team, approve requests, and manage employees",
								)}
							</CardDescription>
						</CardContent>
					</Card>
				</div>

				{/* Organization Info - show if user already joined via invite code */}
				{hasOrganization && organizationName && (
					<Alert className="mb-6 mx-auto max-w-md border-primary/20 bg-primary/5">
						<IconBuilding className="h-4 w-4" />
						<AlertDescription>
							{t(
								"onboarding.welcome.joinedOrganization",
								"You've joined {organization}. Let's complete your profile setup.",
								{ organization: organizationName },
							)}
						</AlertDescription>
					</Alert>
				)}

				{/* CTA Button */}
				<Button size="lg" onClick={handleGetStarted} disabled={loading} className="w-full sm:w-auto">
					{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
					{hasOrganization
						? t("onboarding.welcome.continueSetup", "Continue Setup")
						: t("onboarding.welcome.getStarted", "Get Started")}
				</Button>
			</div>
		</>
	);
}
