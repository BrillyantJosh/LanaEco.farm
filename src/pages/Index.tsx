import { ArrowRight, Leaf, Sprout, TreePine } from "lucide-react";
import { Link } from "react-router-dom";
import heroImageWebp from "@/assets/hero-farm.webp";
import heroImageJpg from "@/assets/hero-farm.jpg";
import productsImageWebp from "@/assets/products-bg.webp";
import productsImageJpg from "@/assets/products-bg.jpg";
import { farmers } from "@/data/farmers";
import FarmerCard from "@/components/FarmerCard";

const Index = () => {
  const featuredFarmers = farmers.slice(0, 3);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <picture>
            <source srcSet={heroImageWebp} type="image/webp" />
            <img
              src={heroImageJpg}
              alt="Ekološka kmetija s svežo zelenjavo na Gorenjskem"
              className="w-full h-full object-cover"
              fetchPriority="high"
              width={1920}
              height={1080}
            />
          </picture>
          <div className="absolute inset-0 bg-foreground/60" />
        </div>
        <div className="relative container mx-auto px-4 py-28 md:py-40">
          <div className="max-w-2xl animate-fade-in-up">
            <div className="flex items-center gap-2 mb-4">
              <Leaf className="h-6 w-6 text-primary-foreground" />
              <span className="text-primary-foreground/80 font-sans text-sm tracking-wider uppercase">
                Imenik pridelovalcev
              </span>
            </div>
            <h1 className="font-display text-4xl md:text-6xl font-bold text-primary-foreground leading-tight">
              Od njive do vaše mize
            </h1>
            <p className="mt-4 text-lg text-primary-foreground/80 font-sans max-w-lg">
              Odkrijte lokalne ekološke kmete, njihove zgodbe in sveže pridelke.
              Podprite trajnostno kmetijstvo v vaši regiji.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <Link
                to="/kmetje"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-sans font-medium transition-transform hover:scale-105"
              >
                Razišči kmete <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/izdelki"
                className="inline-flex items-center gap-2 bg-primary-foreground/10 text-primary-foreground border border-primary-foreground/20 px-6 py-3 rounded-lg font-sans font-medium backdrop-blur-sm transition-transform hover:scale-105"
              >
                Prebrskaj izdelke
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="container mx-auto px-4 py-16">
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              icon: <Leaf className="h-8 w-8 text-primary" />,
              title: "Ekološka pridelava",
              desc: "Brez pesticidov in kemičnih gnojil – za zdravo hrano in čisto okolje.",
            },
            {
              icon: <Sprout className="h-8 w-8 text-primary" />,
              title: "Kratke dobavne verige",
              desc: "Neposredno od kmeta do vas – sveže, lokalno, pravično.",
            },
            {
              icon: <TreePine className="h-8 w-8 text-primary" />,
              title: "Biotska raznovrstnost",
              desc: "Ohranjanje starih sort, mešani posevki in skrb za opraševalce.",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="text-center p-6 rounded-lg bg-card border"
            >
              <div className="mx-auto w-fit mb-4">{item.icon}</div>
              <h3 className="font-display text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground font-sans">
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Featured Farmers */}
      <section className="container mx-auto px-4 pb-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="font-display text-3xl font-bold">Izbrani kmetje</h2>
            <p className="text-muted-foreground font-sans mt-1">
              Spoznajte nekatere naše pridelovalce
            </p>
          </div>
          <Link
            to="/kmetje"
            className="hidden md:inline-flex items-center gap-1 text-primary font-sans text-sm font-medium hover:underline"
          >
            Vsi kmetje <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="grid md:grid-cols-3 gap-6">
          {featuredFarmers.map((farmer) => (
            <FarmerCard key={farmer.id} farmer={farmer} />
          ))}
        </div>
        <div className="mt-6 md:hidden text-center">
          <Link
            to="/kmetje"
            className="inline-flex items-center gap-1 text-primary font-sans text-sm font-medium"
          >
            Vsi kmetje <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* Products CTA */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <picture>
            <source srcSet={productsImageWebp} type="image/webp" />
            <img
              src={productsImageJpg}
              alt="Sveži lokalni ekološki pridelki"
              className="w-full h-full object-cover"
              loading="lazy"
              width={1920}
              height={1080}
            />
          </picture>
          <div className="absolute inset-0 bg-foreground/70" />
        </div>
        <div className="relative container mx-auto px-4 py-20 text-center">
          <h2 className="font-display text-3xl md:text-4xl font-bold text-primary-foreground">
            Raziščite lokalne izdelke
          </h2>
          <p className="mt-3 text-primary-foreground/80 font-sans max-w-md mx-auto">
            Od svežega sadja in zelenjave do medu, olj in domačih predelanih
            izdelkov.
          </p>
          <Link
            to="/izdelki"
            className="mt-6 inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-sans font-medium transition-transform hover:scale-105"
          >
            Vsi izdelki <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Index;
