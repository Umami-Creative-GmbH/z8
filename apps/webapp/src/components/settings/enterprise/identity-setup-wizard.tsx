"use client";

import { IconArrowLeft, IconArrowRight, IconCheck, IconCircleCheck } from "@tabler/icons-react";
import { useEffect, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import type { EnterpriseIdentitySetupStep } from "@/lib/enterprise-identity/setup-state";
import { cn } from "@/lib/utils";
import {
	type IdentitySetupController,
	type IdentitySetupWizardProps,
	REQUIRED_STEP_COUNT,
	type Translate,
	useIdentitySetupController,
	WIZARD_STEPS,
} from "./identity-setup-controller";
import { getStepCopy } from "./identity-setup-copy";
import {
	AccessPolicyStep,
	DomainStep,
	ProviderStep,
	ReviewStep,
	ScimStep,
	SsoStep,
	SsoTestStep,
} from "./identity-setup-steps";

function stepStatusText({
	done,
	optional,
	active,
	t,
}: {
	done: boolean;
	optional?: boolean;
	active: boolean;
	t: Translate;
}) {
	if (done) return t("settings.enterprise.identity.wizard.status.done", "Done");
	if (optional) return t("settings.enterprise.identity.wizard.status.optional", "Optional");
	if (active) return t("settings.enterprise.identity.wizard.status.inProgress", "In progress");
	return t("settings.enterprise.identity.wizard.status.toDo", "To do");
}

/**
 * The steps as one list: a row of numbered markers on narrow screens and a
 * labelled column beside the step from `xl`. Labels wrap; nothing is truncated.
 */
function StepNavigation({ controller }: { controller: IdentitySetupController }) {
	const { activeStep, completion, goTo, t } = controller;

	return (
		<nav
			aria-label={t("settings.enterprise.identity.wizard.nav.label", "Setup steps")}
			className="min-w-0 max-w-3xl xl:sticky xl:top-4 xl:max-w-none xl:self-start"
		>
			<ol className="grid grid-cols-7 gap-1 xl:grid-cols-1 xl:gap-0.5">
				{WIZARD_STEPS.map((step, index) => {
					const copy = getStepCopy(step.id, controller);
					const active = step.id === activeStep;
					const done = completion[step.id];
					const statusText = stepStatusText({ done, optional: step.optional, active, t });

					return (
						<li key={step.id} className="min-w-0">
							<button
								type="button"
								onClick={() => goTo(step.id)}
								aria-current={active ? "step" : undefined}
								aria-label={`${copy.navLabel}, ${statusText}`}
								className={cn(
									"group flex w-full min-w-0 flex-col items-center gap-1.5 rounded-lg px-1 py-2 text-center outline-none transition-colors",
									"hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50",
									"xl:flex-row xl:items-start xl:gap-3 xl:px-3 xl:py-2.5 xl:text-left",
									active && "bg-muted xl:bg-primary/8",
								)}
							>
								<span
									aria-hidden="true"
									className={cn(
										"flex size-7 shrink-0 items-center justify-center rounded-full border font-semibold text-xs tabular-nums",
										done && "border-primary bg-primary text-primary-foreground",
										!done && active && "border-primary text-primary",
										!done && !active && "bg-background text-muted-foreground",
									)}
								>
									{done ? <IconCheck className="size-4" /> : index + 1}
								</span>
								{/* The button's aria-label carries the name and status; on phones only the markers show. */}
								<span aria-hidden="true" className="hidden min-w-0 flex-col gap-0.5 sm:flex">
									<span
										className={cn(
											"hyphens-auto break-words text-xs leading-snug xl:text-sm",
											active ? "font-semibold text-foreground" : "font-medium text-foreground/90",
										)}
									>
										{copy.navLabel}
									</span>
									<span
										className={cn(
											"hidden text-xs xl:block",
											done ? "text-primary" : "text-muted-foreground",
										)}
									>
										{statusText}
									</span>
								</span>
							</button>
						</li>
					);
				})}
			</ol>
		</nav>
	);
}

function stepBody(step: EnterpriseIdentitySetupStep, controller: IdentitySetupController) {
	switch (step) {
		case "provider":
			return <ProviderStep controller={controller} />;
		case "sso":
			return <SsoStep controller={controller} />;
		case "domain":
			return <DomainStep controller={controller} />;
		case "ssoTest":
			return <SsoTestStep controller={controller} />;
		case "scim":
			return <ScimStep controller={controller} />;
		case "accessPolicy":
			return <AccessPolicyStep controller={controller} />;
		case "review":
			return <ReviewStep controller={controller} />;
	}
}

function ActiveStep({ controller }: { controller: IdentitySetupController }) {
	const { activeIndex, activeStep, completion, focusRequest, goTo, nextStep, previousStep, t } =
		controller;
	const headingRef = useRef<HTMLHeadingElement>(null);
	const copy = getStepCopy(activeStep, controller);
	const step = WIZARD_STEPS[activeIndex];
	const done = completion[activeStep];

	// Moving between steps puts focus on the new step's heading, so keyboard and
	// screen reader users land on what changed. The first render keeps focus alone.
	useEffect(() => {
		if (focusRequest > 0) headingRef.current?.focus();
	}, [focusRequest]);

	return (
		<Card className="min-w-0 gap-5 shadow-xs">
			<CardHeader className="gap-2 px-4 sm:px-6">
				<div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
					<p className="font-medium text-muted-foreground text-xs tabular-nums">
						{t("settings.enterprise.identity.wizard.stepOf", "Step {current} of {total}", {
							current: activeIndex + 1,
							total: WIZARD_STEPS.length,
						})}
					</p>
					{done ? (
						<Badge variant="success">
							<IconCheck aria-hidden="true" />
							{t("settings.enterprise.identity.wizard.status.done", "Done")}
						</Badge>
					) : step?.optional ? (
						<Badge variant="outline">
							{t("settings.enterprise.identity.wizard.status.optional", "Optional")}
						</Badge>
					) : null}
				</div>
				<h3
					ref={headingRef}
					tabIndex={-1}
					className="text-balance font-semibold text-lg leading-snug outline-none"
				>
					{copy.title}
				</h3>
				<p className="text-pretty text-muted-foreground text-sm leading-relaxed">
					{copy.description}
				</p>
			</CardHeader>
			<CardContent className="space-y-6 px-4 sm:px-6">
				{stepBody(activeStep, controller)}
			</CardContent>
			<CardFooter className="flex-wrap justify-between gap-2 border-t px-4 pt-5 sm:px-6 [.border-t]:pt-5">
				{previousStep ? (
					<Button type="button" variant="ghost" onClick={() => goTo(previousStep)}>
						<IconArrowLeft aria-hidden="true" />
						{t("settings.enterprise.identity.wizard.action.back", "Back")}
					</Button>
				) : (
					<span />
				)}
				{nextStep ? (
					<Button type="button" variant="outline" onClick={() => goTo(nextStep)}>
						{done
							? t("settings.enterprise.identity.wizard.action.next", "Next: {step}", {
									step: getStepCopy(nextStep, controller).navLabel,
								})
							: t("settings.enterprise.identity.wizard.action.skip", "Skip to {step}", {
									step: getStepCopy(nextStep, controller).navLabel,
								})}
						<IconArrowRight aria-hidden="true" />
					</Button>
				) : null}
			</CardFooter>
		</Card>
	);
}

function IdentitySetupView({ controller }: { controller: IdentitySetupController }) {
	const { domain, requiredDone, setup, t } = controller;
	const activated = Boolean(setup.activatedAt);

	return (
		<section className="min-w-0 max-w-6xl space-y-6">
			<div className="space-y-4">
				<div className="min-w-0 max-w-2xl space-y-1">
					<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
						<h2 className="text-balance font-semibold text-base">
							{t("settings.enterprise.identity.wizard.title", "Set up enterprise sign-in")}
						</h2>
						<Badge variant={activated ? "success" : "outline"}>
							{activated ? <IconCircleCheck aria-hidden="true" /> : null}
							{activated
								? t("settings.enterprise.identity.status.activated", "Activated")
								: t("settings.enterprise.identity.wizard.status.notActive", "Not active yet")}
						</Badge>
					</div>
					<p className="text-pretty text-muted-foreground text-sm leading-relaxed">
						{t(
							"settings.enterprise.identity.wizard.description",
							"Let employees sign in to Z8 with their work account from your company's identity provider. Your progress is saved after each step, so you can stop and come back at any time.",
						)}
					</p>
				</div>
				<div className="max-w-2xl space-y-1.5">
					<Progress
						value={(requiredDone / REQUIRED_STEP_COUNT) * 100}
						aria-label={t("settings.enterprise.identity.wizard.progressLabel", "Setup progress")}
					/>
					<p className="text-muted-foreground text-xs tabular-nums">
						{t(
							"settings.enterprise.identity.wizard.progress",
							"{completed} of {total} required steps done",
							{ completed: requiredDone, total: REQUIRED_STEP_COUNT },
						)}
					</p>
				</div>
				{activated ? (
					<p
						role="status"
						className="flex max-w-2xl items-start gap-2 rounded-lg border border-success/40 bg-success/10 p-3 text-sm"
					>
						<IconCircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
						<span className="min-w-0">
							{t(
								"settings.enterprise.identity.wizard.activeNotice",
								"Enterprise sign-in is active for {domain}. You can review each step below.",
								{ domain },
							)}
						</span>
					</p>
				) : null}
			</div>

			<div className="grid min-w-0 gap-4 xl:grid-cols-[15rem_minmax(0,1fr)] xl:gap-8">
				<StepNavigation controller={controller} />
				<div className="min-w-0 max-w-3xl">
					<ActiveStep controller={controller} />
				</div>
			</div>
		</section>
	);
}

export function IdentitySetupWizard(props: IdentitySetupWizardProps) {
	return <IdentitySetupView controller={useIdentitySetupController(props)} />;
}
