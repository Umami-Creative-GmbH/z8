"use client";

import {
	IconBriefcase,
	IconBuilding,
	IconClock,
	IconLoader2,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import type { OnboardingSummary } from "@/lib/effect/services/onboarding.service";
import { useRouter } from "@/navigation";
import { getOnboardingSummary, startOnboarding, updateOnboardingStep } from "./actions";

function WelcomeFrame({ children, isAdmin = false }: { children: ReactNode; isAdmin?: boolean }) {
	const { t } = useTranslate();
	return (
		<section className="mx-auto max-w-3xl rounded-xl border bg-card text-card-foreground shadow-sm">
			<div className="px-4 sm:px-8">
				<ProgressIndicator currentStep="welcome" isAdmin={isAdmin} />
			</div>
			<header className="px-6 pb-6 sm:px-8">
				<h1 className="text-balance text-3xl font-semibold tracking-tight">
					{t("onboarding.welcome.title", "Welcome to Z8!")}
				</h1>
				<p className="mt-3 text-pretty text-muted-foreground">
					{t(
						"onboarding.welcome.subtitle",
						"Let's get you started with a quick setup. This will only take a few minutes.",
					)}
				</p>
			</header>
			<ul className="divide-y border-y px-6 sm:px-8">
				<li className="flex gap-4 py-5">
					<IconClock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
					<div className="min-w-0">
						<h2 className="font-medium">
							{t("onboarding.welcome.features.timeTracking", "Time Tracking")}
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{t(
								"onboarding.welcome.features.timeTrackingDesc",
								"Clock in and out, track work hours, and manage time corrections",
							)}
						</p>
					</div>
				</li>
				<li className="flex gap-4 py-5">
					<IconBriefcase aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
					<div className="min-w-0">
						<h2 className="font-medium">
							{t("onboarding.welcome.features.absences", "Absence Management")}
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{t(
								"onboarding.welcome.features.absencesDesc",
								"Request time off, manage vacation days, and track holidays",
							)}
						</p>
					</div>
				</li>
				<li className="flex gap-4 py-5">
					<IconUsers aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
					<div className="min-w-0">
						<h2 className="font-medium">
							{t("onboarding.welcome.features.team", "Team Collaboration")}
						</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{t(
								"onboarding.welcome.features.teamDesc",
								"Work with your team, approve requests, and manage employees",
							)}
						</p>
					</div>
				</li>
			</ul>
			<div className="space-y-4 p-6 sm:p-8">{children}</div>
		</section>
	);
}

type Preparation =
	| { status: "preparing" }
	| { status: "failed"; error: string }
	| { status: "ready"; summary: OnboardingSummary };

type Continuation =
	| { status: "idle" | "pending" | "continuing" }
	| { status: "failed"; error: string };

type WelcomeLifetime = {
	active: boolean;
	pending: boolean;
	summary: OnboardingSummary | null;
	attempt: number;
};

function WelcomeArrival() {
	const { t } = useTranslate();
	const router = useRouter();
	const [preparation, setPreparation] = useState<Preparation>({
		status: "preparing",
	});
	const [attempt, setAttempt] = useState(0);
	const [continuation, setContinuation] = useState<Continuation>({
		status: "idle",
	});
	const pending = continuation.status === "pending" || continuation.status === "continuing";
	const initialized = useRef(false);
	const arrival = useRef<WelcomeLifetime | null>(null);
	const failureMessage = t(
		"onboarding.welcome.prepareError",
		"Setup could not be prepared. Please try again.",
	);
	const stepFailureMessage = t(
		"onboarding.welcome.continueError",
		"Your next step could not be saved. Please try again.",
	);
	const messages = useRef({ failureMessage, stepFailureMessage });
	useEffect(() => {
		messages.current = { failureMessage, stepFailureMessage };
	}, [failureMessage, stepFailureMessage]);

	useEffect(() => {
		const current: WelcomeLifetime = { active: true, pending: false, summary: null, attempt };
		arrival.current = current;
		const prepare = async () => {
			// StrictMode cleanup invalidates replay before it issues a write.
			await Promise.resolve();
			if (!current.active) return;
			setPreparation({ status: "preparing" });
			setContinuation({ status: "idle" });
			try {
				if (!initialized.current) {
					const started = await startOnboarding();
					if (!current.active) return;
					if (!started.success) {
						setPreparation({ status: "failed", error: started.error });
						return;
					}
					initialized.current = true;
				}
				const summary = await getOnboardingSummary();
				if (!current.active) return;
				if (!summary.success) {
					setPreparation({ status: "failed", error: summary.error });
					return;
				}
				current.summary = summary.data;
				setPreparation({ status: "ready", summary: summary.data });
			} catch {
				if (current.active)
					setPreparation({
						status: "failed",
						error: messages.current.failureMessage,
					});
			}
		};
		void prepare();
		return () => {
			current.active = false;
		};
	}, [attempt]);

	const handleContinue = async () => {
		const current = arrival.current;
		if (
			!current?.active ||
			!current.summary ||
			current.pending ||
			current.attempt !== attempt ||
			preparation.status !== "ready"
		)
			return;
		current.pending = true;
		setContinuation({ status: "pending" });
		const step = current.summary.hasOrganization ? "profile" : "organization";
		try {
			const result = await updateOnboardingStep(step);
			if (!current.active) return;
			if (result.success) {
				setContinuation({ status: "continuing" });
				router.push(step === "profile" ? "/onboarding/profile" : "/onboarding/organization");
				return;
			}
			current.pending = false;
			setContinuation({ status: "failed", error: result.error });
		} catch {
			if (!current.active) return;
			current.pending = false;
			setContinuation({
				status: "failed",
				error: messages.current.stepFailureMessage,
			});
		}
	};

	return (
		<WelcomeFrame isAdmin={preparation.status === "ready" && preparation.summary.isAdmin}>
			{preparation.status === "preparing" && (
				<p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
					<IconLoader2
						aria-hidden="true"
						className="size-4 animate-spin motion-reduce:animate-none"
					/>
					{t("onboarding.welcome.preparing", "Preparing your setup…")}
				</p>
			)}
			{preparation.status === "failed" && (
				<>
					<Alert variant="destructive">
						<AlertDescription>{preparation.error}</AlertDescription>
					</Alert>
					<Button onClick={() => setAttempt((value) => value + 1)}>
						{t("onboarding.welcome.retry", "Retry setup")}
					</Button>
				</>
			)}
			{preparation.status === "ready" && (
				<>
					{preparation.summary.hasOrganization && (
						<div className="flex gap-3 text-sm">
							<IconBuilding aria-hidden="true" className="size-5 shrink-0 text-primary" />
							<p className="min-w-0 break-words">
								{preparation.summary.organizationName
									? t(
											"onboarding.welcome.joinedOrganization",
											"You've joined {organization}. Let's complete your profile setup.",
											{ organization: preparation.summary.organizationName },
										)
									: t(
											"onboarding.welcome.existingOrganization",
											"Your organization is ready. Let's complete your profile setup.",
										)}
							</p>
						</div>
					)}
					{continuation.status === "failed" && (
						<Alert variant="destructive">
							<AlertDescription>{continuation.error}</AlertDescription>
						</Alert>
					)}
					<Button
						size="lg"
						onClick={handleContinue}
						disabled={pending}
						aria-busy={pending}
						className="w-full sm:w-auto"
					>
						{pending && (
							<IconLoader2
								aria-hidden="true"
								className="size-4 animate-spin motion-reduce:animate-none"
							/>
						)}
						{preparation.summary.hasOrganization
							? t("onboarding.welcome.continueSetup", "Continue Setup")
							: t("onboarding.welcome.getStarted", "Get Started")}
					</Button>
				</>
			)}
		</WelcomeFrame>
	);
}

export function WelcomePageClient() {
	const { data: session, isPending, refetch } = useSession();
	const { t } = useTranslate();
	if (isPending || !session?.user.id)
		return (
			<WelcomeFrame>
				{isPending ? (
					<p role="status">{t("onboarding.welcome.sessionPending", "Waiting for your session…")}</p>
				) : (
					<>
						<Alert variant="destructive">
							<AlertDescription>
								{t(
									"onboarding.welcome.sessionUnavailable",
									"Your session is unavailable. Please sign in again or retry.",
								)}
							</AlertDescription>
						</Alert>
						<Button onClick={() => void refetch()}>
							{t("onboarding.welcome.retrySession", "Retry session")}
						</Button>
					</>
				)}
			</WelcomeFrame>
		);
	// The key resets only this page's arrival on account/org changes, including A→B→A.
	return (
		<WelcomeArrival
			key={JSON.stringify([session.user.id, session.session.activeOrganizationId ?? null])}
		/>
	);
}
