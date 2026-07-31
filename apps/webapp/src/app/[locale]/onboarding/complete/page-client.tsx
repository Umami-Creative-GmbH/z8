"use client";

import { IconCheck, IconRocket } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/navigation";
import { completeOnboarding, getOnboardingSummary } from "./actions";

export default function CompletePage() {
	const { t } = useTranslate();
	const { push } = useRouter();
	const [loading, setLoading] = useState(true);
	const [summary, setSummary] = useState<{
		hasOrganization: boolean;
	} | null>(null);
	const completionPromiseRef = useRef<ReturnType<
		typeof completeOnboarding
	> | null>(null);

	useEffect(() => {
		let cancelled = false;
		const completionPromise =
			completionPromiseRef.current ?? completeOnboarding();
		completionPromiseRef.current = completionPromise;

		async function finishOnboarding() {
			let completeResult: Awaited<ReturnType<typeof completeOnboarding>>;
			try {
				completeResult = await completionPromise;
			} catch {
				if (cancelled) return;
				toast.error(
					t(
						"onboarding.complete.completeError",
						"Failed to complete onboarding",
					),
				);
				setLoading(false);
				return;
			}
			if (cancelled) return;

			if (!completeResult.success) {
				toast.error(
					completeResult.error ||
						t(
							"onboarding.complete.completeError",
							"Failed to complete onboarding",
						),
				);
				setLoading(false);
				return;
			}

			let summaryResult: Awaited<ReturnType<typeof getOnboardingSummary>>;
			try {
				summaryResult = await getOnboardingSummary();
			} catch {
				if (cancelled) return;
				toast.error(
					t(
						"onboarding.complete.summaryError",
						"Failed to get onboarding summary",
					),
				);
				setLoading(false);
				return;
			}
			if (cancelled) return;

			if (summaryResult.success) {
				setSummary(summaryResult.data);
			} else {
				toast.error(
					summaryResult.error ||
						t(
							"onboarding.complete.summaryError",
							"Failed to get onboarding summary",
						),
				);
			}

			setLoading(false);
		}

		void finishOnboarding();
		return () => {
			cancelled = true;
		};
	}, [t]);

	const handleGoToDashboard = () => {
		push("/init");
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
					<div className="mb-4 inline-flex size-20 items-center justify-center rounded-full bg-green-500/10 transition-transform animate-in zoom-in duration-500">
						<IconCheck className="size-10 text-green-500" />
					</div>
					<h1 className="mb-4 text-3xl font-bold tracking-tight transition-[opacity,transform] animate-in fade-in slide-in-from-bottom-4 duration-700">
						{t("onboarding.complete.title", "You're all set!")}
					</h1>
					<p className="text-lg text-muted-foreground transition-[opacity,transform] animate-in fade-in slide-in-from-bottom-4 duration-700 delay-100">
						{t(
							"onboarding.complete.subtitle",
							"Your account is ready to use. Welcome to the team!",
						)}
					</p>
				</div>

				{/* Next Steps */}
				<Card className="mb-8 transition-[opacity,transform] animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
					<CardHeader>
						<CardTitle>
							{t("onboarding.complete.nextStepsTitle", "Next Steps")}
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="flex items-start gap-3">
							<div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
								<IconRocket className="size-4 text-primary" />
							</div>
							<div className="flex-1">
								<p className="font-medium">
									{t(
										"onboarding.complete.exploreDashboard",
										"Explore your dashboard",
									)}
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
										{t(
											"onboarding.complete.inviteTeam",
											"Invite your team members",
										)}
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
				<div className="text-center transition-[opacity,transform] animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
					<Button
						size="lg"
						onClick={handleGoToDashboard}
						className="w-full sm:w-auto"
					>
						{t("onboarding.complete.goToDashboard", "Go to Dashboard")}
					</Button>
				</div>
			</div>
		</>
	);
}
