import { Leaf, LogIn, LayoutDashboard, LogOut, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
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
  const navigate = useNavigate();
  const { session, logout } = useAuth();
  const { t } = useLanguage();

  const handleLogout = () => {
    logout();
    navigate("/");
    setMenuOpen(false);
  };

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

          {session ? (
            <>
              <Link
                to="/dashboard"
                className={`inline-flex items-center gap-1.5 font-sans text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                  location.pathname === "/dashboard"
                    ? "bg-primary text-primary-foreground"
                    : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
                }`}
              >
                <LayoutDashboard className="h-4 w-4" />
                {session.profileName || "Dashboard"}
              </Link>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-1.5 font-sans text-sm font-medium text-muted-foreground hover:text-destructive transition-colors"
              >
                <LogOut className="h-4 w-4" />
                {t('nav.logout')}
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className={`inline-flex items-center gap-1.5 font-sans text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
                location.pathname === "/login"
                  ? "bg-primary text-primary-foreground"
                  : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
              }`}
            >
              <LogIn className="h-4 w-4" />
              {t('nav.login')}
            </Link>
          )}
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
          {session ? (
            <>
              <Link to="/dashboard" onClick={() => setMenuOpen(false)}
                className="inline-flex items-center gap-1.5 mt-2 font-sans text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground">
                <LayoutDashboard className="h-4 w-4" />
                {session.profileName || "Dashboard"}
              </Link>
              <button onClick={handleLogout}
                className="block mt-2 font-sans text-sm font-medium text-muted-foreground hover:text-destructive transition-colors">
                <LogOut className="h-4 w-4 inline mr-1.5" />
                {t('nav.logout')}
              </button>
            </>
          ) : (
            <Link to="/login" onClick={() => setMenuOpen(false)}
              className="inline-flex items-center gap-1.5 mt-2 font-sans text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground">
              <LogIn className="h-4 w-4" />
              {t('nav.login')}
            </Link>
          )}
        </nav>
      )}
    </header>
  );
};

export default Header;
