import Navbar from "../components/Navbar";
import Hero from "../components/Hero";
import HowItWorks from "../components/HowItWorks";
import MenuPreview from "../components/MenuPreview";
import HoursAbout from "../components/HoursAbout";
import Portals from "../components/Portals";
import Footer from "../components/Footer";

/** Public marketing homepage (no auth required). */
export default function HomePage() {
  return (
    <div className="min-h-screen bg-white font-sans text-neutral-900 antialiased">
      <Navbar />
      <main>
        <Hero />
        <HowItWorks />
        <MenuPreview />
        <HoursAbout />
        <Portals />
      </main>
      <Footer />
    </div>
  );
}
