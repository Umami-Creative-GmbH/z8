import { headers } from "next/headers";
import { connection } from "next/server";
import { InfoFooter } from "@/components/info-footer";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { DomainAuthProvider } from "@/lib/auth/domain-auth-context";
import { getDomainConfig } from "@/lib/domain";
import { DOMAIN_HEADERS } from "@/proxy";
import { ALL_LANGUAGES } from "@/tolgee/shared";

export async function generateStaticParams() {
	return ALL_LANGUAGES.map((locale) => ({ locale }));
}

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Get domain from proxy headers
	const headersList = await headers();
	const customDomain = headersList.get(DOMAIN_HEADERS.DOMAIN);

	// Fetch domain config if on custom domain
	let domainContext = null;
	if (customDomain) {
		domainContext = await getDomainConfig(customDomain);
	}

	return (
		<DomainAuthProvider domainContext={domainContext}>
			<div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
				<div className="w-full md:max-w-3xl">
					<div className="mb-4 flex justify-end gap-2">
						<ThemeToggle />
						<LanguageSwitcher />
					</div>
					{children}
					<div className="mt-6">
						<InfoFooter />
					</div>
				</div>
			</div>
		</DomainAuthProvider>
	);
}
