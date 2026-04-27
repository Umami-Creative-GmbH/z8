import type { Metadata } from "next";
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
import { landingCopy } from "@/i18n/landing-copy";
import { alternatePath, isLocale } from "@/i18n/locales";

type PageProps = {
	params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
	const { locale } = await params;

	if (!isLocale(locale)) {
		notFound();
	}

	const copy = landingCopy[locale];

	return {
		title: `${copy.hero.title.join(" ")} | ${copy.header.brand}`,
		description: copy.hero.description,
		alternates: {
			languages: alternatePath("/"),
		},
	};
}

export default async function Home({ params }: PageProps) {
	"use cache";
	cacheLife("max");
	const { locale } = await params;

	if (!isLocale(locale)) {
		notFound();
	}

	const copy = landingCopy[locale];

	return (
		<ThemeProvider>
			<AnnouncementBar copy={copy.announcement} />
			<Header copy={copy.header} />
			<HeroSection copy={copy.hero} />
			<LogoBar copy={copy.logos} />
			<StatsRibbon stats={copy.stats} />
			<FeaturesGrid copy={copy.featuresGrid} />
			<DetailedFeatures copy={copy.detailedFeatures} />
			<ProductGallery images={copy.galleryImages} />
			<Testimonials copy={copy.testimonials} />
			<LargeBanner copy={copy.largeBanner} />
			<PricingSection copy={copy.pricing} />
			<ComparisonTable copy={copy.comparisons} />
			<Integrations copy={copy.integrations} />
			<HowItWorks copy={copy.howItWorks} />
			<FaqSection copy={copy.faqs} />
			<NewsletterCta copy={copy.newsletterCta} />
			<FinalCta copy={copy.finalCta} />
			<Footer copy={copy.footer} />
		</ThemeProvider>
	);
}
