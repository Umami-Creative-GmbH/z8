"use client";

import { IconCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { cn } from "@/lib/utils";
import {
	ADMIN_ONLY_STEPS,
	getVisibleSteps,
	ONBOARDING_STEPS,
	type OnboardingStep,
} from "@/lib/validations/onboarding";

// Map step keys to i18n keys with defaults
const STEP_I18N_KEYS: Record<OnboardingStep, { key: string; default: string }> = {
	welcome: { key: "onboarding.steps.welcome", default: "Welcome" },
	organization: { key: "onboarding.steps.organization", default: "Organization" },
	profile: { key: "onboarding.steps.profile", default: "Profile" },
	work_schedule: { key: "onboarding.steps.workSchedule", default: "Schedule" },
	vacation_policy: { key: "onboarding.steps.vacationPolicy", default: "Vacation" },
	work_templates: { key: "onboarding.steps.workTemplates", default: "Templates" },
	wellness: { key: "onboarding.steps.wellness", default: "Wellness" },
	notifications: { key: "onboarding.steps.notifications", default: "Notifications" },
	complete: { key: "onboarding.steps.complete", default: "Complete" },
};

interface ProgressIndicatorProps {
	currentStep: OnboardingStep;
	className?: string;
	isAdmin?: boolean;
}

export function ProgressIndicator({
	currentStep,
	className,
	isAdmin: isAdminProp,
}: ProgressIndicatorProps) {
	const { t } = useTranslate();
	const isAdmin = isAdminProp ?? ADMIN_ONLY_STEPS.includes(currentStep);

	// Get visible steps based on admin status
	const visibleSteps = getVisibleSteps(isAdmin);

	// Get step configs for visible steps
	const steps = visibleSteps.map((step, index) => ({
		key: step,
		...ONBOARDING_STEPS[step],
		displayOrder: index + 1,
	}));

	const currentStepIndex = visibleSteps.indexOf(currentStep);
	const currentDisplayOrder = currentStepIndex + 1;
	const stepLabel = (step: OnboardingStep) =>
		t(STEP_I18N_KEYS[step].key, STEP_I18N_KEYS[step].default);

	// Every step gets an equal-width column with its circle centred, so the first and last
	// circle centres sit half a column in from each edge. The line runs between them.
	const columnPercent = 100 / steps.length;
	const lineInset = `${columnPercent / 2}%`;
	const progressWidth = `${Math.max(currentDisplayOrder - 1, 0) * columnPercent}%`;

	return (
		<nav
			aria-label={t("onboarding.steps.label", "Onboarding progress")}
			className={cn("w-full py-8", className)}
		>
			<div className="mx-auto max-w-3xl">
				{/* Progress Bar */}
				<div className="relative">
					{/* Background Line */}
					<div
						aria-hidden="true"
						className="absolute top-4 h-0.5 bg-muted sm:top-5"
						style={{ left: lineInset, right: lineInset }}
					/>

					{/* Progress Line */}
					<div
						aria-hidden="true"
						data-testid="onboarding-progress-line"
						className="absolute top-4 h-0.5 bg-primary transition-[width] duration-500 sm:top-5"
						style={{ left: lineInset, width: progressWidth }}
					/>

					{/* Step Indicators */}
					<ol
						className="relative grid"
						style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
					>
						{steps.map((step) => {
							const isCompleted = step.displayOrder < currentDisplayOrder;
							const isCurrent = step.key === currentStep;

							return (
								<li
									key={step.key}
									aria-current={isCurrent ? "step" : undefined}
									className="flex min-w-0 flex-col items-center"
								>
									{/* Step Circle */}
									<div
										aria-hidden="true"
										className={cn(
											"flex size-8 items-center justify-center rounded-full border-2 bg-background transition-[border-color,background-color,color] duration-300 sm:size-10",
											{
												"border-primary bg-primary text-primary-foreground": isCompleted,
												"border-primary bg-background text-primary": isCurrent,
												"border-muted-foreground/30 text-muted-foreground":
													!isCompleted && !isCurrent,
											},
										)}
									>
										{isCompleted ? (
											<IconCheck className="size-4 sm:size-5" />
										) : (
											<span className="text-xs font-medium sm:text-sm">{step.displayOrder}</span>
										)}
									</div>

									{/* Step Label: visible from sm, read by screen readers everywhere */}
									<span
										className={cn(
											"sr-only w-full px-0.5 text-center text-xs font-medium break-words hyphens-auto transition-colors sm:not-sr-only sm:mt-2 lg:text-sm",
											{
												"text-primary": isCompleted || isCurrent,
												"text-muted-foreground": !isCompleted && !isCurrent,
											},
										)}
									>
										{stepLabel(step.key)}
									</span>
								</li>
							);
						})}
					</ol>
				</div>

				{/* Phones only have room for the current step's label */}
				{currentStepIndex >= 0 && (
					<p aria-hidden="true" className="mt-3 text-center text-sm font-medium sm:hidden">
						<span className="text-muted-foreground">
							{t("onboarding.steps.position", "Step {current} of {total}", {
								current: currentDisplayOrder,
								total: steps.length,
							})}
						</span>{" "}
						<span className="text-primary">{stepLabel(currentStep)}</span>
					</p>
				)}
			</div>
		</nav>
	);
}
