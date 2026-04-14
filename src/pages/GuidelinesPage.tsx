import {
  Leaf,
  Sprout,
  TreePine,
  Package,
  Users,
  Award,
} from "lucide-react";
import { useLanguage } from '@/i18n/LanguageContext';

function GuidelinesPage() {
  const { t } = useLanguage();

  const criteria = [
    {
      icon: <Leaf className="h-6 w-6 text-primary" />,
      title: t('guidelines.locality'),
      points: t('guidelines.localityPts'),
      items: [
        t('guidelines.localityItem1'),
        t('guidelines.localityItem2'),
      ],
    },
    {
      icon: <Sprout className="h-6 w-6 text-primary" />,
      title: t('guidelines.sustainable'),
      points: t('guidelines.sustainablePts'),
      items: [
        t('guidelines.sustainableItem1'),
        t('guidelines.sustainableItem2'),
        t('guidelines.sustainableItem3'),
      ],
    },
    {
      icon: <TreePine className="h-6 w-6 text-primary" />,
      title: t('guidelines.biodiversity'),
      points: t('guidelines.biodiversityPts'),
      items: [
        t('guidelines.biodiversityItem1'),
        t('guidelines.biodiversityItem2'),
        t('guidelines.biodiversityItem3'),
      ],
    },
    {
      icon: <Package className="h-6 w-6 text-primary" />,
      title: t('guidelines.packaging'),
      points: t('guidelines.packagingPts'),
      items: [
        t('guidelines.packagingItem1'),
        t('guidelines.packagingItem2'),
        t('guidelines.packagingItem3'),
      ],
    },
  ];

  const practices = [
    t('guidelines.practice1'),
    t('guidelines.practice2'),
    t('guidelines.practice3'),
    t('guidelines.practice4'),
    t('guidelines.practice5'),
  ];

  return (
    <div className="container mx-auto px-4 py-10">
      <div className="max-w-3xl mx-auto">
        <h1 className="font-display text-3xl md:text-4xl font-bold text-center">
          {t('guidelines.title')}
        </h1>
        <p className="mt-3 text-muted-foreground font-sans text-center max-w-xl mx-auto">
          {t('guidelines.subtitle')}
        </p>

        {/* Practices */}
        <div className="mt-10 bg-card border rounded-lg p-6 md:p-8">
          <h2 className="font-display text-xl font-semibold flex items-center gap-2">
            <Award className="h-5 w-5 text-primary" />
            {t('guidelines.practices')}
          </h2>
          <ul className="mt-4 space-y-3">
            {practices.map((p, i) => (
              <li key={i} className="flex items-start gap-3 font-sans text-sm">
                <span className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
                {p}
              </li>
            ))}
          </ul>
          <div className="mt-6 bg-primary/10 rounded-lg p-4">
            <p className="text-sm font-sans text-foreground">
              <strong>{t('guidelines.premiumText')}</strong>{" "}
              <span className="text-primary font-bold">20 %</span>{" "}
              {t('guidelines.premiumSuffix')}
            </p>
          </div>
        </div>

        {/* Criteria */}
        <h2 className="font-display text-2xl font-semibold mt-12 mb-6 text-center">
          {t('guidelines.criteriaTitle')}
        </h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {criteria.map((c) => (
            <div key={c.title} className="bg-card border rounded-lg p-6">
              <div className="flex items-center gap-3 mb-3">
                {c.icon}
                <div>
                  <h3 className="font-display text-base font-semibold">
                    {c.title}
                  </h3>
                  <span className="text-xs text-primary font-sans font-medium">
                    {c.points}
                  </span>
                </div>
              </div>
              <ul className="space-y-2">
                {c.items.map((item, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-sm text-muted-foreground font-sans"
                  >
                    <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary/50 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Path to Abundance */}
        <div className="mt-12 bg-primary/5 border border-primary/20 rounded-lg p-6 md:p-8">
          <h2 className="font-display text-2xl font-bold text-primary mb-4">
            {t('guidelines.abundanceTitle')}
          </h2>
          <div className="space-y-4 text-sm font-sans text-foreground leading-relaxed">
            <p>{t('guidelines.abundanceP1')}</p>
            <p>{t('guidelines.abundanceP2')}</p>
            <p className="font-medium italic text-primary">{t('guidelines.abundanceP3')}</p>
          </div>
        </div>

        {/* How it works */}
        <div className="mt-12 bg-card border rounded-lg p-6 md:p-8">
          <h2 className="font-display text-2xl font-bold mb-5">
            {t('guidelines.howTitle')}
          </h2>
          <ol className="space-y-4 text-sm font-sans text-foreground leading-relaxed list-decimal list-inside">
            <li>{t('guidelines.howStep1')}</li>
            <li>{t('guidelines.howStep2')}</li>
            <li>{t('guidelines.howStep3')}</li>
            <li>{t('guidelines.howStep4')}</li>
            <li>{t('guidelines.howStep5')}</li>
          </ol>
        </div>

        {/* Q&A combined */}
        <div className="mt-8 bg-card border rounded-lg p-6 md:p-8 space-y-6">
          <div>
            <h3 className="font-display text-lg font-semibold mb-2">{t('guidelines.premiumQTitle')}</h3>
            <p className="text-sm font-sans text-muted-foreground leading-relaxed">{t('guidelines.premiumQDesc')}</p>
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold mb-2">{t('guidelines.cashQTitle')}</h3>
            <p className="text-sm font-sans text-muted-foreground leading-relaxed">{t('guidelines.cashQDesc')}</p>
          </div>
          <div>
            <h3 className="font-display text-lg font-semibold mb-2">{t('guidelines.limitsTitle')}</h3>
            <p className="text-sm font-sans text-muted-foreground leading-relaxed">{t('guidelines.limitsP1')}</p>
            <p className="text-sm font-sans text-muted-foreground leading-relaxed mt-2 font-medium italic">{t('guidelines.limitsP2')}</p>
          </div>
        </div>

        {/* Trust */}
        <div className="mt-8 bg-primary/5 border border-primary/20 rounded-lg p-6 md:p-8">
          <h2 className="font-display text-xl font-bold text-primary mb-3">{t('guidelines.trustTitle')}</h2>
          <div className="space-y-3 text-sm font-sans text-foreground leading-relaxed">
            <p>{t('guidelines.trustP1')}</p>
            <p className="italic">{t('guidelines.trustP2')}</p>
          </div>
        </div>

        {/* Community Role */}
        <div className="mt-8 bg-accent/10 border border-accent/20 rounded-lg p-6 md:p-8">
          <div className="flex items-center gap-3 mb-4">
            <Users className="h-6 w-6 text-accent" />
            <h2 className="font-display text-xl font-semibold text-accent">
              {t('guidelines.communityRole')}
            </h2>
          </div>
          <p className="text-sm font-sans text-muted-foreground mb-3">
            {t('guidelines.communityDesc')}
          </p>
          <ul className="space-y-2">
            {[
              t('guidelines.communityItem1'),
              t('guidelines.communityItem2'),
              t('guidelines.communityItem3'),
            ].map((item, i) => (
              <li
                key={i}
                className="flex items-start gap-2 text-sm font-sans text-foreground"
              >
                <span className="mt-1.5 h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

export default GuidelinesPage;
