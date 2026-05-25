import Image from "next/image";
import authImage from "@/../public/ally-griffin-3hsrEvJi_gw-unsplash.jpg";
import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="relative min-h-svh overflow-x-hidden bg-background">
			<Image
				alt=""
				className="absolute inset-0 size-full object-cover"
				fill
				priority
				sizes="100vw"
				src={authImage}
			/>
			<div className="absolute inset-0 bg-background/35 dark:bg-background/55" />

			<section className="relative z-10 flex min-h-svh flex-col px-4 py-4 sm:px-8 sm:py-6 lg:px-10">
				<div className="flex items-center justify-end gap-2 drop-shadow-sm">
					<ThemeToggle />
					<LanguageSwitcher />
				</div>

				<main className="onboarding-glass-scope flex flex-1 items-center justify-center py-8 sm:py-10 [&_[data-slot=card]]:border-white/30 [&_[data-slot=card]]:bg-white/20 [&_[data-slot=card]]:shadow-xl [&_[data-slot=card]]:shadow-black/5 [&_[data-slot=card]]:backdrop-blur-md dark:[&_[data-slot=card]]:border-white/10 dark:[&_[data-slot=card]]:bg-slate-950/45 dark:[&_[data-slot=card]]:shadow-black/30">
					<div className="w-full max-w-5xl">{children}</div>
				</main>

				<div className="pt-2 drop-shadow-sm">
					<InfoFooter />
				</div>
			</section>
		</div>
	);
}
