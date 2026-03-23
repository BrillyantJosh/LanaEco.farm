import { useState } from "react";
import { Search } from "lucide-react";
import { farmers, allRegions } from "@/data/farmers";
import FarmerCard from "@/components/FarmerCard";

const FarmersPage = () => {
  const [search, setSearch] = useState("");
  const [selectedRegion, setSelectedRegion] = useState("");

  const filtered = farmers.filter((f) => {
    const matchesSearch =
      !search ||
      f.farmName.toLowerCase().includes(search.toLowerCase()) ||
      f.name.toLowerCase().includes(search.toLowerCase()) ||
      f.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()));
    const matchesRegion = !selectedRegion || f.region === selectedRegion;
    return matchesSearch && matchesRegion;
  });

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="font-display text-3xl md:text-4xl font-bold">Naši kmetje</h1>
      <p className="mt-2 text-muted-foreground font-sans">
        Raziščite lokalne ekološke pridelovalce po regijah
      </p>

      {/* Filters */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Išči po imenu ali izdelku..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={selectedRegion}
          onChange={(e) => setSelectedRegion(e.target.value)}
          className="px-4 py-2.5 rounded-lg border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">Vse regije</option>
          {allRegions.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>

      {/* Grid */}
      <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map((farmer) => (
          <FarmerCard key={farmer.id} farmer={farmer} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-12 text-center text-muted-foreground font-sans">
          Ni rezultatov. Poskusite z drugim iskanjem.
        </p>
      )}
    </div>
  );
};

export default FarmersPage;
