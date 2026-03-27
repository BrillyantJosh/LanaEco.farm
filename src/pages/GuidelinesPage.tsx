import {
  Leaf,
  Sprout,
  TreePine,
  Package,
  Users,
  Award,
} from "lucide-react";

const criteria = [
  {
    icon: <Leaf className="h-6 w-6 text-primary" />,
    title: "Locality",
    points: "up to 5 points",
    items: [
      "Production in local region",
      "Direct sales or short supply chains",
    ],
  },
  {
    icon: <Sprout className="h-6 w-6 text-primary" />,
    title: "Sustainable production",
    points: "up to 5 points",
    items: [
      "No pesticide use",
      "Organic production",
      "Soil fertility care",
    ],
  },
  {
    icon: <TreePine className="h-6 w-6 text-primary" />,
    title: "Biodiversity",
    points: "up to 5 points",
    items: [
      "Preserving heritage varieties",
      "Mixed crops",
      "Pollinator care",
    ],
  },
  {
    icon: <Package className="h-6 w-6 text-primary" />,
    title: "Packaging & transport",
    points: "up to 5 points",
    items: [
      "Minimal packaging",
      "Returnable packaging",
      "Sustainable transport",
    ],
  },
];

const practices = [
  "Local and seasonal production",
  "Reducing the use of harmful chemicals",
  "Caring for soil fertility and biodiversity",
  "Transparent communication about food origin",
  "Collaboration with local shops and restaurants",
];

const GuidelinesPage = () => (
  <div className="container mx-auto px-4 py-10">
    <div className="max-w-3xl mx-auto">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-center">
        Guidelines for producers
      </h1>
      <p className="mt-3 text-muted-foreground font-sans text-center max-w-xl mx-auto">
        Farmers participate in the system with a commitment to responsible and sustainable production.
      </p>

      {/* Practices */}
      <div className="mt-10 bg-card border rounded-lg p-6 md:p-8">
        <h2 className="font-display text-xl font-semibold flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          Recommended practices
        </h2>
        <ul className="mt-4 space-y-3">
          {practices.map((p) => (
            <li key={p} className="flex items-start gap-3 font-sans text-sm">
              <span className="mt-1 h-2 w-2 rounded-full bg-primary flex-shrink-0" />
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-6 bg-primary/10 rounded-lg p-4">
          <p className="text-sm font-sans text-foreground">
            <strong>Sustainability premium:</strong> By following these principles,
            producers can earn a sustainability premium of up to{" "}
            <span className="text-primary font-bold">20%</span> on their products
            (in Euros or Lana).
          </p>
        </div>
      </div>

      {/* Criteria */}
      <h2 className="font-display text-2xl font-semibold mt-12 mb-6 text-center">
        Scoring criteria
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
              {c.items.map((item) => (
                <li
                  key={item}
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

      {/* Community Role */}
      <div className="mt-8 bg-accent/10 border border-accent/20 rounded-lg p-6 md:p-8">
        <div className="flex items-center gap-3 mb-4">
          <Users className="h-6 w-6 text-accent" />
          <h2 className="font-display text-xl font-semibold text-accent">
            Community role
          </h2>
        </div>
        <p className="text-sm font-sans text-muted-foreground mb-3">
          To maintain the 20% sustainability premium, producers must actively
          participate in the community:
        </p>
        <ul className="space-y-2">
          {[
            "Collaboration with local restaurants",
            "Participation in community projects",
          ].map((item) => (
            <li
              key={item}
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

export default GuidelinesPage;
