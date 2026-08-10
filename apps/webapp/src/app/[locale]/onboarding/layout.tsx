import { connection } from "next/server";
import { Suspense } from "react";
import { AuthBackgroundImage } from "@/components/auth-background-image";
import { selectRandomAuthBackgroundImage } from "@/components/auth-background-images";
import { FontSizeToggle } from "@/components/font-size-toggle";
import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";

export default function OnboardingLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<Suspense fallback={<OnboardingLayoutLoading />}>
			<OnboardingLayoutContent>{children}</OnboardingLayoutContent>
		</Suspense>
	);
}

function OnboardingLayoutLoading() {
	return (
		<div
			className="relative min-h-svh overflow-x-hidden bg-background"
			role="status"
			aria-label="Loading onboarding"
		>
			<div className="flex min-h-svh flex-col px-4 pt-4 sm:px-8 sm:pt-6 lg:px-10">
				<div className="flex justify-end gap-2">
					<Skeleton aria-hidden="true" className="size-9 rounded-md" />
					<Skeleton aria-hidden="true" className="size-9 rounded-md" />
					<Skeleton aria-hidden="true" className="h-9 w-28 rounded-md" />
				</div>
				<main className="flex flex-1 items-center justify-center py-8 sm:py-10">
					<Skeleton
						aria-hidden="true"
						className="h-[30rem] w-full max-w-5xl rounded-xl"
					/>
				</main>
				<Skeleton
					aria-hidden="true"
					className="mx-auto mb-3 h-4 w-64 max-w-full"
				/>
			</div>
		</div>
	);
}

async function OnboardingLayoutContent({
	children,
}: {
	children: React.ReactNode;
}) {
	// Random onboarding backgrounds must be selected per request.
	await connection();
	const backgroundImage = selectRandomAuthBackgroundImage();

	return (
		<div className="relative min-h-svh overflow-x-hidden bg-background">
			<AuthBackgroundImage initialImage={backgroundImage} />
			<section className="relative z-10 flex min-h-svh flex-col px-4 pt-4 pb-0 sm:px-8 sm:pt-6 sm:pb-0 lg:px-10">
				<div className="auth-shell-controls auth-shell-controls-readable flex items-center justify-end gap-2 drop-shadow-sm [&_[data-slot=dropdown-menu-trigger]]:!border-white/20 [&_[data-slot=dropdown-menu-trigger]]:!bg-slate-950/85 [&_[data-slot=dropdown-menu-trigger]]:!text-white [&_[data-slot=dropdown-menu-trigger]]:!shadow-lg [&_[data-slot=dropdown-menu-trigger]]:!shadow-slate-950/20 [&_[data-slot=dropdown-menu-trigger]]:!backdrop-blur-xl [&_[data-slot=dropdown-menu-trigger]:hover]:!bg-slate-950/95 [&_[data-slot=select-trigger]]:!border-white/20 [&_[data-slot=select-trigger]]:!bg-slate-950/85 [&_[data-slot=select-trigger]]:!text-white [&_[data-slot=select-trigger]]:!shadow-lg [&_[data-slot=select-trigger]]:!shadow-slate-950/20 [&_[data-slot=select-trigger]]:!backdrop-blur-xl [&_[data-slot=select-trigger]:hover]:!bg-slate-950/95 [&_[data-slot=select-trigger]_svg]:!text-white">
					<ThemeToggle />
					<FontSizeToggle />
					<LanguageSwitcher />
				</div>

				<main className="onboarding-glass-scope flex flex-1 items-center justify-center py-8 sm:py-10 [&_[data-slot=card]]:border-white/30 [&_[data-slot=card]]:bg-white/20 [&_[data-slot=card]]:shadow-xl [&_[data-slot=card]]:shadow-black/5 [&_[data-slot=card]]:backdrop-blur-[40px] [&_[data-slot=card]_.text-muted-foreground]:text-foreground/75 dark:[&_[data-slot=card]]:border-white/10 dark:[&_[data-slot=card]]:bg-slate-950/20 dark:[&_[data-slot=card]]:shadow-black/30">
					<div className="w-full max-w-5xl">{children}</div>
				</main>

				<div className="pt-2 pb-2 drop-shadow-sm">
					<InfoFooter />
				</div>
			</section>
		</div>
	);
}
