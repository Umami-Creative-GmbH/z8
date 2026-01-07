"use client";

import { IconCheck } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { ONBOARDING_STEPS, type OnboardingStep } from "@/lib/validations/onboarding";

interface ProgressIndicatorProps {
	currentStep: OnboardingStep;
	className?: string;
}

export function ProgressIndicator({ currentStep, className }: ProgressIndicatorProps) {
	const steps = Object.entries(ONBOARDING_STEPS).sort(([, a], [, b]) => a.order - b.order);
	const currentStepOrder = ONBOARDING_STEPS[currentStep].order;

	return (
		<div className={cn("w-full py-8", className)}>
			<div className="mx-auto max-w-3xl">
				{/* Progress Bar */}
				<div className="relative">
					{/* Background Line */}
					<div className="absolute left-0 top-5 h-0.5 w-full bg-muted" />

					{/* Progress Line */}
					<div
						className="absolute left-0 top-5 h-0.5 bg-primary transition-all duration-500"
						style={{ width: `${((currentStepOrder - 1) / (steps.length - 1)) * 100}%` }}
					/>

					{/* Step Indicators */}
					<div className="relative flex justify-between">
						{steps.map(([key, step]) => {
							const isCompleted = step.order < currentStepOrder;
							const isCurrent = step.order === currentStepOrder;
							const stepKey = key as OnboardingStep;

							return (
								<div key={stepKey} className="flex flex-col items-center">
									{/* Step Circle */}
									<div
										className={cn(
											"flex h-10 w-10 items-center justify-center rounded-full border-2 bg-background transition-all duration-300",
											{
												"border-primary bg-primary text-primary-foreground": isCompleted,
												"border-primary bg-background text-primary": isCurrent,
												"border-muted-foreground/30 text-muted-foreground": !isCompleted && !isCurrent,
											}
										)}
									>
										{isCompleted ? (
											<IconCheck className="h-5 w-5" />
										) : (
											<span className="text-sm font-medium">{step.order}</span>
										)}
									</div>

									{/* Step Label */}
									<span
										className={cn(
											"mt-2 text-xs font-medium transition-colors sm:text-sm",
											{
												"text-primary": isCompleted || isCurrent,
												"text-muted-foreground": !isCompleted && !isCurrent,
											}
										)}
									>
										{step.label}
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
