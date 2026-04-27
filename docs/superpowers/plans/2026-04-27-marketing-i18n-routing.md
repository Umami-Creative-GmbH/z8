# Marketing I18n Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add German-default `/de` and English `/en` routing, translations, language switching, and localized SEO to the marketing app.

**Architecture:** Use explicit App Router locale segments with a small typed locale layer instead of adding an i18n dependency. The root route redirects to `/de`; localized pages validate `de` and `en`, load local dictionaries, and render existing components with translated content. Alternate `s-1` through `s-10` pages move under `[locale]` and receive locale-specific copy while preserving their current visual treatments.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, Tailwind utilities, local TypeScript dictionaries, `pnpm --filter marketing build`.

---

## File Structure

- Create: `apps/marketing/src/i18n/locales.ts`
  - Owns `locales`, `defaultLocale`, `Locale`, `isLocale`, `assertLocale`, and localized path helpers.
- Create: `apps/marketing/src/i18n/landing-copy.ts`
  - Owns German and English copy/data for the main homepage sections.
- Create: `apps/marketing/src/i18n/seo.ts`
  - Owns localized metadata helpers for canonical URLs and language alternates.
- Create: `apps/marketing/src/i18n/variant-copy.ts`
  - Owns reusable translations for the `s-1` through `s-10` pages where copy is extracted.
- Create: `apps/marketing/src/components/ui/language-switcher.tsx`
  - Client component that switches between `/de` and `/en` while preserving the current path and hash.
- Modify: `apps/marketing/src/app/layout.tsx`
  - Keep only root shell concerns and theme flash prevention; remove hard-coded `lang="en"` from the root layout.
- Create: `apps/marketing/src/app/page.tsx`
  - Replace the current homepage with a redirect to `/de`.
- Create: `apps/marketing/src/app/[locale]/layout.tsx`
  - Validate locale and set `<html lang={locale}>` for localized pages.
- Create: `apps/marketing/src/app/[locale]/page.tsx`
  - Render the localized main homepage using the dictionary.
- Create: `apps/marketing/src/app/[locale]/s-1/page.tsx` through `apps/marketing/src/app/[locale]/s-10/page.tsx`
  - Render localized alternate pages.
- Modify: `apps/marketing/src/components/landing/*.tsx`
  - Replace hard-coded main homepage strings and imported German data with typed props.
- Modify: `apps/marketing/src/app/s-1/page.tsx` through `apps/marketing/src/app/s-10/page.tsx`
  - Move or refactor existing pages into localized route files.

---

### Task 1: Add Locale Primitives

**Files:**
- Create: `apps/marketing/src/i18n/locales.ts`
- Create: `apps/marketing/src/i18n/seo.ts`

- [ ] **Step 1: Create locale helpers**

Create `apps/marketing/src/i18n/locales.ts`:

```ts
export const locales = ["de", "en"] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "de";

export function isLocale(value: string): value is Locale {
	return locales.includes(value as Locale);
}

export function getLocalizedPath(pathname: string, locale: Locale): string {
	const hashIndex = pathname.indexOf("#");
	const pathWithoutHash = hashIndex === -1 ? pathname : pathname.slice(0, hashIndex);
	const hash = hashIndex === -1 ? "" : pathname.slice(hashIndex);
	const segments = pathWithoutHash.split("/").filter(Boolean);

	if (segments.length > 0 && isLocale(segments[0])) {
		segments[0] = locale;
		return `/${segments.join("/")}${hash}`;
	}

	return `/${locale}${pathWithoutHash === "/" ? "" : pathWithoutHash}${hash}`;
}

export function alternatePath(pathname: string): Record<Locale | "x-default", string> {
	return {
		de: getLocalizedPath(pathname, "de"),
		en: getLocalizedPath(pathname, "en"),
		"x-default": getLocalizedPath(pathname, defaultLocale),
	};
}
```

- [ ] **Step 2: Create SEO helpers**

Create `apps/marketing/src/i18n/seo.ts`:

```ts
import type { Metadata } from "next";
import type { Locale } from "./locales";
import { alternatePath } from "./locales";

const siteUrl = "https://z8-time.app";

const homeMetadata: Record<Locale, { title: string; description: string }> = {
	de: {
		title: "Z8 | Zeiterfassung und Workforce Management",
		description: "Z8 vereint Zeiterfassung, Lohnexport, Schichtplanung und Analysen fuer moderne Unternehmen.",
	},
	en: {
		title: "Z8 | Time Tracking and Workforce Management",
		description: "Z8 brings time tracking, payroll export, scheduling, and analytics together for modern teams.",
	},
};

export function localizedMetadata(locale: Locale, pathname: string): Metadata {
	const path = pathname.startsWith(`/${locale}`) ? pathname : `/${locale}${pathname === "/" ? "" : pathname}`;
	const alternates = alternatePath(path);

	return {
		...homeMetadata[locale],
		alternates: {
			canonical: `${siteUrl}${path}`,
			languages: {
				de: `${siteUrl}${alternates.de}`,
				en: `${siteUrl}${alternates.en}`,
				"x-default": `${siteUrl}${alternates["x-default"]}`,
			},
		},
		openGraph: {
			...homeMetadata[locale],
			url: `${siteUrl}${path}`,
			siteName: "Z8",
			type: "website",
			locale: locale === "de" ? "de_DE" : "en_US",
		},
	};
}
```

- [ ] **Step 3: Run TypeScript build check**

Run: `pnpm --filter marketing build`

Expected: build may fail because the new helpers are unused or because route files are not moved yet; there must be no syntax error in `locales.ts` or `seo.ts`.

- [ ] **Step 4: Commit locale primitives**

```bash
git add apps/marketing/src/i18n/locales.ts apps/marketing/src/i18n/seo.ts
git commit -m "feat: add marketing locale helpers"
```

---

### Task 2: Add Locale Routing Shell

**Files:**
- Modify: `apps/marketing/src/app/layout.tsx`
- Modify: `apps/marketing/src/app/page.tsx`
- Create: `apps/marketing/src/app/[locale]/layout.tsx`

- [ ] **Step 1: Make root layout language-neutral**

Modify `apps/marketing/src/app/layout.tsx` so it keeps metadata and theme script but no longer hard-codes English as the only document language. Keep the existing theme script unchanged.

Expected resulting component shape:

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
	return (
		<html suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{ __html: themeScript }} />
			</head>
			<body className="antialiased">{children}</body>
		</html>
	);
}
```

- [ ] **Step 2: Redirect root to German**

Replace `apps/marketing/src/app/page.tsx` with:

```tsx
import { redirect } from "next/navigation";
import { defaultLocale } from "@/i18n/locales";

export default function RootPage() {
	redirect(`/${defaultLocale}`);
}
```

- [ ] **Step 3: Add localized layout**

Create `apps/marketing/src/app/[locale]/layout.tsx`:

```tsx
import { notFound } from "next/navigation";
import { isLocale, type Locale } from "@/i18n/locales";

export function generateStaticParams() {
	return [{ locale: "de" }, { locale: "en" }];
}

export default async function LocaleLayout({
	children,
	params,
}: {
	children: React.ReactNode;
	params: Promise<{ locale: string }>;
}) {
	const { locale } = await params;

	if (!isLocale(locale)) {
		notFound();
	}

	return <div data-locale={locale satisfies Locale}>{children}</div>;
}
```

- [ ] **Step 4: Run build**

Run: `pnpm --filter marketing build`

Expected: build may fail until localized pages are added; if it fails, the failure should mention missing localized page content rather than invalid layout syntax.

- [ ] **Step 5: Commit routing shell**

```bash
git add apps/marketing/src/app/layout.tsx apps/marketing/src/app/page.tsx apps/marketing/src/app/[locale]/layout.tsx
git commit -m "feat: add marketing locale routing shell"
```

---

### Task 3: Localize Main Homepage Data

**Files:**
- Create: `apps/marketing/src/i18n/landing-copy.ts`
- Modify: `apps/marketing/src/components/landing/data.ts`

- [ ] **Step 1: Create typed homepage copy**

Create `apps/marketing/src/i18n/landing-copy.ts` with German content copied from `apps/marketing/src/components/landing/data.ts` and English equivalents. Use this exact exported shape:

```ts
import type { Locale } from "./locales";

export type NavItem = { href: string; label: string };
export type Stat = { value: string; label: string; sub: string };
export type DetailedFeature = { tag: string; title: string; desc: string; image: string };
export type Testimonial = { quote: string; name: string; role: string; avatar: string };
export type PricingPlan = { name: string; price: string; period: string; desc: string; features: string[]; cta: string; highlighted: boolean };
export type Integration = { name: string; category: string };
export type Comparison = { feature: string; z8: boolean; others: boolean };
export type Faq = { q: string; a: string };
export type FeatureGridItem = { title: string; desc: string };
export type HowItWorksStep = { step: string; title: string; desc: string };

export type LandingCopy = {
	announcement: { badge: string; text: string };
	header: { login: string; cta: string; navItems: NavItem[] };
	hero: { titleLines: [string, string]; body: string; cta: string; noteLines: [string, string]; eyebrow: string; features: string[] };
	logos: string[];
	stats: Stat[];
	detailedFeatures: DetailedFeature[];
	testimonials: Testimonial[];
	pricingPlans: PricingPlan[];
	integrations: Integration[];
	comparisons: Comparison[];
	faqs: Faq[];
	footerLinks: Record<string, string[]>;
	featuresGridItems: FeatureGridItem[];
	howItWorksSteps: HowItWorksStep[];
	galleryImages: string[];
	footer: { description: string; privacy: string; terms: string; imprint: string; status: string };
};

export const landingCopy: Record<Locale, LandingCopy> = {
	de: {
		announcement: { badge: "Neu", text: "Z8 v4 ist da: Schneller, schoener, smarter." },
		header: {
			login: "Anmelden",
			cta: "Kostenlos starten",
			navItems: [
				{ href: "#features", label: "Produkt" },
				{ href: "#detailed", label: "Funktionen" },
				{ href: "#pricing", label: "Preise" },
				{ href: "#integrations", label: "Integrationen" },
				{ href: "#faq", label: "FAQ" },
			],
		},
		hero: {
			titleLines: ["Zeiterfassung.", "Endlich geloest."],
			body: "Ersetzen Sie Ihre gesamte Tool-Landschaft. Stempeluhr, Lohnexport und Analyse - alles an einem Ort.",
			cta: "Kostenlos starten",
			noteLines: ["Dauerhaft kostenlos.", "Keine Kreditkarte."],
			eyebrow: "ALLES IN EINEM WERKZEUG",
			features: ["Stempeluhr", "GoBD-konform", "Lohnexport", "Multi-Tenant", "Enterprise-SSO", "Echtzeit-Analyse", "Dashboards", "Automatisierung", "DATEV-Export", "Schichtplanung"],
		},
		logos: ["DATEV", "Lexware", "Personio", "SAP", "Sage"],
		stats: [
			{ value: "2.400+", label: "Unternehmen", sub: "vertrauen auf Z8" },
			{ value: "99,98%", label: "Uptime", sub: "seit 2022" },
			{ value: "340k", label: "Mitarbeiter", sub: "erfassen taeglich" },
			{ value: "<2s", label: "Ladezeit", sub: "Median weltweit" },
		],
		detailedFeatures: [],
		testimonials: [],
		pricingPlans: [],
		integrations: [],
		comparisons: [],
		faqs: [],
		footerLinks: {},
		featuresGridItems: [],
		howItWorksSteps: [],
		galleryImages: [],
		footer: {
			description: "Workforce Management fuer moderne Unternehmen. Zeiterfassung, Lohnexport und Analyse in einem.",
			privacy: "Datenschutz",
			terms: "AGB",
			imprint: "Impressum",
			status: "Alle Systeme operativ",
		},
	},
	en: {
		announcement: { badge: "New", text: "Z8 v4 is here: faster, cleaner, smarter." },
		header: {
			login: "Sign in",
			cta: "Start free",
			navItems: [
				{ href: "#features", label: "Product" },
				{ href: "#detailed", label: "Features" },
				{ href: "#pricing", label: "Pricing" },
				{ href: "#integrations", label: "Integrations" },
				{ href: "#faq", label: "FAQ" },
			],
		},
		hero: {
			titleLines: ["Time tracking.", "Finally solved."],
			body: "Replace your scattered tool stack. Time clock, payroll export, and analytics - all in one place.",
			cta: "Start free",
			noteLines: ["Free forever.", "No credit card."],
			eyebrow: "ALL IN ONE TOOL",
			features: ["Time clock", "GoBD-ready", "Payroll export", "Multi-tenant", "Enterprise SSO", "Real-time analytics", "Dashboards", "Automation", "DATEV export", "Shift planning"],
		},
		logos: ["DATEV", "Lexware", "Personio", "SAP", "Sage"],
		stats: [
			{ value: "2,400+", label: "Companies", sub: "trust Z8" },
			{ value: "99.98%", label: "Uptime", sub: "since 2022" },
			{ value: "340k", label: "Employees", sub: "track time daily" },
			{ value: "<2s", label: "Load time", sub: "global median" },
		],
		detailedFeatures: [],
		testimonials: [],
		pricingPlans: [],
		integrations: [],
		comparisons: [],
		faqs: [],
		footerLinks: {},
		featuresGridItems: [],
		howItWorksSteps: [],
		galleryImages: [],
		footer: {
			description: "Workforce management for modern companies. Time tracking, payroll export, and analytics in one place.",
			privacy: "Privacy",
			terms: "Terms",
			imprint: "Legal notice",
			status: "All systems operational",
		},
	},
};
```

Then fill the empty arrays in both locales by moving the existing German values from `data.ts` into `de` and adding English equivalents with the same array lengths and object keys. Keep image URLs unchanged.

- [ ] **Step 2: Replace old data exports**

Change `apps/marketing/src/components/landing/data.ts` to re-export types only if still needed, or remove imports from all consumers in Task 4. Do not keep separate German-only source data after Task 4.

- [ ] **Step 3: Typecheck dictionary shape**

Run: `pnpm --filter marketing build`

Expected: TypeScript should catch any missing German or English fields. Route/component errors are acceptable until Task 4 is complete.

- [ ] **Step 4: Commit homepage copy model**

```bash
git add apps/marketing/src/i18n/landing-copy.ts apps/marketing/src/components/landing/data.ts
git commit -m "feat: add marketing homepage translations"
```

---

### Task 4: Pass Homepage Copy Through Components

**Files:**
- Modify: `apps/marketing/src/app/[locale]/page.tsx`
- Modify: `apps/marketing/src/components/landing/announcement-bar.tsx`
- Modify: `apps/marketing/src/components/landing/header.tsx`
- Modify: `apps/marketing/src/components/landing/hero-section.tsx`
- Modify: all other `apps/marketing/src/components/landing/*.tsx` files that currently import `./data`

- [ ] **Step 1: Create localized homepage page**

Create `apps/marketing/src/app/[locale]/page.tsx` using the existing homepage section order:

```tsx
import { cacheLife } from "next/cache";
import { notFound } from "next/navigation";
import { AnnouncementBar } from "@/components/landing/announcement-bar";
import { ComparisonTable } from "@/components/landing/comparison-table";
import { DetailedFeatures } from "@/components/landing/detailed-features";
import { FaqSection } from "@/components/landing/faq-section";
import { FeaturesGrid } from "@/components/landing/features-grid";
import { FinalCta } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";
import { Header } from "@/components/landing/header";
import { HeroSection } from "@/components/landing/hero-section";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Integrations } from "@/components/landing/integrations";
import { LargeBanner } from "@/components/landing/large-banner";
import { LogoBar } from "@/components/landing/logo-bar";
import { NewsletterCta } from "@/components/landing/newsletter-cta";
import { PricingSection } from "@/components/landing/pricing-section";
import { ProductGallery } from "@/components/landing/product-gallery";
import { StatsRibbon } from "@/components/landing/stats-ribbon";
import { Testimonials } from "@/components/landing/testimonials";
import { ThemeProvider } from "@/components/theme/theme-context";
import { isLocale, type Locale } from "@/i18n/locales";
import { landingCopy } from "@/i18n/landing-copy";
import { localizedMetadata } from "@/i18n/seo";

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps) {
	const { locale } = await params;
	if (!isLocale(locale)) {
		return {};
	}
	return localizedMetadata(locale, `/${locale}`);
}

export default async function Home({ params }: PageProps) {
	"use cache";
	cacheLife("max");

	const { locale } = await params;
	if (!isLocale(locale)) {
		notFound();
	}

	const copy = landingCopy[locale satisfies Locale];

	return (
		<ThemeProvider>
			<AnnouncementBar copy={copy.announcement} />
			<Header copy={copy.header} locale={locale} />
			<HeroSection copy={copy.hero} />
			<LogoBar logos={copy.logos} />
			<StatsRibbon stats={copy.stats} />
			<FeaturesGrid items={copy.featuresGridItems} />
			<DetailedFeatures features={copy.detailedFeatures} />
			<ProductGallery images={copy.galleryImages} />
			<Testimonials testimonials={copy.testimonials} />
			<LargeBanner />
			<PricingSection plans={copy.pricingPlans} />
			<ComparisonTable comparisons={copy.comparisons} />
			<Integrations integrations={copy.integrations} />
			<HowItWorks steps={copy.howItWorksSteps} />
			<FaqSection faqs={copy.faqs} />
			<NewsletterCta />
			<FinalCta />
			<Footer links={copy.footerLinks} copy={copy.footer} />
		</ThemeProvider>
	);
}
```

- [ ] **Step 2: Update content components to accept props**

For each landing component, replace imports from `./data` with explicit props. Example for `AnnouncementBar`:

```tsx
import { v } from "@/components/theme/tokens";

type AnnouncementBarProps = {
	copy: { badge: string; text: string };
};

export function AnnouncementBar({ copy }: AnnouncementBarProps) {
	return (
		<div className="relative z-20 flex items-center justify-center gap-2 py-2.5 text-[12px]" style={{ backgroundColor: v("bgAlt"), borderBottom: `1px solid ${v("border")}`, transition: "background-color 0.4s ease, border-color 0.4s ease" }}>
			<span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold" style={{ backgroundColor: v("surface"), color: v("surfaceText"), transition: "background-color 0.4s ease" }}>
				{copy.badge}
			</span>
			<span style={{ color: v("textSecondary"), transition: "color 0.4s ease" }}>{copy.text}</span>
			<span style={{ color: v("textTertiary") }}>&rsaquo;</span>
		</div>
	);
}
```

Apply the same pattern to the rest of the homepage components: props names must match the `Home` component in Step 1.

- [ ] **Step 3: Run build**

Run: `pnpm --filter marketing build`

Expected: `/de` and `/en` compile for the main homepage. Failures should only remain for `s-1` through `s-10` if they have not been moved yet.

- [ ] **Step 4: Commit localized homepage**

```bash
git add apps/marketing/src/app/page.tsx apps/marketing/src/app/[locale]/page.tsx apps/marketing/src/components/landing apps/marketing/src/i18n/landing-copy.ts
git commit -m "feat: localize marketing homepage"
```

---

### Task 5: Add Language Switcher

**Files:**
- Create: `apps/marketing/src/components/ui/language-switcher.tsx`
- Modify: `apps/marketing/src/components/landing/header.tsx`

- [ ] **Step 1: Create switcher component**

Create `apps/marketing/src/components/ui/language-switcher.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getLocalizedPath, type Locale } from "@/i18n/locales";

type LanguageSwitcherProps = {
	locale: Locale;
};

export function LanguageSwitcher({ locale }: LanguageSwitcherProps) {
	const pathname = usePathname() || `/${locale}`;
	const languages: Array<{ locale: Locale; label: string }> = [
		{ locale: "de", label: "DE" },
		{ locale: "en", label: "EN" },
	];

	return (
		<div className="flex h-9 items-center rounded-lg border border-black/10 bg-black/[0.03] p-0.5 text-[11px] font-bold dark:border-white/10 dark:bg-white/[0.04]" aria-label="Language selection">
			{languages.map((item) => {
				const active = item.locale === locale;
				return (
					<Link
						key={item.locale}
						href={getLocalizedPath(pathname, item.locale)}
						aria-current={active ? "page" : undefined}
						className="rounded-md px-2.5 py-1.5 transition-colors"
						style={{ opacity: active ? 1 : 0.62 }}
					>
						{item.label}
					</Link>
				);
			})}
		</div>
	);
}
```

- [ ] **Step 2: Place switcher near theme toggle**

In `apps/marketing/src/components/landing/header.tsx`, import and render `<LanguageSwitcher locale={locale} />` immediately before `<ThemeToggle />`. The header props should be:

```ts
type HeaderProps = {
	copy: {
		login: string;
		cta: string;
		navItems: Array<{ href: string; label: string }>;
	};
	locale: Locale;
};
```

- [ ] **Step 3: Run build**

Run: `pnpm --filter marketing build`

Expected: homepage builds and the header has a language switcher on `/de` and `/en`.

- [ ] **Step 4: Commit switcher**

```bash
git add apps/marketing/src/components/ui/language-switcher.tsx apps/marketing/src/components/landing/header.tsx
git commit -m "feat: add marketing language switcher"
```

---

### Task 6: Move And Localize Variant Pages

**Files:**
- Create: `apps/marketing/src/i18n/variant-copy.ts`
- Create: `apps/marketing/src/app/[locale]/s-1/page.tsx` through `apps/marketing/src/app/[locale]/s-10/page.tsx`
- Delete: `apps/marketing/src/app/s-1/page.tsx` through `apps/marketing/src/app/s-10/page.tsx`

- [ ] **Step 1: Create variant copy helpers**

Create `apps/marketing/src/i18n/variant-copy.ts`:

```ts
import type { Locale } from "./locales";

export type VariantId = "s-1" | "s-2" | "s-3" | "s-4" | "s-5" | "s-6" | "s-7" | "s-8" | "s-9" | "s-10";

export const variantMetadata: Record<VariantId, Record<Locale, { title: string; description: string }>> = {
	"s-1": {
		de: { title: "Z8 Designstudie 1", description: "Eine alternative Z8 Marketingseite mit ruhiger, japanisch inspirierter Gestaltung." },
		en: { title: "Z8 Design Study 1", description: "An alternate Z8 marketing page with a calm, Japanese-inspired visual direction." },
	},
	"s-2": {
		de: { title: "Z8 Designstudie 2", description: "Eine organische Z8 Marketingseite fuer einfache Zeiterfassung." },
		en: { title: "Z8 Design Study 2", description: "An organic Z8 marketing page for simple time tracking." },
	},
	"s-3": { de: { title: "Z8 Designstudie 3", description: "Alternative Z8 Marketingseite." }, en: { title: "Z8 Design Study 3", description: "Alternate Z8 marketing page." } },
	"s-4": { de: { title: "Z8 Designstudie 4", description: "Alternative Z8 Marketingseite." }, en: { title: "Z8 Design Study 4", description: "Alternate Z8 marketing page." } },
	"s-5": { de: { title: "Z8 Designstudie 5", description: "Alternative Z8 Marketingseite." }, en: { title: "Z8 Design Study 5", description: "Alternate Z8 marketing page." } },
	"s-6": { de: { title: "Z8 Designstudie 6", description: "Alternative Z8 Marketingseite." }, en: { title: "Z8 Design Study 6", description: "Alternate Z8 marketing page." } },
	"s-7": { de: { title: "Z8 Designstudie 7", description: "Alternative Z8 Marketingseite." }, en: { title: "Z8 Design Study 7", description: "Alternate Z8 marketing page." } },
	"s-8": { de: { title: "Z8 Designstudie 8", description: "Alternative Z8 Marketingseite." }, en: { title: "Z8 Design Study 8", description: "Alternate Z8 marketing page." } },
	"s-9": { de: { title: "Z8 Designstudie 9", description: "Alternative Z8 Marketingseite." }, en: { title: "Z8 Design Study 9", description: "Alternate Z8 marketing page." } },
	"s-10": {
		de: { title: "Z8 Designstudie 10", description: "Eine praezise, dunkle Z8 Marketingseite fuer Workforce Management." },
		en: { title: "Z8 Design Study 10", description: "A precise, dark Z8 marketing page for workforce management." },
	},
};
```

- [ ] **Step 2: Move each variant page under `[locale]`**

For each existing page `apps/marketing/src/app/s-N/page.tsx`, create `apps/marketing/src/app/[locale]/s-N/page.tsx` with the same visual implementation plus these route additions at the top:

```tsx
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/locales";
import { localizedMetadata } from "@/i18n/seo";

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps) {
	const { locale } = await params;
	if (!isLocale(locale)) {
		return {};
	}
	return localizedMetadata(locale, `/${locale}/s-N`);
}
```

Replace `s-N` with the actual route name in each file.

- [ ] **Step 3: Localize visible variant strings**

In each localized variant page, define a local `copy` object immediately inside the component after locale validation:

```tsx
export default async function DesignSN({ params }: PageProps) {
	const { locale } = await params;
	if (!isLocale(locale)) {
		notFound();
	}

	const copy = locale === "de" ? {
		brandSubtitle: "Zeiterfassung",
		features: "Funktionen",
		pricing: "Preise",
		contact: "Kontakt",
		start: "Starten",
		trial: "Kostenlos testen",
	} : {
		brandSubtitle: "Time tracking",
		features: "Features",
		pricing: "Pricing",
		contact: "Contact",
		start: "Start",
		trial: "Try for free",
	};
```

Replace every visible German text literal in that file with a `copy` property. Use natural English translations for the English branch and keep German text equivalent to the current page. Preserve decorative symbols, image URLs, colors, and layout classes.

- [ ] **Step 4: Delete unprefixed variant pages**

Delete the old unlocalized route files:

```bash
rm -r apps/marketing/src/app/s-1 apps/marketing/src/app/s-2 apps/marketing/src/app/s-3 apps/marketing/src/app/s-4 apps/marketing/src/app/s-5 apps/marketing/src/app/s-6 apps/marketing/src/app/s-7 apps/marketing/src/app/s-8 apps/marketing/src/app/s-9 apps/marketing/src/app/s-10
```

- [ ] **Step 5: Run build**

Run: `pnpm --filter marketing build`

Expected: all localized routes `/de`, `/en`, `/de/s-1` through `/de/s-10`, and `/en/s-1` through `/en/s-10` build successfully.

- [ ] **Step 6: Commit variant routes**

```bash
git add apps/marketing/src/app apps/marketing/src/i18n/variant-copy.ts
git commit -m "feat: localize marketing variant pages"
```

---

### Task 7: Final SEO And Route Verification

**Files:**
- Modify as needed: `apps/marketing/src/i18n/seo.ts`
- Modify as needed: localized page files

- [ ] **Step 1: Verify root redirect and localized build**

Run: `pnpm --filter marketing build`

Expected: PASS. Output should include static or dynamic routes for `/`, `/[locale]`, and `/[locale]/s-N` pages without TypeScript errors.

- [ ] **Step 2: Inspect generated route metadata in source**

Run: `git grep -n "alternates\|canonical\|x-default\|generateMetadata" -- apps/marketing/src`

Expected: `generateMetadata` exists for the localized homepage and variant pages; `localizedMetadata` sets canonical and `x-default` language alternates.

- [ ] **Step 3: Check no German-only homepage data imports remain**

Run: `git grep -n "from \"./data\"\|from './data'" -- apps/marketing/src/components/landing apps/marketing/src/app`

Expected: no matches.

- [ ] **Step 4: Check no old unprefixed variant routes remain**

Run: `test ! -d apps/marketing/src/app/s-1 && test ! -d apps/marketing/src/app/s-10`

Expected: command exits with status 0.

- [ ] **Step 5: Commit verification fixes**

If Step 1 through Step 4 required source changes, commit them:

```bash
git add apps/marketing/src
git commit -m "fix: complete marketing i18n seo routing"
```

If no files changed, do not create an empty commit.

---

## Self-Review Notes

- Spec coverage: routing, German default, `/de` fallback, English route, menu language switcher, SEO metadata, homepage and `s-1` through `s-10` scope are covered.
- Placeholder scan: the only intentionally mechanical work is variant page string extraction; the plan defines the exact copy-object pattern and route additions for every variant page.
- Type consistency: `Locale`, `LandingCopy`, `localizedMetadata`, and route prop shapes are consistent across tasks.
