import { useParams, Link } from "react-router-dom";
import { ArrowLeft, MapPin, Sprout, Users } from "lucide-react";
import { farmers } from "@/data/farmers";
import ProductCard from "@/components/ProductCard";

const ScoreRow = ({ label, value }: { label: string; value: number }) => (
  <div className="flex items-center justify-between">
    <span className="text-sm text-muted-foreground font-sans">{label}</span>
    <div className="flex gap-1">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={`h-2 w-6 rounded-full ${
            i < value ? "bg-primary" : "bg-border"
          }`}
        />
      ))}
    </div>
  </div>
);

const FarmerDetailPage = () => {
  const { id } = useParams();
  const farmer = farmers.find((f) => f.id === id);

  if (!farmer) {
    return (
      <div className="container mx-auto px-4 py-20 text-center">
        <p className="text-muted-foreground font-sans">Farmer not found.</p>
        <Link to="/kmetje" className="text-primary font-sans mt-4 inline-block">
          ← Back to list
        </Link>
      </div>
    );
  }

  const totalScore =
    farmer.score.lokalnost +
    farmer.score.trajnostna +
    farmer.score.biodiverziteta +
    farmer.score.embalaza;

  return (
    <div className="container mx-auto px-4 py-10">
      <Link
        to="/kmetje"
        className="inline-flex items-center gap-1 text-muted-foreground hover:text-primary font-sans text-sm mb-6"
      >
        <ArrowLeft className="h-4 w-4" /> Back to all farmers
      </Link>

      <div className="grid lg:grid-cols-3 gap-8">
        {/* Info */}
        <div className="lg:col-span-2">
          <div className="flex items-start gap-4">
            <div className="text-5xl">{farmer.avatar}</div>
            <div>
              <h1 className="font-display text-3xl font-bold">{farmer.farmName}</h1>
              <p className="text-muted-foreground font-sans">{farmer.name}</p>
              <div className="flex items-center gap-1 mt-1 text-sm text-muted-foreground">
                <MapPin className="h-4 w-4" />
                {farmer.region}
              </div>
            </div>
          </div>
          <p className="mt-6 text-foreground font-sans leading-relaxed">
            {farmer.description}
          </p>

          <div className="flex flex-wrap gap-2 mt-4">
            {farmer.tags.map((tag) => (
              <span
                key={tag}
                className="bg-secondary text-secondary-foreground text-xs px-3 py-1 rounded-full"
              >
                {tag}
              </span>
            ))}
          </div>

          {/* Products */}
          <h2 className="font-display text-2xl font-semibold mt-10 mb-4">
            Products ({farmer.products.length})
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {farmer.products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                farmer={farmer}
              />
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <div className="bg-card border rounded-lg p-6">
            <div className="flex items-center gap-2 mb-4">
              <Sprout className="h-5 w-5 text-primary" />
              <h3 className="font-display text-lg font-semibold">
                Sustainability score
              </h3>
            </div>
            <div className="text-center mb-6">
              <span className="text-4xl font-bold text-primary font-sans">
                {totalScore}
              </span>
              <span className="text-muted-foreground text-lg">/20</span>
            </div>
            <div className="space-y-3">
              <ScoreRow label="Locality" value={farmer.score.lokalnost} />
              <ScoreRow label="Sustainable production" value={farmer.score.trajnostna} />
              <ScoreRow label="Biodiversity" value={farmer.score.biodiverziteta} />
              <ScoreRow label="Packaging & transport" value={farmer.score.embalaza} />
            </div>
          </div>

          {farmer.communityActive && (
            <div className="bg-accent/10 border border-accent/20 rounded-lg p-5">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-5 w-5 text-accent" />
                <h3 className="font-display text-base font-semibold text-accent">
                  Community active
                </h3>
              </div>
              <p className="text-sm text-muted-foreground font-sans">
                This producer actively collaborates with local restaurants and community projects, enabling a sustainability premium of up to 20%.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FarmerDetailPage;
