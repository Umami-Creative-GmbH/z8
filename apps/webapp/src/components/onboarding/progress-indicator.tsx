"use client";

import { IconCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
	ADMIN_ONLY_STEPS,
	getVisibleSteps,
	ONBOARDING_STEPS,
	type OnboardingStep,
} from "@/lib/validations/onboarding";

// Map step keys to i18n keys
const STEP_I18N_KEYS: Record<OnboardingStep, string> = {
	welcome: "onboarding.steps.welcome",
	organization: "onboarding.steps.organization",
	profile: "onboarding.steps.profile",
	work_schedule: "onboarding.steps.workSchedule",
	vacation_policy: "onboarding.steps.vacationPolicy",
	holiday_setup: "onboarding.steps.holidaySetup",
	work_templates: "onboarding.steps.workTemplates",
	wellness: "onboarding.steps.wellness",
	notifications: "onboarding.steps.notifications",
	complete: "onboarding.steps.complete",
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
	// If isAdmin is not provided, we need to determine it from context
	// For admin-only steps, assume admin. For other steps, we show a simplified view
	const [isAdmin, setIsAdmin] = useState<boolean | undefined>(isAdminProp);

	useEffect(() => {
		if (isAdminProp !== undefined) {
			setIsAdmin(isAdminProp);
			return;
		}

		// If we're on an admin-only step, we're definitely an admin
		if (ADMIN_ONLY_STEPS.includes(currentStep)) {
			setIsAdmin(true);
		}
	}, [currentStep, isAdminProp]);

	// Get visible steps based on admin status
	// If we don't know yet, show all steps for admins (worst case)
	const visibleSteps = getVisibleSteps(isAdmin ?? ADMIN_ONLY_STEPS.includes(currentStep));

	// Get step configs for visible steps
	const steps = visibleSteps.map((step, index) => ({
		key: step,
		...ONBOARDING_STEPS[step],
		displayOrder: index + 1,
	}));

	const currentStepIndex = visibleSteps.indexOf(currentStep);
	const currentDisplayOrder = currentStepIndex + 1;

	return (
		<div className={cn("w-full py-8", className)}>
			<div className="mx-auto max-w-3xl">
				{/* Progress Bar */}
				<div className="relative">
					{/* Background Line */}
					<div className="absolute left-0 top-5 h-0.5 w-full bg-muted" />

					{/* Progress Line */}
					<div
						className="absolute left-0 top-5 h-0.5 bg-primary transition-[width] duration-500"
						style={{ width: `${((currentDisplayOrder - 1) / (steps.length - 1)) * 100}%` }}
					/>

					{/* Step Indicators */}
					<div className="relative flex justify-between">
						{steps.map((step) => {
							const isCompleted = step.displayOrder < currentDisplayOrder;
							const isCurrent = step.key === currentStep;

							return (
								<div key={step.key} className="flex flex-col items-center">
									{/* Step Circle */}
									<div
										className={cn(
											"flex h-10 w-10 items-center justify-center rounded-full border-2 bg-background transition-[border-color,background-color,color] duration-300",
											{
												"border-primary bg-primary text-primary-foreground": isCompleted,
												"border-primary bg-background text-primary": isCurrent,
												"border-muted-foreground/30 text-muted-foreground":
													!isCompleted && !isCurrent,
											},
										)}
									>
										{isCompleted ? (
											<IconCheck className="h-5 w-5" />
										) : (
											<span className="text-sm font-medium">{step.displayOrder}</span>
										)}
									</div>

									{/* Step Label */}
									<span
										className={cn("mt-2 text-xs font-medium transition-colors sm:text-sm", {
											"text-primary": isCompleted || isCurrent,
											"text-muted-foreground": !isCompleted && !isCurrent,
										})}
									>
										{t(STEP_I18N_KEYS[step.key], step.label)}
									</span>
								</div>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
