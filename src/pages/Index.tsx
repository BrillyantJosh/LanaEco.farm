import { useState, useEffect } from "react";
import { ArrowRight, Leaf, Sprout, TreePine, MapPin, Loader2, ShoppingBag, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import heroImageWebp from "@/assets/hero-farm.webp";
import heroImageJpg from "@/assets/hero-farm.jpg";
import productsImageWebp from "@/assets/products-bg.webp";
import productsImageJpg from "@/assets/products-bg.jpg";

interface EcoListing {
  listingId: string;
  pubkey: string;
  title: string;
  type: string;
  price: string;
  priceCurrency: string;
  unit: string;
  content: string;
  images: string[];
  eco: string[];
  tags: string[];
}

interface EcoUnit {
  unitId: string;
  name: string;
  category: string;
  categoryDetail: string;
  country: string;
  receiverCity: string;
  images: string[];
  content: string;
  status: string;
}

const Index = () => {
  const [units, setUnits] = useState<EcoUnit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [listings, setListings] = useState<EcoListing[]>([]);
  const [listingsLoading, setListingsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/eco-units?category=Eco Farm,Eco Farming')
      .then(res => res.json())
      .then((data: EcoUnit[]) => {
        setUnits(data.filter(u => u.status === 'active'));
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));

    fetch('/api/listings')
      .then(res => res.json())
      .then((data: EcoListing[]) => {
        setListings(data.slice(0, 6));
        setListingsLoading(false);
      })
      .catch(() => setListingsLoading(false));
  }, []);

  const featured = units.slice(0, 6);

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
              <a
                href="#kmetje"
                className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-sans font-medium transition-transform hover:scale-105"
              >
                Razišči kmete <ArrowRight className="h-4 w-4" />
              </a>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 bg-primary-foreground/10 text-primary-foreground border border-primary-foreground/20 px-6 py-3 rounded-lg font-sans font-medium backdrop-blur-sm transition-transform hover:scale-105"
              >
                Prijava za kmete
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
            <div key={item.title} className="text-center p-6 rounded-lg bg-card border">
              <div className="mx-auto w-fit mb-4">{item.icon}</div>
              <h3 className="font-display text-lg font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground font-sans">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Eco Farming Units from Nostr */}
      <section id="kmetje" className="container mx-auto px-4 pb-16">
        <div className="flex items-end justify-between mb-8">
          <div>
            <h2 className="font-display text-3xl font-bold">Ekološke kmetije</h2>
            <p className="text-muted-foreground font-sans mt-1">
              Žive enote registrirane na Lana Eco Farm omrežju
            </p>
          </div>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-primary mr-2" />
            <span className="text-muted-foreground font-sans text-sm">Nalaganje iz relejev...</span>
          </div>
        )}

        {!isLoading && featured.length === 0 && (
          <div className="text-center py-16">
            <Leaf className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground font-sans">
              Še ni registriranih eko kmetij.
              <Link to="/login" className="text-primary ml-1 hover:underline">Registrirajte svojo!</Link>
            </p>
          </div>
        )}

        {!isLoading && featured.length > 0 && (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featured.map((unit) => (
              <Link
                key={unit.unitId}
                to={`/enota/${unit.unitId}`}
                className="group bg-card border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300"
              >
                <div className="aspect-[16/10] overflow-hidden bg-muted">
                  {unit.images[0] ? (
                    <img
                      src={unit.images[0]}
                      alt={unit.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Leaf className="w-12 h-12 text-muted-foreground/20" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <h3 className="font-display text-lg font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                    {unit.name}
                  </h3>
                  <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground font-sans">
                    {(unit.receiverCity || unit.country) && (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" />
                        {[unit.receiverCity, unit.country].filter(Boolean).join(', ')}
                      </span>
                    )}
                  </div>
                  {unit.content && (
                    <p className="mt-3 text-sm text-muted-foreground font-sans line-clamp-2">
                      {unit.content}
                    </p>
                  )}
                  <div className="mt-4 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2.5 py-1 rounded-full text-xs font-sans font-medium">
                      <Leaf className="w-3 h-3" />
                      {unit.category}
                    </span>
                    {unit.categoryDetail && (
                      <span className="text-xs text-muted-foreground font-sans">{unit.categoryDetail}</span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Latest Listings */}
      {!listingsLoading && listings.length > 0 && (
        <section className="container mx-auto px-4 py-16">
          <div className="flex items-end justify-between mb-8">
            <div>
              <h2 className="font-display text-3xl font-bold">Najnovejše ponudbe</h2>
              <p className="text-muted-foreground font-sans mt-1">Sveži izdelki, naročnine in doživetja</p>
            </div>
            <Link to="/ponudbe" className="hidden md:inline-flex items-center gap-1 text-primary font-sans text-sm font-medium hover:underline">
              Vse ponudbe <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {listings.map((listing) => (
              <Link
                key={`${listing.pubkey}-${listing.listingId}`}
                to={`/ponudba/${listing.pubkey}/${listing.listingId}`}
                className="group bg-card border rounded-xl overflow-hidden hover:shadow-lg transition-all duration-300"
              >
                <div className="aspect-[16/10] overflow-hidden bg-muted">
                  {listing.images[0] ? (
                    <img src={listing.images[0]} alt={listing.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <ShoppingBag className="w-10 h-10 text-muted-foreground/30" />
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-sans font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full capitalize">{listing.type}</span>
                    <span className="text-sm font-semibold font-sans">{listing.price} {listing.priceCurrency}/{listing.unit}</span>
                  </div>
                  <h3 className="font-display text-base font-semibold truncate">{listing.title}</h3>
                  {listing.content && (
                    <p className="text-xs text-muted-foreground font-sans mt-1 line-clamp-2">{listing.content}</p>
                  )}
                  {listing.eco.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {listing.eco.slice(0, 2).map(e => (
                        <span key={e} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[10px] font-sans">
                          <Leaf className="w-2.5 h-2.5" />{e.replace(/_/g, ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
          <div className="mt-6 md:hidden text-center">
            <Link to="/ponudbe" className="inline-flex items-center gap-1 text-primary font-sans text-sm font-medium">
              Vse ponudbe <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      )}

      {/* CTA */}
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
            Postanite del eko skupnosti
          </h2>
          <p className="mt-3 text-primary-foreground/80 font-sans max-w-md mx-auto">
            Registrirajte svojo kmetijo in dosezite nove stranke prek Lana Eco Farm omrežja.
          </p>
          <Link
            to="/login"
            className="mt-6 inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-sans font-medium transition-transform hover:scale-105"
          >
            Prijava <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
};

export default Index;
