import { Leaf, LogIn, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useLanguage } from "@/i18n/LanguageContext";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";

const navKeys = [
  { key: 'nav.home' as const, path: "/" },
  { key: 'nav.farms' as const, path: "/kmetje" },
  { key: 'nav.listings' as const, path: "/ponudbe" },
  { key: 'nav.guidelines' as const, path: "/smernice" },
];

const Header = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const { t } = useLanguage();

  return (
    <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b">
      <div className="container mx-auto flex items-center justify-between py-4 px-4">
        <Link to="/" className="flex items-center gap-2">
          <Leaf className="h-7 w-7 text-primary" />
          <span className="font-display text-xl font-bold text-foreground">
            {t('nav.brand')}
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-6">
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

          <LanguageSwitcher />

          <a
            href="https://shop.lanapays.us/login"
            className="inline-flex items-center gap-1.5 font-sans text-sm font-medium px-4 py-2 rounded-lg bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            <LogIn className="h-4 w-4" />
            {t('nav.login')}
          </a>
        </nav>

        {/* Mobile toggle */}
        <div className="md:hidden flex items-center gap-2">
          <LanguageSwitcher />
          <button className="text-foreground" onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {/* Mobile nav */}
      {menuOpen && (
        <nav className="md:hidden bg-background border-b px-4 pb-4">
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
