"use client";

import {
	IconDroplet,
	IconDropletFilled,
	IconFlame,
	IconPlus,
	IconTrophy,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { logWaterIntake } from "@/app/[locale]/(app)/wellness/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getHydrationWidgetData } from "./actions";
import { DashboardWidget } from "./dashboard-widget";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

type HydrationWidgetData = {
	enabled: boolean;
	currentStreak: number;
	longestStreak: number;
	todayIntake: number;
	dailyGoal: number;
	goalProgress: number;
};

function WaterGlass({ filled }: { filled: boolean }) {
	return (
		<div
			className={cn(
				"flex size-7 items-center justify-center rounded-md transition-all",
				filled
					? "bg-gradient-to-b from-sky-400 to-blue-500 shadow-sm shadow-blue-500/25"
					: "bg-muted/50 border border-dashed border-muted-foreground/20",
			)}
		>
			{filled ? (
				<IconDropletFilled className="size-3.5 text-white" aria-hidden="true" />
			) : (
				<IconDroplet className="size-3.5 text-muted-foreground/30" aria-hidden="true" />
			)}
		</div>
	);
}

function CircularProgress({
	progress,
	streak,
	isRecord,
	children,
}: {
	progress: number;
	streak?: number;
	isRecord?: boolean;
	children: React.ReactNode;
}) {
	const radius = 38;
	const circumference = 2 * Math.PI * radius;
	const strokeDashoffset = circumference - (Math.min(progress, 100) / 100) * circumference;
	const isComplete = progress >= 100;

	return (
		<div className="relative inline-flex items-center justify-center">
			<svg className="size-24 -rotate-90" viewBox="0 0 100 100">
				<circle cx="50" cy="50" r={radius} fill="none" strokeWidth="7" className="stroke-muted" />
				<circle
					cx="50"
					cy="50"
					r={radius}
					fill="none"
					strokeWidth="7"
					strokeLinecap="round"
					className={cn(
						"transition-all duration-500 ease-out",
						isComplete ? "stroke-emerald-500" : "stroke-blue-500",
					)}
					style={{
						strokeDasharray: circumference,
						strokeDashoffset,
					}}
				/>
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center">{children}</div>

			{/* Streak badge - always visible when there's a streak */}
			{streak && streak > 0 ? (
				<div
					className={cn(
						"absolute -bottom-1 -right-1 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold shadow-sm",
						isComplete
							? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white"
							: "bg-gradient-to-r from-orange-500 to-amber-500 text-white",
					)}
				>
					<IconFlame className="size-3" />
					<span>{streak}</span>
					{isRecord && <span className="ml-0.5">🏆</span>}
				</div>
			) : isComplete ? (
				<div className="absolute -bottom-1 -right-1 flex items-center rounded-full bg-emerald-500 p-1 text-white shadow-sm">
					<IconTrophy className="size-3" />
				</div>
			) : null}
		</div>
	);
}

function AddButton({
	count,
	onClick,
	disabled,
}: {
	count: 1 | 2;
	onClick: () => void;
	disabled: boolean;
}) {
	return (
		<Button
			variant="outline"
			size="icon"
			className="size-9 relative"
			onClick={onClick}
			disabled={disabled}
			aria-label={`Add ${count} glass${count > 1 ? "es" : ""}`}
		>
			<IconPlus className="size-3 text-muted-foreground absolute top-1 left-1" />
			<IconDropletFilled className="size-4 text-blue-500" />
			<span className="absolute -bottom-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
				{count}
			</span>
		</Button>
	);
}

export function HydrationWidget() {
	const { t } = useTranslate();
	const [isLogging, setIsLogging] = useState(false);
	const widgetRef = useRef<HTMLDivElement>(null);
	const {
		data: stats,
		loading,
		refreshing,
		refetch,
	} = useWidgetData<HydrationWidgetData>(getHydrationWidgetData, {
		errorMessage: t("dashboard.hydration.error", "Failed to load hydration stats"),
	});

	const fireConfetti = useCallback(async () => {
		if (!widgetRef.current) return;

		const { default: confetti } = await import("canvas-confetti");

		const rect = widgetRef.current.getBoundingClientRect();
		const x = (rect.left + rect.width / 2) / window.innerWidth;
		const y = (rect.top + rect.height / 2) / window.innerHeight;

		confetti({
			particleCount: 80,
			spread: 60,
			origin: { x, y },
			colors: ["#3b82f6", "#0ea5e9", "#06b6d4", "#22c55e", "#eab308"],
			ticks: 150,
			gravity: 1.2,
			scalar: 0.9,
			drift: 0,
		});
	}, []);

	const handleLogWater = useCallback(
		async (amount: number) => {
			setIsLogging(true);
			try {
				const result = await logWaterIntake({ amount, source: "widget" });
				if (result.success) {
					if (result.data?.goalJustMet) {
						fireConfetti();
					}
					refetch();
				} else {
					toast.error(result.error ?? t("dashboard.hydration.log-error", "Failed to log water intake"));
				}
			} catch {
				toast.error(t("dashboard.hydration.log-error", "Failed to log water intake"));
			} finally {
				setIsLogging(false);
			}
		},
		[refetch, fireConfetti, t],
	);

	if (!stats?.enabled && !loading) return null;
	if (!stats && !loading) return null;

	const progressPercentage = stats?.goalProgress ?? 0;
	const isGoalMet = progressPercentage >= 100;
	const glassesArray = Array.from({ length: stats?.dailyGoal ?? 8 }, (_, i) => i);

	return (
		<DashboardWidget id="hydration">
			<WidgetCard
				title={t("dashboard.hydration.title", "Hydration")}
				description={t("dashboard.hydration.description", "Track your daily water intake")}
				icon={<IconDropletFilled className="size-4 text-blue-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				{stats && (
					<div ref={widgetRef} className="flex items-center gap-4">
						{/* Left: Circular Progress with badge */}
						<CircularProgress
							progress={progressPercentage}
							streak={stats.currentStreak}
							isRecord={stats.currentStreak === stats.longestStreak && stats.currentStreak > 1}
						>
							<span
								className={cn(
									"text-xl font-bold tabular-nums",
									isGoalMet ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
								)}
							>
								{stats.todayIntake}
							</span>
							<span className="text-[10px] text-muted-foreground">{t("dashboard.hydration.of-goal", "of {goal}", { goal: stats.dailyGoal })}</span>
						</CircularProgress>

						{/* Right: Glass Grid + Add Buttons */}
						<div className="flex flex-1 flex-col gap-3">
							{/* Glass Grid */}
							<div className="flex flex-wrap gap-1.5">
								{glassesArray.map((index) => (
									<WaterGlass key={index} filled={index < stats.todayIntake} />
								))}
							</div>

							{/* Add Buttons */}
							<div className="flex gap-2">
								<AddButton count={1} onClick={() => handleLogWater(1)} disabled={isLogging} />
								<AddButton count={2} onClick={() => handleLogWater(2)} disabled={isLogging} />
							</div>
						</div>
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
