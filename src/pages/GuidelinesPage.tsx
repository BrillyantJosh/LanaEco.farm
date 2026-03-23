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
    title: "Lokalnost",
    points: "do 5 točk",
    items: [
      "Pridelava v lokalni regiji",
      "Neposredna prodaja ali kratke dobavne verige",
    ],
  },
  {
    icon: <Sprout className="h-6 w-6 text-primary" />,
    title: "Trajnostna pridelava",
    points: "do 5 točk",
    items: [
      "Brez uporabe pesticidov",
      "Ekološka pridelava",
      "Skrb za rodovitnost tal",
    ],
  },
  {
    icon: <TreePine className="h-6 w-6 text-primary" />,
    title: "Biodiverziteta",
    points: "do 5 točk",
    items: [
      "Ohranjanje tradicionalnih sort",
      "Mešani posevki",
      "Skrb za opraševalce",
    ],
  },
  {
    icon: <Package className="h-6 w-6 text-primary" />,
    title: "Embalaža in transport",
    points: "do 5 točk",
    items: [
      "Minimalna embalaža",
      "Vračljiva embalaža",
      "Trajnostni transport",
    ],
  },
];

const practices = [
  "Lokalna in sezonska pridelava",
  "Zmanjševanje uporabe škodljivih kemičnih sredstev",
  "Skrb za rodovitnost tal in biotsko raznovrstnost",
  "Transparentna komunikacija o izvoru hrane",
  "Sodelovanje z lokalnimi trgovci in restavracijami",
];

const GuidelinesPage = () => (
  <div className="container mx-auto px-4 py-10">
    <div className="max-w-3xl mx-auto">
      <h1 className="font-display text-3xl md:text-4xl font-bold text-center">
        Smernice za pridelovalce
      </h1>
      <p className="mt-3 text-muted-foreground font-sans text-center max-w-xl mx-auto">
        Kmetje sodelujejo v sistemu z zavezo k odgovorni in trajnostni pridelavi.
      </p>

      {/* Practices */}
      <div className="mt-10 bg-card border rounded-lg p-6 md:p-8">
        <h2 className="font-display text-xl font-semibold flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          Priporočene prakse
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
            <strong>Trajnostni pribitek:</strong> Z upoštevanjem teh načel lahko
            pridelovalci pridobijo trajnostni pribitek do{" "}
            <span className="text-primary font-bold">20%</span> na svoje izdelke
            (v Evrih ali Lanah).
          </p>
        </div>
      </div>

      {/* Criteria */}
      <h2 className="font-display text-2xl font-semibold mt-12 mb-6 text-center">
        Kriteriji za ocenjevanje
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
            Vloga v skupnosti
          </h2>
        </div>
        <p className="text-sm font-sans text-muted-foreground mb-3">
          Za vzdrževanje 20% trajnostnega pribitka morajo pridelovalci aktivno
          sodelovati v skupnosti:
        </p>
        <ul className="space-y-2">
          {[
            "Sodelovanje z lokalnimi restavracijami",
            "Sodelovanje v skupnostnih projektih",
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
