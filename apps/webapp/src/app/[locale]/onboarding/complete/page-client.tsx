"use client";

import { IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLayoutEffect, useRef, useState } from "react";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/auth-client";
import type { OnboardingSummary } from "@/lib/effect/services/onboarding.service";
import { Link } from "@/navigation";
import { completeOnboarding, getOnboardingSummary } from "./actions";

type CompletionCache = Map<string, ReturnType<typeof completeOnboarding>>;
type Outcome =
	| { status: "finalizing" }
	| { status: "completion-error" }
	| { status: "summary-loading" }
	| { status: "summary-error" }
	| { status: "ready"; summary: OnboardingSummary };

export default function CompletePage() {
	const { t } = useTranslate();
	const session = useSession();
	// Personal finalization survives organization changes and cached Activity effects.
	// This cache never grants access: both actions still resolve their real session.
	const [completions] = useState<CompletionCache>(() => new Map());
	const actor = session.data?.user.id;
	if (session.isPending || !actor) {
		return (
			<section className="mx-auto max-w-2xl rounded-xl border bg-card p-6 text-card-foreground sm:p-8">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("onboarding.complete.task", "Finish personal setup")}
				</h1>
				{session.isPending ? (
					<p role="status" className="mt-4">
						{t("common.loading", "Loading…")}
					</p>
				) : (
					<Link
						href="/sign-in"
						className="mt-4 inline-block rounded-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
					>
						{t("auth.signIn", "Sign in")}
					</Link>
				)}
			</section>
		);
	}
	return (
		<CompletionFlow
			key={`${actor}:${session.data?.session.activeOrganizationId ?? "none"}`}
			actor={actor}
			completions={completions}
		/>
	);
}

function useCompletionAttempt(actor: string, completions: CompletionCache, onRetry: () => void) {
	const [outcome, setOutcome] = useState<Outcome>({ status: "finalizing" });
	const busy = useRef(true);
	useLayoutEffect(() => {
		let current = true;
		busy.current = true;
		async function loadSummary() {
			setOutcome({ status: "summary-loading" });
			try {
				const result = await getOnboardingSummary();
				if (current) {
					setOutcome(
						result.success
							? { status: "ready", summary: result.data }
							: { status: "summary-error" },
					);
				}
			} catch {
				if (current) setOutcome({ status: "summary-error" });
			}
		}

		async function finish() {
			try {
				let completion = completions.get(actor);
				if (!completion) {
					completion = completeOnboarding();
					completions.set(actor, completion);
				}
				const result = await completion;
				if (current) {
					if (result.success) await loadSummary();
					else setOutcome({ status: "completion-error" });
				}
			} catch {
				if (current) setOutcome({ status: "completion-error" });
			}
		}
		void finish().finally(() => {
			if (current) busy.current = false;
		});
		return () => {
			current = false;
			setOutcome({ status: "finalizing" });
			busy.current = true;
		};
	}, [actor, completions]);
	const retry = () => {
		if (busy.current) return;
		busy.current = true;
		if (outcome.status === "completion-error") completions.delete(actor);
		onRetry();
	};
	return { outcome, retry };
}

function CompletionAttempt({
	actor,
	completions,
	onRetry,
}: {
	actor: string;
	completions: CompletionCache;
	onRetry: () => void;
}) {
	const { t } = useTranslate();
	const { outcome, retry } = useCompletionAttempt(actor, completions, onRetry);
	const completed = outcome.status !== "finalizing" && outcome.status !== "completion-error";
	const summary = outcome.status === "ready" ? outcome.summary : null;
	return (
		<section className="mx-auto max-w-2xl space-y-6 rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8">
			<ProgressIndicator currentStep="complete" className="py-2" />
			<header aria-live="polite" className="space-y-3 border-b pb-6">
				<p className="flex items-center gap-2 text-sm font-medium text-primary">
					{completed ? <IconCheck aria-hidden="true" className="size-5 shrink-0" /> : null}
					{t("onboarding.complete.scope", "Personal onboarding")}
				</p>
				<h1 className="text-2xl font-semibold tracking-tight text-balance">
					{completed
						? t("onboarding.complete.confirmedTitle", "Personal setup complete")
						: t("onboarding.complete.task", "Finish personal setup")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"onboarding.complete.accessContext",
						"Initialization checks your organization access and any required security verification before opening your workspace.",
					)}
				</p>
			</header>
			{outcome.status === "finalizing" ? (
				<p role="status" className="flex items-center gap-2">
					<IconLoader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
					{t("onboarding.complete.loading", "Finalizing your setup…")}
				</p>
			) : null}
			{outcome.status === "completion-error" ? (
				<div className="space-y-4">
					<p role="alert" className="text-destructive">
						{t("onboarding.complete.completeError", "Failed to complete onboarding")}
					</p>
					<Button onClick={retry}>
						{t("onboarding.complete.retryCompletion", "Retry completion")}
					</Button>
				</div>
			) : null}
			{completed ? (
				<>
					<SetupSummary outcome={outcome} retry={retry} />
					<section aria-labelledby="completion-next" className="space-y-3 border-t pt-5">
						<h2 id="completion-next" className="font-semibold">
							{t("onboarding.complete.nextStepsTitle", "Next Steps")}
						</h2>
						<p className="text-sm text-muted-foreground">
							{t(
								"onboarding.complete.exploreDashboardDesc",
								"Get started with time tracking and absence management",
							)}
						</p>
						{summary?.hasOrganization ? (
							<div className="text-sm">
								<p className="font-medium">
									{t("onboarding.complete.inviteTeam", "Invite your team members")}
								</p>
								<p className="mt-1 text-muted-foreground">
									{t(
										"onboarding.complete.inviteTeamDesc",
										"Add colleagues to collaborate and manage time together",
									)}
								</p>
							</div>
						) : null}
						{summary?.isAdmin && summary.holidayPresetCreated === false ? (
							<div className="text-sm">
								<Link
									href="/settings/vacation?tab=holidays"
									className="rounded-sm font-medium underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
								>
									{t("onboarding.complete.setUpHolidays", "Set up public holidays")}
								</Link>
								<p className="mt-1 text-muted-foreground">
									{t(
										"onboarding.complete.setUpHolidaysDesc",
										"Choose your country and region in the holiday settings",
									)}
								</p>
							</div>
						) : null}
					</section>
					{outcome.status !== "summary-loading" ? (
						<div className="border-t pt-5">
							<Link
								href="/init"
								className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto"
							>
								{t("onboarding.complete.continue", "Continue to workspace")}
							</Link>
						</div>
					) : null}
				</>
			) : null}
		</section>
	);
}

function CompletionFlow({ actor, completions }: { actor: string; completions: CompletionCache }) {
	const [attempt, setAttempt] = useState(0);
	return (
		<CompletionAttempt
			key={attempt}
			actor={actor}
			completions={completions}
			onRetry={() => setAttempt((value) => value + 1)}
		/>
	);
}

function SetupSummary({ outcome, retry }: { outcome: Outcome; retry: () => void }) {
	const { t } = useTranslate();
	const summary = outcome.status === "ready" ? outcome.summary : null;
	return (
		<section aria-labelledby="completion-summary" className="space-y-4">
			<h2 id="completion-summary" className="font-semibold">
				{t("onboarding.complete.contextTitle", "Your setup")}
			</h2>
			{outcome.status === "summary-loading" ? (
				<p role="status">
					{t("onboarding.complete.summaryLoading", "Loading your setup summary…")}
				</p>
			) : null}
			{outcome.status === "summary-error" ? (
				<div className="space-y-3">
					<p role="alert" className="text-destructive">
						{t(
							"onboarding.complete.summaryUnavailable",
							"Your personal setup is complete, but the setup summary is unavailable. Retry the summary or continue through initialization.",
						)}
					</p>
					<Button variant="outline" onClick={retry}>
						{t("onboarding.complete.retrySummary", "Retry summary")}
					</Button>
				</div>
			) : null}
			{summary ? (
				<dl className="divide-y text-sm">
					<div className="space-y-1 py-3 first:pt-0">
						<dt className="text-muted-foreground">
							{t("onboarding.complete.organizationContext", "Organization context")}
						</dt>
						<dd className="font-medium break-words">
							{summary.organizationName ||
								t("onboarding.complete.noOrganizationName", "No organization selected")}
						</dd>
					</div>
					<div className="space-y-1 py-3">
						<dt className="text-muted-foreground">
							{t("onboarding.complete.profile", "Personal profile")}
						</dt>
						<dd>
							{summary.profileCompleted
								? t("onboarding.complete.profileComplete", "Profile completed")
								: t(
										"onboarding.complete.profileIncomplete",
										"Profile details can be reviewed in your account settings",
									)}
						</dd>
					</div>
					<div className="space-y-1 py-3">
						<dt className="text-muted-foreground">
							{t("onboarding.steps.notifications", "Notifications")}
						</dt>
						<dd>
							{summary.notificationsConfigured
								? t("onboarding.complete.notificationsConfigured", "Preferences saved")
								: t(
										"onboarding.complete.notificationsDefault",
										"Using default notification preferences",
									)}
						</dd>
					</div>
				</dl>
			) : null}
		</section>
	);
}
