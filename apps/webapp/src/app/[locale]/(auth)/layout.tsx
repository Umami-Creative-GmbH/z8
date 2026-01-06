import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
			<div className="w-full md:max-w-3xl">
				<div className="mb-4 flex justify-end">
					<LanguageSwitcher />
				</div>
				{children}
				<div className="mt-6">
					<InfoFooter />
				</div>
			</div>
		</div>
	);
}
