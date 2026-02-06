import Image from "next/image";
import Link from "next/link";

export default function DesignM3() {
	return (
		<div
			className="noise min-h-screen"
			style={{
				fontFamily: "'Geist', 'Manrope', 'Instrument Sans', sans-serif",
				backgroundColor: "#0a0a10",
				color: "#e8e8f0",
			}}
		>
			{/* Cinematic ambient light */}
			<div
				className="pointer-events-none fixed inset-0 z-0"
				style={{
					background:
						"radial-gradient(ellipse 60% 50% at 60% 40%, rgba(50,50,90,0.15) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 25% 80%, rgba(40,40,80,0.08) 0%, transparent 50%)",
				}}
			/>

			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-6 lg:px-16">
				<div className="flex items-center gap-8">
					<span className="text-[20px] font-bold tracking-[-0.02em]">Z8</span>
					<nav className="hidden items-center gap-6 text-[14px] text-[#606080] md:flex">
						<a href="#features" className="transition-colors hover:text-white">Produkt</a>
						<a href="#features" className="transition-colors hover:text-white">Business</a>
						<a href="#contact" className="transition-colors hover:text-white">Preise</a>
						<a href="#contact" className="transition-colors hover:text-white">Unternehmen</a>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<a href="#contact" className="text-[14px] text-[#606080] transition-colors hover:text-white">
						Anmelden
					</a>
					<a
						href="#contact"
						className="rounded-full px-5 py-2.5 text-[13px] font-semibold transition-all hover:bg-white hover:text-[#0a0a10]"
						style={{ border: "1px solid rgba(255,255,255,0.2)", color: "#e8e8f0" }}
					>
						Starten
					</a>
				</div>
			</header>

			{/* Hero — cinematic full-height */}
			<section className="relative z-10 flex min-h-[85vh] flex-col justify-center px-8 lg:px-16">
				{/* 3D geometric shapes background */}
				<div className="pointer-events-none absolute inset-0 overflow-hidden">
					{/* Large pedestal block */}
					<div
						className="absolute right-[5%] top-[20%] h-[55vh] w-[35vw]"
						style={{
							background: "linear-gradient(145deg, #14141e 0%, #1a1a2a 50%, #0e0e18 100%)",
							transform: "perspective(800px) rotateY(-8deg) rotateX(3deg)",
							boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 40px 80px rgba(0,0,0,0.5)",
							borderRadius: "4px",
						}}
					/>
					{/* Smaller floating block */}
					<div
						className="absolute right-[15%] bottom-[15%] h-[25vh] w-[20vw]"
						style={{
							background: "linear-gradient(160deg, #18182a 0%, #12121e 100%)",
							transform: "perspective(600px) rotateY(-5deg) rotateX(5deg)",
							boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03), 0 30px 60px rgba(0,0,0,0.4)",
							borderRadius: "4px",
						}}
					/>
					{/* Light streak */}
					<div
						className="absolute left-[30%] top-[35%] h-px w-[40vw]"
						style={{
							background: "linear-gradient(90deg, transparent, rgba(200,200,255,0.08), transparent)",
							transform: "rotate(-5deg)",
						}}
					/>
				</div>

				<div className="relative z-10 max-w-2xl">
					<p
						className="animate-fade-up mb-8 text-[13px] font-medium text-[#606080]"
						style={{ animationDelay: "0.1s" }}
					>
						Z8 f&uuml;r Unternehmen
					</p>
					<h1
						className="animate-fade-up"
						style={{
							fontSize: "clamp(3rem, 6vw, 5rem)",
							fontWeight: 700,
							lineHeight: 1.1,
							letterSpacing: "-0.03em",
							animationDelay: "0.2s",
						}}
					>
						Zeiterfassung
						<br />
						jenseits des
						<br />
						Standards
					</h1>
					<p
						className="animate-fade-up mt-8 max-w-md text-[16px] leading-[1.8] text-[#606080]"
						style={{ animationDelay: "0.4s" }}
					>
						Bringen Sie Ihre Zeiterfassung auf das n&auml;chste Level &mdash;
						mit der L&ouml;sung, die f&uuml;r Effizienz gebaut und f&uuml;r Unternehmen gedacht ist.
					</p>
					<div className="animate-fade-up mt-10" style={{ animationDelay: "0.5s" }}>
						<a
							href="#contact"
							className="inline-flex rounded-full px-8 py-4 text-[14px] font-semibold text-[#0a0a10] transition-all hover:opacity-90"
							style={{ backgroundColor: "#e8e8f0" }}
						>
							Jetzt starten
						</a>
					</div>
				</div>
			</section>

			{/* Features — dark cards */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-6xl">
					<div className="mb-16">
						<span className="mb-3 block text-[12px] font-semibold uppercase tracking-[0.15em] text-[#606080]">
							Funktionen
						</span>
						<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.02em]">
							Gebaut f&uuml;r Anspruch.
						</h2>
					</div>

					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation über alle Geräte." },
							{ title: "GoBD-konform", desc: "Revisionssichere Einträge. Unantastbar dokumentiert und lückenlos." },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch und fehlerfrei." },
							{ title: "Multi-Tenant", desc: "Mandantenfähig. Organisationen isoliert, sicher und skalierbar." },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlos in Ihre IT-Infrastruktur integriert." },
							{ title: "Echtzeit-Analyse", desc: "Überstunden, Trends, Dashboards. Immer live, immer aktuell." },
						].map((f, i) => (
							<div
								key={i}
								className="group rounded-2xl p-7 transition-all duration-500 hover:translate-y-[-2px]"
								style={{
									background: "linear-gradient(145deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
									border: "1px solid rgba(255,255,255,0.05)",
								}}
							>
								<span className="mb-3 block text-[10px] tracking-[0.2em] text-[#404060]">
									0{i + 1}
								</span>
								<h3 className="mb-2 text-[16px] font-semibold transition-colors group-hover:text-white">
									{f.title}
								</h3>
								<p className="text-[13px] leading-[1.7] text-[#606080]">{f.desc}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Full image — cinematic */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-16">
				<div className="relative h-[40vh] overflow-hidden rounded-2xl">
					<Image
						src="https://images.unsplash.com/photo-1497366216548-37526070297c?w=1400&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: "saturate(0.2) brightness(0.3) contrast(1.3)" }}
					/>
					<div
						className="absolute inset-0"
						style={{
							background: "linear-gradient(135deg, rgba(10,10,16,0.6) 0%, rgba(10,10,16,0) 50%, rgba(10,10,16,0.4) 100%)",
						}}
					/>
					<div className="absolute bottom-8 left-8 lg:bottom-12 lg:left-12">
						<p className="text-[12px] text-[#606080]">Technologie-Stack</p>
						<p className="mt-1 text-[14px] font-medium text-[#808098]">
							Next.js 16 &middot; PostgreSQL &middot; Valkey &middot; Better Auth &middot; Drizzle &middot; BullMQ
						</p>
					</div>
				</div>
			</section>

			{/* Quote */}
			<section className="relative z-10 px-8 py-24 lg:px-16">
				<div className="mx-auto max-w-2xl text-center">
					<blockquote className="text-[clamp(1.5rem,3.5vw,2.5rem)] font-bold leading-[1.35] tracking-[-0.02em] text-[#808098]">
						Jenseits des Standards &mdash; dort beginnt echte Pr&auml;zision.
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-16">
				<div
					className="mx-auto max-w-3xl rounded-2xl p-12 text-center lg:p-16"
					style={{
						background: "linear-gradient(145deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
						border: "1px solid rgba(255,255,255,0.06)",
					}}
				>
					<h2 className="mb-4 text-3xl font-bold tracking-[-0.02em]">
						Bereit durchzustarten?
					</h2>
					<p className="mb-8 text-[14px] text-[#606080]">
						Erleben Sie Z8 Enterprise in einer pers&ouml;nlichen Demo.
					</p>
					<div className="flex items-center justify-center gap-3">
						<a
							href="mailto:hello@z8.app"
							className="rounded-full px-8 py-4 text-[14px] font-semibold text-[#0a0a10] transition-all hover:opacity-90"
							style={{ backgroundColor: "#e8e8f0" }}
						>
							Demo vereinbaren
						</a>
						<a
							href="mailto:hello@z8.app"
							className="rounded-full px-8 py-4 text-[14px] text-[#606080] transition-colors hover:text-white"
							style={{ border: "1px solid rgba(255,255,255,0.1)" }}
						>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-16" style={{ borderTop: "1px solid rgba(255,255,255,0.04)" }}>
				<div className="flex items-center justify-between text-[13px] text-[#303050]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-white">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
