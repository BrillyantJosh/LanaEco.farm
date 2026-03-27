import { Link } from 'react-router-dom';
import { MapPin, Leaf, ShoppingBag, Calendar, Users, Tag } from 'lucide-react';
import type { EcoListing } from '@/lib/nostr';
import { useLanguage } from '@/i18n/LanguageContext';

const TYPE_COLORS: Record<string, string> = {
  product: 'bg-primary/10 text-primary',
  subscription: 'bg-accent/10 text-accent',
  service: 'bg-blue-50 text-blue-700',
  experience: 'bg-purple-50 text-purple-700',
};

interface ListingCardProps {
  listing: EcoListing;
  showActions?: boolean;
  onEdit?: (listing: EcoListing) => void;
  onDelete?: (listing: EcoListing) => void;
  isDeleting?: boolean;
}

export function ListingCard({ listing, showActions, onEdit, onDelete, isDeleting }: ListingCardProps) {
  const { t } = useLanguage();

  const TYPE_LABELS: Record<string, string> = {
    product: t('type.product'),
    subscription: t('type.subscription'),
    service: t('type.service'),
    experience: t('type.experience'),
  };

  const mainImage = listing.images[0] || listing.thumbs[0];

  const card = (
    <div className="bg-card border rounded-xl overflow-hidden hover:shadow-md transition group">
      {/* Image */}
      {mainImage ? (
        <div className="aspect-[4/3] overflow-hidden bg-muted">
          <img
            src={mainImage}
            alt={listing.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="aspect-[4/3] bg-muted flex items-center justify-center">
          <ShoppingBag className="w-10 h-10 text-muted-foreground/30" />
        </div>
      )}

      <div className="p-4">
        {/* Type badge + price */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-sans font-medium ${TYPE_COLORS[listing.type] || 'bg-muted text-muted-foreground'}`}>
              {TYPE_LABELS[listing.type] || listing.type}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-sans font-bold bg-green-100 text-green-800">
              {(listing as any).cashbackPercent || 5}% cashback
            </span>
          </div>
          {listing.price && (
            <span className="text-sm font-semibold text-foreground font-sans">
              {listing.price} {listing.priceCurrency}
              {listing.unit && <span className="text-xs text-muted-foreground font-normal">/{listing.unit}</span>}
            </span>
          )}
        </div>

        {/* Title */}
        <h3 className="font-display text-base font-semibold text-foreground truncate mb-1">
          {listing.title}
        </h3>

        {/* Description snippet */}
        {listing.content && (
          <p className="text-xs text-muted-foreground font-sans line-clamp-2 mb-2">
            {listing.content}
          </p>
        )}

        {/* Eco badges */}
        {listing.eco.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {listing.eco.slice(0, 3).map(e => (
              <span key={e} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-green-50 text-green-700 rounded text-[10px] font-sans font-medium">
                <Leaf className="w-2.5 h-2.5" />
                {e.replace(/_/g, ' ')}
              </span>
            ))}
            {listing.eco.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{listing.eco.length - 3}</span>
            )}
          </div>
        )}

        {/* Category tags */}
        {listing.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {listing.tags.slice(0, 3).map(tg => (
              <span key={tg} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-muted text-muted-foreground rounded text-[10px] font-sans">
                <Tag className="w-2.5 h-2.5" />
                {tg}
              </span>
            ))}
          </div>
        )}

        {/* Season / availability */}
        {(listing.harvestSeason || listing.availableFrom) && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground font-sans mb-2">
            <Calendar className="w-3 h-3" />
            {listing.harvestSeason && <span>{listing.harvestSeason}</span>}
            {listing.availableFrom && listing.availableUntil && (
              <span>{listing.availableFrom} — {listing.availableUntil}</span>
            )}
          </div>
        )}

        {/* Stock */}
        {listing.stock && (
          <div className="text-[10px] text-muted-foreground font-sans">
            {t('common.inStock')} {listing.stock} {listing.unit}
          </div>
        )}

        {/* Actions (dashboard mode) */}
        {showActions && (
          <div className="flex gap-2 mt-3 pt-3 border-t">
            <button
              onClick={(e) => { e.preventDefault(); onEdit?.(listing); }}
              className="flex-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-sans font-medium hover:bg-primary/90 transition"
            >
              {t('common.edit')}
            </button>
            <button
              onClick={(e) => { e.preventDefault(); onDelete?.(listing); }}
              disabled={isDeleting}
              className="px-3 py-1.5 bg-destructive/10 text-destructive rounded-lg text-xs font-sans font-medium hover:bg-destructive/20 transition disabled:opacity-50"
            >
              {isDeleting ? '...' : t('common.delete')}
            </button>
          </div>
        )}
      </div>
    </div>
  );

  if (showActions) return card;

  return (
    <Link to={`/ponudba/${listing.pubkey}/${listing.listingId}`} className="block">
      {card}
    </Link>
  );
}
