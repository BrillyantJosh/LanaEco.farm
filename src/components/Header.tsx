import { Leaf, LogIn, Menu, X } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";

const navItems = [
  { label: "Domov", path: "/" },
  { label: "Kmetje", path: "/kmetje" },
  { label: "Izdelki", path: "/izdelki" },
  { label: "Smernice", path: "/smernice" },
];

const Header = () => {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  return (
    <header className="sticky top-0 z-50 bg-background/90 backdrop-blur-md border-b">
      <div className="container mx-auto flex items-center justify-between py-4 px-4">
        <Link to="/" className="flex items-center gap-2">
          <Leaf className="h-7 w-7 text-primary" />
          <span className="font-display text-xl font-bold text-foreground">
            Eko Imenik
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={`font-sans text-sm font-medium transition-colors hover:text-primary ${
                location.pathname === item.path
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <Link
            to="/login"
            className={`inline-flex items-center gap-1.5 font-sans text-sm font-medium px-4 py-2 rounded-lg transition-colors ${
              location.pathname === "/login"
                ? "bg-primary text-primary-foreground"
                : "bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground"
            }`}
          >
            <LogIn className="h-4 w-4" />
            Prijava
          </Link>
        </nav>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-foreground"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {/* Mobile nav */}
      {menuOpen && (
        <nav className="md:hidden bg-background border-b px-4 pb-4">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => setMenuOpen(false)}
              className={`block py-2 font-sans text-sm font-medium transition-colors hover:text-primary ${
                location.pathname === item.path
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
          <Link
            to="/login"
            onClick={() => setMenuOpen(false)}
            className="inline-flex items-center gap-1.5 mt-2 font-sans text-sm font-medium px-4 py-2 rounded-lg bg-primary text-primary-foreground"
          >
            <LogIn className="h-4 w-4" />
            Prijava
          </Link>
        </nav>
      )}
    </header>
  );
};

export default Header;
