import { Leaf, LogIn, Menu, X, ShieldCheck, ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageContext";
import type { TranslationKey } from "@/i18n/translations";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminHex } from "@/components/AdminProtectedRoute";
import { useCart } from "@/contexts/CartContext";
import { pluralForm } from "@/lib/format";

const navKeys = [
  { key: 'nav.home' as const, path: "/" },
  { key: 'nav.farms' as const, path: "/kmetje" },
  { key: 'nav.listings' as const, path: "/ponudbe" },
  { key: 'nav.guidelines' as const, path: "/smernice" },
  { key: 'nav.myOrders' as const, path: "/moja-narocila" },
];

/**
 * Cart icon with a badge = how many DIFFERENT products are in the cart (kg
 * and kos do not add up). In the bar itself on every width — never hidden
 * inside the mobile menu.
 */
export function CartButton({ className = '' }: { className?: string }) {
  const { t, locale } = useLanguage();
  const { count } = useCart();
  const location = useLocation();
  const active = location.pathname === '/kosarica' || location.pathname.startsWith('/kosarica/');
  const items = t(`cart.count.${pluralForm(locale, count)}` as TranslationKey, { count });
  return (
    <Link
      to="/kosarica"
      aria-label={t('cart.aria', { items })}
      aria-current={active ? 'page' : undefined}
      data-testid="header-cart"
      className={`relative inline-flex items-center justify-center rounded-lg p-2 transition-colors hover:text-primary ${active ? 'text-primary' : 'text-foreground'} ${className}`}
    >
      <ShoppingCart className="h-6 w-6" aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          data-testid="header-cart-count"
          className="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-primary px-1 text-center text-[11px] font-sans font-bold leading-5 text-primary-foreground"
        >
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

const Header = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { t } = useLanguage();
  const { session } = useAuth();
  const showAdmin = isAdminHex(session?.nostrHexId);

  return (
    <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b">
      <div className="container mx-auto flex items-center justify-between gap-2 py-4 px-4">
        {/* The name may shorten on a very small phone (320 px): the cart,
            language and menu buttons must always fit in the bar. */}
        <Link to="/" className="flex min-w-0 items-center gap-2">
          <Leaf className="h-6 w-6 min-[360px]:h-7 min-[360px]:w-7 shrink-0 text-primary" />
          <span className="truncate font-display text-base min-[360px]:text-xl font-bold text-foreground">
            {t('nav.brand')}
          </span>
        </Link>

        {/* Desktop nav (lg: "Moja naročila" and the cart need the room) */}
        <nav className="hidden lg:flex items-center gap-6">
          {navKeys.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`font-sans text-sm font-medium transition-colors hover:text-primary ${
                location.pathname === item.path ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {t(item.key)}
            </Link>
          ))}

          <CartButton />
          <LanguageSwitcher />

          {showAdmin && (
            <Link
              to="/admin"
              className="inline-flex items-center gap-1.5 font-sans text-sm font-medium px-3 py-2 rounded-lg border border-orange-300 text-orange-700 hover:bg-orange-50 transition-colors"
            >
              <ShieldCheck className="h-4 w-4" />
              Admin
            </Link>
          )}

          <a
            href="https://shop.lanapays.us/login"
            className="inline-flex items-center gap-1.5 font-sans text-sm font-medium px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            <LogIn className="h-4 w-4" />
            {t('nav.login')}
          </a>
        </nav>

        {/* Mobile toggle — the cart stays in the bar */}
        <div className="lg:hidden flex shrink-0 items-center gap-1 sm:gap-2">
          <CartButton />
          <LanguageSwitcher />
          <button className="text-foreground" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {menuOpen && (
        <nav className="lg:hidden bg-background border-b px-4 pb-4">
          {navKeys.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMenuOpen(false)}
              className={`block py-2 font-sans text-sm font-medium transition-colors hover:text-primary ${
                location.pathname === item.path ? "text-primary" : "text-muted-foreground"
              }`}
            >
              {t(item.key)}
            </Link>
          ))}
          <a
            href="https://shop.lanapays.us/login"
            onClick={() => setMenuOpen(false)}
            className="inline-flex items-center gap-1.5 mt-2 font-sans text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground"
          >
            <LogIn className="h-4 w-4" />
            {t('nav.login')}
          </a>
        </nav>
      )}
    </header>
  );
};

export default Header;
