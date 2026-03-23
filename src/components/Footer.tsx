import { Leaf } from "lucide-react";

const Footer = () => (
  <footer className="bg-card border-t mt-16">
    <div className="container mx-auto px-4 py-10">
      <div className="flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Leaf className="h-5 w-5 text-primary" />
          <span className="font-display text-lg font-bold text-foreground">
            Eko Imenik
          </span>
        </div>
        <p className="text-sm text-muted-foreground font-sans text-center">
          Povezujemo lokalne ekološke pridelovalce s skupnostjo. Podprite lokalno! 🌱
        </p>
      </div>
    </div>
  </footer>
);

export default Footer;
