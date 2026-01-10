"use client";

import { IconBriefcase, IconBuilding, IconClock, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect } from "react";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/navigation";
import { startOnboarding, updateOnboardingStep } from "./actions";

export default function WelcomePage() {
	const { t } = useTranslate();
	const router = useRouter();

	// Mark onboarding as started
	useEffect(() => {
		startOnboarding();
	}, []);

	const handleGetStarted = async () => {
		// Update onboarding step and navigate
		await updateOnboardingStep("organization");
		router.push("/onboarding/organization");
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

				{/* CTA Button */}
				<Button size="lg" onClick={handleGetStarted} className="w-full sm:w-auto">
					{t("onboarding.welcome.getStarted", "Get Started")}
				</Button>
			</div>
		</>
	);
}
