import { Leaf } from "lucide-react";
import { useLanguage } from "@/i18n/LanguageContext";

const Footer = () => {
  const { t } = useLanguage();

  return (
    <footer className="bg-card border-t mt-16">
      <div className="container mx-auto px-4 py-10">
        <div className="flex flex-col items-center gap-2">
          <div className="flex items-center gap-2">
            <Leaf className="h-5 w-5 text-primary" />
            <span className="font-display text-lg font-bold text-foreground">
              {t('nav.brand')}
            </span>
          </div>
          <p className="text-sm text-muted-foreground font-sans text-center">
            {t('footer.tagline')}
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
