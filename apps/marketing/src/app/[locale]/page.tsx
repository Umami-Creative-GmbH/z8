import { cacheLife } from "next/cache";
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

export default async function Home() {
	"use cache";
	cacheLife("max");

	return (
		<ThemeProvider>
			<AnnouncementBar />
			<Header />
			<HeroSection />
			<LogoBar />
			<StatsRibbon />
			<FeaturesGrid />
			<DetailedFeatures />
			<ProductGallery />
			<Testimonials />
			<LargeBanner />
			<PricingSection />
			<ComparisonTable />
			<Integrations />
			<HowItWorks />
			<FaqSection />
			<NewsletterCta />
			<FinalCta />
			<Footer />
		</ThemeProvider>
	);
}
