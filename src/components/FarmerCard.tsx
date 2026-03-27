import { MapPin, Sprout } from "lucide-react";
import { Link } from "react-router-dom";
import type { Farmer } from "@/data/farmers";

const ScoreBar = ({ value, max = 5 }: { value: number; max?: number }) => (
  <div className="flex gap-0.5">
    {Array.from({ length: max }).map((_, i) => (
      <div
        key={i}
        className={`h-1.5 w-4 rounded-full ${
          i < value ? "bg-primary" : "bg-border"
        }`}
      />
    ))}
  </div>
);

const FarmerCard = ({ farmer }: { farmer: Farmer }) => {
  const totalScore =
    farmer.score.lokalnost +
    farmer.score.trajnostna +
    farmer.score.biodiverziteta +
    farmer.score.embalaza;

  return (
    <Link
      to={`/kmetje/${farmer.id}`}
      className="group block bg-card rounded-lg border p-6 transition-all hover:shadow-lg hover:-translate-y-1"
    >
      <div className="flex items-start gap-4">
        <div className="text-4xl">{farmer.avatar}</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-lg font-semibold text-foreground group-hover:text-primary transition-colors">
            {farmer.farmName}
          </h3>
          <p className="text-sm text-muted-foreground font-sans">{farmer.name}</p>
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
            <MapPin className="h-3 w-3" />
            {farmer.region}
          </div>
        </div>
        <div className="flex items-center gap-1 bg-primary/10 text-primary px-2 py-1 rounded-full text-xs font-medium">
          <Sprout className="h-3 w-3" />
          {totalScore}/20
        </div>
      </div>

      <p className="mt-3 text-sm text-muted-foreground line-clamp-2 font-sans">
        {farmer.description}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Lokalnost</span>
          <ScoreBar value={farmer.score.lokalnost} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Trajnostnost</span>
          <ScoreBar value={farmer.score.trajnostna} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Biodiverziteta</span>
          <ScoreBar value={farmer.score.biodiverziteta} />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">Embalaža</span>
          <ScoreBar value={farmer.score.embalaza} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {farmer.tags.map((tag) => (
          <span
            key={tag}
            className="bg-secondary text-secondary-foreground text-xs px-2 py-0.5 rounded-full"
          >
            {tag}
          </span>
        ))}
        {farmer.communityActive && (
          <span className="bg-accent/10 text-accent text-xs px-2 py-0.5 rounded-full font-medium">
            Community active
          </span>
        )}
      </div>
    </Link>
  );
};

export default FarmerCard;
