import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";

export default function OnboardingLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-h-svh flex-col bg-background">
			<div className="container mx-auto px-6 py-8">
				{/* Top Bar with Language Switcher */}
				<div className="mb-4 flex justify-end">
					<LanguageSwitcher />
				</div>

				{/* Main Content */}
				<div className="flex-1">{children}</div>

				{/* Footer */}
				<div className="mt-12">
					<InfoFooter />
				</div>
			</div>
		</div>
	);
}
