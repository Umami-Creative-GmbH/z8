"use client";

import { IconBell, IconCheck, IconRocket } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";
import { completeOnboarding, getOnboardingSummary } from "./actions";

export default function CompletePage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(true);
	const [summary, setSummary] = useState<{
		hasOrganization: boolean;
		organizationName?: string;
		profileCompleted: boolean;
		workScheduleSet: boolean;
		isAdmin: boolean;
		vacationPolicyCreated?: boolean;
		holidayPresetCreated?: boolean;
		workTemplateCreated?: boolean;
		notificationsConfigured: boolean;
	} | null>(null);

	useEffect(() => {
		async function finishOnboarding() {
			// Mark onboarding as complete
			const completeResult = await completeOnboarding();

			if (!completeResult.success) {
				toast.error(completeResult.error || "Failed to complete onboarding");
				setLoading(false);
				return;
			}

			// Get onboarding summary
			const summaryResult = await getOnboardingSummary();

			if (summaryResult.success) {
				setSummary(summaryResult.data);
			} else {
				toast.error(summaryResult.error || "Failed to get onboarding summary");
			}

			setLoading(false);
		}

		finishOnboarding();
	}, []);

	const handleGoToDashboard = () => {
		router.push("/");
	};

	if (loading) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<div className="text-center">
					<div className="inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent motion-reduce:animate-[spin_1.5s_linear_infinite]" />
					<p className="mt-4 text-muted-foreground">
						{t("onboarding.complete.loading", "Finalizing your setup...")}
					</p>
				</div>
			</div>
		);
	}

	return (
		<>
			<ProgressIndicator currentStep="complete" />

			<div className="mx-auto max-w-2xl">
				{/* Success Message */}
				<div className="mb-8 text-center">
					<div className="mb-4 inline-flex size-20 items-center justify-center rounded-full bg-green-500/10 animate-in zoom-in duration-500">
						<IconCheck className="size-10 text-green-500" />
					</div>
					<h1 className="mb-4 text-3xl font-bold tracking-tight animate-in fade-in slide-in-from-bottom-4 duration-700">
						{t("onboarding.complete.title", "You're all set!")}
					</h1>
					<p className="text-lg text-muted-foreground animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
						{t(
							"onboarding.complete.subtitle",
							"Your account is ready to use. Welcome to the team!",
						)}
					</p>
				</div>

				{/* Summary Card */}
				<Card className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
					<CardHeader>
						<CardTitle>{t("onboarding.complete.summaryTitle", "What You've Set Up")}</CardTitle>
						<CardDescription>
							{t("onboarding.complete.summaryDesc", "Here's a summary of your configuration.")}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						{/* Organization */}
						<div className="flex items-center gap-3">
							<div
								className={cn(
									"flex size-8 items-center justify-center rounded-full",
									summary?.hasOrganization ? "bg-green-500/10" : "bg-muted",
								)}
							>
								{summary?.hasOrganization ? (
									<IconCheck className="size-4 text-green-500" />
								) : (
									<span className="text-xs text-muted-foreground">−</span>
								)}
							</div>
							<div className="flex-1">
								<p className="font-medium">
									{summary?.hasOrganization
										? t("onboarding.complete.organizationCreated", "Organization created")
										: t("onboarding.complete.organizationSkipped", "Waiting for invitation")}
								</p>
								{summary?.organizationName && (
									<p className="text-sm text-muted-foreground">{summary.organizationName}</p>
								)}
							</div>
						</div>

						{/* Profile */}
						<div className="flex items-center gap-3">
							<div
								className={cn(
									"flex size-8 items-center justify-center rounded-full",
									summary?.profileCompleted ? "bg-green-500/10" : "bg-muted",
								)}
							>
								{summary?.profileCompleted ? (
									<IconCheck className="size-4 text-green-500" />
								) : (
									<span className="text-xs text-muted-foreground">−</span>
								)}
							</div>
							<div className="flex-1">
								<p className="font-medium">
									{summary?.profileCompleted
										? t("onboarding.complete.profileCompleted", "Profile completed")
										: t("onboarding.complete.profileSkipped", "Profile skipped")}
								</p>
							</div>
						</div>

						{/* Work Schedule */}
						<div className="flex items-center gap-3">
							<div
								className={cn(
									"flex size-8 items-center justify-center rounded-full",
									summary?.workScheduleSet ? "bg-green-500/10" : "bg-muted",
								)}
							>
								{summary?.workScheduleSet ? (
									<IconCheck className="size-4 text-green-500" />
								) : (
									<span className="text-xs text-muted-foreground">−</span>
								)}
							</div>
							<div className="flex-1">
								<p className="font-medium">
									{summary?.workScheduleSet
										? t("onboarding.complete.scheduleSet", "Work schedule set")
										: t("onboarding.complete.scheduleSkipped", "You can set this later")}
								</p>
							</div>
						</div>

						{/* Admin Setup Items (only shown for admins) */}
						{summary?.isAdmin && (
							<>
								{/* Vacation Policy */}
								<div className="flex items-center gap-3">
									<div
										className={cn(
											"flex size-8 items-center justify-center rounded-full",
											summary?.vacationPolicyCreated ? "bg-green-500/10" : "bg-muted",
										)}
									>
										{summary?.vacationPolicyCreated ? (
											<IconCheck className="size-4 text-green-500" />
										) : (
											<span className="text-xs text-muted-foreground">−</span>
										)}
									</div>
									<div className="flex-1">
										<p className="font-medium">
											{summary?.vacationPolicyCreated
												? t("onboarding.complete.vacationPolicyCreated", "Vacation policy created")
												: t("onboarding.complete.vacationPolicySkipped", "Vacation policy skipped")}
										</p>
									</div>
								</div>

								{/* Holiday Preset */}
								<div className="flex items-center gap-3">
									<div
										className={cn(
											"flex size-8 items-center justify-center rounded-full",
											summary?.holidayPresetCreated ? "bg-green-500/10" : "bg-muted",
										)}
									>
										{summary?.holidayPresetCreated ? (
											<IconCheck className="size-4 text-green-500" />
										) : (
											<span className="text-xs text-muted-foreground">−</span>
										)}
									</div>
									<div className="flex-1">
										<p className="font-medium">
											{summary?.holidayPresetCreated
												? t("onboarding.complete.holidayPresetCreated", "Holidays configured")
												: t("onboarding.complete.holidayPresetSkipped", "Holidays skipped")}
										</p>
									</div>
								</div>

								{/* Work Template */}
								<div className="flex items-center gap-3">
									<div
										className={cn(
											"flex size-8 items-center justify-center rounded-full",
											summary?.workTemplateCreated ? "bg-green-500/10" : "bg-muted",
										)}
									>
										{summary?.workTemplateCreated ? (
											<IconCheck className="size-4 text-green-500" />
										) : (
											<span className="text-xs text-muted-foreground">−</span>
										)}
									</div>
									<div className="flex-1">
										<p className="font-medium">
											{summary?.workTemplateCreated
												? t(
														"onboarding.complete.workTemplateCreated",
														"Work schedule template created",
													)
												: t("onboarding.complete.workTemplateSkipped", "Work template skipped")}
										</p>
									</div>
								</div>
							</>
						)}

						{/* Notifications */}
						<div className="flex items-center gap-3">
							<div
								className={cn(
									"flex size-8 items-center justify-center rounded-full",
									summary?.notificationsConfigured ? "bg-green-500/10" : "bg-muted",
								)}
							>
								{summary?.notificationsConfigured ? (
									<IconCheck className="size-4 text-green-500" />
								) : (
									<IconBell className="size-4 text-muted-foreground" />
								)}
							</div>
							<div className="flex-1">
								<p className="font-medium">
									{summary?.notificationsConfigured
										? t("onboarding.complete.notificationsConfigured", "Notifications configured")
										: t("onboarding.complete.notificationsSkipped", "Using default notifications")}
								</p>
							</div>
						</div>
					</CardContent>
				</Card>

				{/* Next Steps */}
				<Card className="mb-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
					<CardHeader>
						<CardTitle>{t("onboarding.complete.nextStepsTitle", "Next Steps")}</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="flex items-start gap-3">
							<div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
								<IconRocket className="size-4 text-primary" />
							</div>
							<div className="flex-1">
								<p className="font-medium">
									{t("onboarding.complete.exploreDashboard", "Explore your dashboard")}
								</p>
								<p className="text-sm text-muted-foreground">
									{t(
										"onboarding.complete.exploreDashboardDesc",
										"Get started with time tracking and absence management",
									)}
								</p>
							</div>
						</div>

						{summary?.hasOrganization && (
							<div className="flex items-start gap-3">
								<div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
									<IconCheck className="size-4 text-primary" />
								</div>
								<div className="flex-1">
									<p className="font-medium">
										{t("onboarding.complete.inviteTeam", "Invite your team members")}
									</p>
									<p className="text-sm text-muted-foreground">
										{t(
											"onboarding.complete.inviteTeamDesc",
											"Add colleagues to collaborate and manage time together",
										)}
									</p>
								</div>
							</div>
						)}
					</CardContent>
				</Card>

				{/* CTA Button */}
				<div className="text-center animate-in fade-in slide-in-from-bottom-4 duration-700 delay-400">
					<Button size="lg" onClick={handleGoToDashboard} className="w-full sm:w-auto">
						{t("onboarding.complete.goToDashboard", "Go to Dashboard")}
					</Button>
				</div>
			</div>
		</>
	);
}
