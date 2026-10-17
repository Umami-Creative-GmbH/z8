"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { z } from "zod";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useRouter } from "@/navigation";
import { runOnboardingAction } from "../run-onboarding-action";
import {
	checkIsAdmin,
	setWorkScheduleOnboarding,
	skipWorkScheduleSetup,
} from "./actions";
import {
	HoursPerWeekField,
	type WorkClassification,
	WorkClassificationField,
	WorkScheduleHeading,
} from "./work-schedule-fields";

const defaultValues = {
	hoursPerWeek: 40,
	workClassification: "weekly" as WorkClassification,
};

/**
 * Resolves whether the current user may set the organization work schedule.
 * Non-admins skip the step; failures fall back to the wellness step.
 */
function useWorkScheduleAccess(replace: (href: string) => void) {
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function loadAccess() {
			try {
				const accessResult = await checkIsAdmin();
				if (cancelled) {
					return;
				}

				if (!accessResult.success) {
					replace("/onboarding/wellness");
					return;
				}

				if (!accessResult.data) {
					const skipResult = await skipWorkScheduleSetup();
					if (cancelled) {
						return;
					}

					if (skipResult.success) {
						replace(skipResult.data.nextStep);
						return;
					}

					replace("/onboarding/wellness");
					return;
				}

				setIsAdmin(true);
			} catch {
				if (!cancelled) {
					replace("/onboarding/wellness");
				}
			}
		}

		void loadAccess();

		return () => {
			cancelled = true;
		};
	}, [replace]);

	return isAdmin;
}

function WorkScheduleLoading() {
	const { t } = useTranslate();

	return (
		<div className="flex min-h-[50vh] items-center justify-center">
			<div className="text-center">
				<div className="inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
				<p className="mt-4 text-muted-foreground">
					{t("common.loading", "Loading...")}
				</p>
			</div>
		</div>
	);
}

export default function WorkSchedulePage() {
	const { t } = useTranslate();
	const { push, replace } = useRouter();
	const [loading, setLoading] = useState(false);
	const isAdmin = useWorkScheduleAccess(replace);
	const [effectiveFrom] = useState(
		() => new Date(Temporal.Now.instant().toString()),
	);

	const form = useForm({
		defaultValues: { ...defaultValues, effectiveFrom },
		onSubmit: async ({ value }) => {
			await runOnboardingAction({
				action: () => setWorkScheduleOnboarding(value),
				onResult: (result) => {
					if (!result.success) {
						toast.error(
							result.error ||
								t(
									"onboarding.workSchedule.error",
									"Failed to set work schedule",
								),
						);
						return;
					}
					toast.success(
						t(
							"onboarding.workSchedule.success",
							"Work schedule set successfully!",
						),
					);
					push(result.data.nextStep);
					return true;
				},
				onRejected: () => {
					toast.error(
						t("onboarding.workSchedule.error", "Failed to set work schedule"),
					);
				},
				setLoading,
			});
		},
	});

	async function handleSkip() {
		await runOnboardingAction({
			action: skipWorkScheduleSetup,
			onResult: (result) => {
				if (!result.success) {
					toast.error(
						result.error ||
							t(
								"onboarding.workSchedule.skipError",
								"Failed to skip work schedule setup",
							),
					);
					return;
				}
				push(result.data.nextStep);
				return true;
			},
			onRejected: () => {
				toast.error(
					t(
						"onboarding.workSchedule.skipError",
						"Failed to skip work schedule setup",
					),
				);
			},
			setLoading,
		});
	}

	if (isAdmin === null) {
		return <WorkScheduleLoading />;
	}

	return (
		<>
			<ProgressIndicator currentStep="work_schedule" isAdmin={isAdmin} />

			<div className="mx-auto max-w-2xl">
				<WorkScheduleHeading />

				<Card>
					<CardHeader>
						<CardTitle>
							{t("onboarding.workSchedule.scheduleTitle", "Work Schedule")}
						</CardTitle>
						<CardDescription>
							{t(
								"onboarding.workSchedule.scheduleDesc",
								"Set your default working hours. You can adjust this later in settings.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							action={() => {
								void form.handleSubmit();
							}}
							className="space-y-6"
						>
							{/* Hours Per Week */}
							<form.Field
								name="hoursPerWeek"
								validators={{
									onChange: z
										.number()
										.min(
											0,
											t(
												"onboarding.workSchedule.validation.hoursNegative",
												"Hours cannot be negative",
											),
										)
										.max(
											168,
											t(
												"onboarding.workSchedule.validation.hoursTooMany",
												"A week has at most 168 hours",
											),
										),
								}}
							>
								{(field) => (
									<HoursPerWeekField
										value={field.state.value}
										errors={field.state.meta.errors}
										disabled={loading}
										onChange={field.handleChange}
										onBlur={field.handleBlur}
									/>
								)}
							</form.Field>

							{/* Work Classification */}
							<form.Field name="workClassification">
								{(field) => (
									<WorkClassificationField
										value={field.state.value}
										disabled={loading}
										onChange={field.handleChange}
									/>
								)}
							</form.Field>

							{/* Action Buttons */}
							<div className="flex gap-3 pt-4">
								<Button
									type="button"
									variant="outline"
									onClick={handleSkip}
									disabled={loading}
									className="flex-1"
								>
									{t("onboarding.workSchedule.skip", "Skip for now")}
								</Button>
								<Button type="submit" disabled={loading} className="flex-1">
									{loading && (
										<IconLoader2 className="mr-2 size-4 animate-spin" />
									)}
									{t("onboarding.workSchedule.continue", "Continue")}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
