import { Leaf, ShieldCheck, AlertTriangle, Sparkles, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';

export default function AbundancePage() {
  const { t } = useLanguage();

  return (
    <div className="container mx-auto px-4 py-10">
      <div className="max-w-3xl mx-auto">
        {/* Hero */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-primary/10 mb-4">
            <Leaf className="w-8 h-8 text-primary" />
          </div>
          <h1 className="font-display text-3xl md:text-4xl font-bold text-foreground">
            {t('abundance.title')}
          </h1>
        </div>

        {/* What is it */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-6 md:p-8 mb-8">
          <h2 className="font-display text-2xl font-bold text-primary mb-4">
            {t('abundance.whatTitle')}
          </h2>
          <p className="text-sm font-sans text-foreground leading-relaxed">
            {t('abundance.whatDesc')}
          </p>
        </div>

        {/* How it works */}
        <div className="bg-card border rounded-lg p-6 md:p-8 mb-8">
          <h2 className="font-display text-2xl font-bold mb-4">
            {t('abundance.howTitle')}
          </h2>
          <p className="text-sm font-sans text-foreground leading-relaxed mb-4">
            {t('abundance.howP1')}
          </p>
          <ul className="space-y-3 text-sm font-sans text-foreground leading-relaxed">
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
              {t('abundance.howOpt1')}
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
              {t('abundance.howOpt2')}
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
              {t('abundance.howOpt3')}
            </li>
          </ul>
        </div>

        {/* In brief */}
        <div className="bg-card border rounded-lg p-6 md:p-8 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Sparkles className="w-6 h-6 text-primary" />
            <h2 className="font-display text-xl font-bold">{t('abundance.briefTitle')}</h2>
          </div>
          <p className="text-sm font-sans text-foreground leading-relaxed">
            {t('abundance.briefDesc')}
          </p>
        </div>

        {/* Self-responsibility */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-6 md:p-8 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <ShieldCheck className="w-6 h-6 text-primary" />
            <h2 className="font-display text-xl font-bold text-primary">{t('abundance.selfTitle')}</h2>
          </div>
          <div className="space-y-3 text-sm font-sans text-foreground leading-relaxed">
            <p>{t('abundance.selfDesc')}</p>
            <p className="italic">{t('abundance.selfP2')}</p>
          </div>
        </div>

        {/* Caution */}
        <div className="bg-accent/5 border border-accent/20 rounded-lg p-6 md:p-8 mb-8">
          <div className="flex items-center gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-accent" />
            <h2 className="font-display text-xl font-bold text-accent">{t('abundance.cautionTitle')}</h2>
          </div>
          <div className="space-y-3 text-sm font-sans text-foreground leading-relaxed">
            <p>{t('abundance.cautionP1')}</p>
            <p className="font-bold text-foreground">{t('abundance.cautionP2')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
