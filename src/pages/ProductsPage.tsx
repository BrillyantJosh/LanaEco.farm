import { useState } from "react";
import { Search } from "lucide-react";
import { farmers, allCategories } from "@/data/farmers";
import ProductCard from "@/components/ProductCard";

const ProductsPage = () => {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");

  const allProducts = farmers.flatMap((f) =>
    f.products.map((p) => ({ product: p, farmer: f }))
  );

  const filtered = allProducts.filter(({ product }) => {
    const matchesSearch =
      !search ||
      product.name.toLowerCase().includes(search.toLowerCase()) ||
      product.category.toLowerCase().includes(search.toLowerCase());
    const matchesCat =
      !selectedCategory || product.category === selectedCategory;
    return matchesSearch && matchesCat;
  });

  return (
    <div className="container mx-auto px-4 py-10">
      <h1 className="font-display text-3xl md:text-4xl font-bold">Products</h1>
      <p className="mt-2 text-muted-foreground font-sans">
        Explore organic products from our producers
      </p>

      {/* Filters */}
      <div className="mt-6 flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-lg border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={selectedCategory}
          onChange={(e) => setSelectedCategory(e.target.value)}
          className="px-4 py-2.5 rounded-lg border bg-card text-foreground font-sans text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <option value="">All categories</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Grid */}
      <div className="mt-8 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filtered.map(({ product, farmer }) => (
          <ProductCard key={product.id} product={product} farmer={farmer} />
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="mt-12 text-center text-muted-foreground font-sans">
          No results. Try a different search.
        </p>
      )}
    </div>
  );
};

export default ProductsPage;
