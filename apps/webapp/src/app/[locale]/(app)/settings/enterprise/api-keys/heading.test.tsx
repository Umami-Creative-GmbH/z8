// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { OrganizationContextProvider } from "@/components/providers/organization-context-provider";
import { ViewRefreshProvider } from "@/components/providers/view-refresh-provider";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { SiteHeader } from "@/components/site-header";
import { SidebarProvider } from "@/components/ui/sidebar";
import { appPageOwnsHeading } from "@/lib/navigation/route-metadata";
import { render } from "@/test/render-with-translations";

vi.mock("@/lib/auth-client", () => ({ useSession: () => ({ data: null, isPending: false }) }));
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("next/navigation", () => ({
	useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
	useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/navigation", () => ({
	Link: ({ href, children }: { href: string; children: ReactNode }) => (
		<a href={href}>{children}</a>
	),
	usePathname: () => "/de/settings/enterprise/api-keys/",
	useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));
afterEach(cleanup);

it("assembles one Developer Access heading with the real SiteHeader and preserves deep owners", () => {
	vi.stubGlobal("matchMedia", () => ({
		matches: false,
		addEventListener() {},
		removeEventListener() {},
	}));
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<OrganizationContextProvider initialContext={null}>
				<ViewRefreshProvider>
					<SidebarProvider>
						<SiteHeader />
						<main>
							<SettingsTabbedPage
								title="Developer Access"
								defaultTab="keys"
								tabs={[
									{
										value: "keys",
										label: "API Keys",
										description: "Organization credentials",
										panel: <p>Keys</p>,
									},
								]}
							/>
						</main>
					</SidebarProvider>
				</ViewRefreshProvider>
			</OrganizationContextProvider>
		</QueryClientProvider>,
	);
	expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
	expect(appPageOwnsHeading("/en/settings/enterprise/api-keys/example-key")).toBe(false);
	expect(appPageOwnsHeading("/en/settings/webhooks")).toBe(false);
	expect(appPageOwnsHeading("/en/settings/enterprise/api-keys/deeper/route")).toBe(false);
});
