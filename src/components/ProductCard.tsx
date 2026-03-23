import type { Product, Farmer } from "@/data/farmers";
import { Link } from "react-router-dom";

const ProductCard = ({
  product,
  farmer,
}: {
  product: Product;
  farmer: Farmer;
}) => (
  <div className="bg-card rounded-lg border p-5 transition-all hover:shadow-md">
    <div className="flex items-start gap-3">
      <div className="text-3xl">{product.image}</div>
      <div className="flex-1">
        <h3 className="font-display text-base font-semibold text-foreground">
          {product.name}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5 font-sans">
          {product.description}
        </p>
      </div>
    </div>
    <div className="mt-3 flex items-center justify-between">
      <div>
        <span className="text-lg font-semibold text-primary font-sans">
          €{product.price}
        </span>
        <span className="text-xs text-muted-foreground ml-1">/{product.unit}</span>
      </div>
      {product.seasonal && (
        <span className="text-xs bg-leaf/10 text-leaf px-2 py-0.5 rounded-full">
          Sezonsko
        </span>
      )}
    </div>
    <div className="mt-3 pt-3 border-t flex items-center gap-2">
      <span className="text-lg">{farmer.avatar}</span>
      <Link
        to={`/kmetje/${farmer.id}`}
        className="text-xs text-muted-foreground hover:text-primary transition-colors font-sans"
      >
        {farmer.farmName} · {farmer.region}
      </Link>
    </div>
  </div>
);

export default ProductCard;
