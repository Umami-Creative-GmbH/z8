import { cacheLife } from "next/cache";
import { ThemeProvider } from "@/components/theme/theme-context";
import { AnnouncementBar } from "@/components/landing/announcement-bar";
import { Header } from "@/components/landing/header";
import { HeroSection } from "@/components/landing/hero-section";
import { LogoBar } from "@/components/landing/logo-bar";
import { StatsRibbon } from "@/components/landing/stats-ribbon";
import { FeaturesGrid } from "@/components/landing/features-grid";
import { DetailedFeatures } from "@/components/landing/detailed-features";
import { ProductGallery } from "@/components/landing/product-gallery";
import { Testimonials } from "@/components/landing/testimonials";
import { LargeBanner } from "@/components/landing/large-banner";
import { PricingSection } from "@/components/landing/pricing-section";
import { ComparisonTable } from "@/components/landing/comparison-table";
import { Integrations } from "@/components/landing/integrations";
import { HowItWorks } from "@/components/landing/how-it-works";
import { FaqSection } from "@/components/landing/faq-section";
import { NewsletterCta } from "@/components/landing/newsletter-cta";
import { FinalCta } from "@/components/landing/final-cta";
import { Footer } from "@/components/landing/footer";

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
