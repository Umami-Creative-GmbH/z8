import { connection } from "next/server";
import { AuthBackgroundImage } from "@/components/auth-background-image";
import { selectRandomAuthBackgroundImage } from "@/components/auth-background-images";
import { FontSizeToggle } from "@/components/font-size-toggle";
import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
	await connection();
	const backgroundImage = selectRandomAuthBackgroundImage();

	return (
		<div className="relative min-h-svh overflow-x-hidden bg-background">
			<AuthBackgroundImage initialImage={backgroundImage} />
			<section className="relative z-10 flex min-h-svh flex-col px-4 pt-4 pb-0 sm:px-8 sm:pt-6 sm:pb-0 lg:px-10">
				<div className="flex items-center justify-end gap-2 drop-shadow-sm">
					<ThemeToggle />
					<FontSizeToggle />
					<LanguageSwitcher />
				</div>

				<main className="onboarding-glass-scope flex flex-1 items-center justify-center py-8 sm:py-10 [&_[data-slot=card]]:border-white/30 [&_[data-slot=card]]:bg-white/20 [&_[data-slot=card]]:shadow-xl [&_[data-slot=card]]:shadow-black/5 [&_[data-slot=card]]:backdrop-blur-[40px] [&_[data-slot=card]_.text-muted-foreground]:text-foreground/75 dark:[&_[data-slot=card]]:border-white/10 dark:[&_[data-slot=card]]:bg-slate-950/20 dark:[&_[data-slot=card]]:shadow-black/30">
					<div className="w-full max-w-5xl">{children}</div>
				</main>

				<div className="pt-2 drop-shadow-sm">
					<InfoFooter />
				</div>
			</section>
		</div>
	);
}
