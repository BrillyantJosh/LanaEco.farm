export interface Product {
  id: string;
  name: string;
  category: string;
  description: string;
  price: string;
  unit: string;
  seasonal: boolean;
  image: string;
}

export interface Farmer {
  id: string;
  name: string;
  farmName: string;
  region: string;
  description: string;
  avatar: string;
  score: {
    lokalnost: number;
    trajnostna: number;
    biodiverziteta: number;
    embalaza: number;
  };
  communityActive: boolean;
  products: Product[];
  tags: string[];
}

export const farmers: Farmer[] = [
  {
    id: "1",
    name: "Ana Novak",
    farmName: "Kmetija Zeleni hrib",
    region: "Gorenjska",
    description: "Ekološka kmetija v osrčju Gorenjske, specializirana za pridelavo zelenjave in zelišč. Že tri generacije skrbimo za rodovitnost tal brez uporabe pesticidov.",
    avatar: "🌿",
    score: { lokalnost: 5, trajnostna: 5, biodiverziteta: 4, embalaza: 4 },
    communityActive: true,
    products: [
      { id: "p1", name: "Ekološki paradižnik", category: "Zelenjava", description: "Sortno bogat paradižnik, pridelan brez pesticidov", price: "3.50", unit: "kg", seasonal: true, image: "🍅" },
      { id: "p2", name: "Sveža zelišča", category: "Zelišča", description: "Mešanica svežih zelišč: bazilika, peteršilj, drobnjak", price: "2.00", unit: "šopek", seasonal: true, image: "🌿" },
      { id: "p3", name: "Domači krompir", category: "Zelenjava", description: "Tradicionalne sorte krompirja", price: "1.80", unit: "kg", seasonal: false, image: "🥔" },
    ],
    tags: ["Zelenjava", "Zelišča", "Ekološko"],
  },
  {
    id: "2",
    name: "Marko Kovač",
    farmName: "Kovačeva domačija",
    region: "Štajerska",
    description: "Na naši kmetiji pridelujemo sadje in predelujemo v naravne sokove ter marmelade. Sadovnjak obsega stare sorte jabolk in hrušk.",
    avatar: "🍎",
    score: { lokalnost: 4, trajnostna: 5, biodiverziteta: 5, embalaza: 3 },
    communityActive: true,
    products: [
      { id: "p4", name: "Jabolčni sok", category: "Pijače", description: "100% naravni jabolčni sok brez dodanega sladkorja", price: "4.50", unit: "liter", seasonal: false, image: "🧃" },
      { id: "p5", name: "Domača marmelada", category: "Predelano", description: "Marmelada iz mešanega sadja, kuhana na tradicionalni način", price: "5.00", unit: "kozarec", seasonal: false, image: "🫙" },
      { id: "p6", name: "Ekološka jabolka", category: "Sadje", description: "Stare sorte jabolk iz ekološkega sadovnjaka", price: "2.50", unit: "kg", seasonal: true, image: "🍏" },
    ],
    tags: ["Sadje", "Pijače", "Predelano"],
  },
  {
    id: "3",
    name: "Petra Zupančič",
    farmName: "Kmetija Sončni vrt",
    region: "Primorska",
    description: "Sredozemsko podnebje nam omogoča pridelavo oljk, fižola in sezonske zelenjave. Vsa pridelava je ekološka z lastnim kompostiranjem.",
    avatar: "🫒",
    score: { lokalnost: 5, trajnostna: 4, biodiverziteta: 4, embalaza: 5 },
    communityActive: false,
    products: [
      { id: "p7", name: "Ekstra deviško olivno olje", category: "Olja", description: "Hladno stiskano olivno olje iz lastnega nasada", price: "18.00", unit: "0.5l", seasonal: false, image: "🫒" },
      { id: "p8", name: "Sušeni fižol", category: "Stročnice", description: "Tradicionalni primorski fižol, sušen na soncu", price: "6.00", unit: "kg", seasonal: false, image: "🫘" },
    ],
    tags: ["Olja", "Stročnice", "Sredozemsko"],
  },
  {
    id: "4",
    name: "Janez Kranjc",
    farmName: "Kranjčeva kmetija",
    region: "Dolenjska",
    description: "Družinska kmetija s poudarkom na čebelarstvu in pridelavi medu ter čebeljih izdelkov. Ohranjamo avtohtono kranjsko čebelo.",
    avatar: "🐝",
    score: { lokalnost: 5, trajnostna: 5, biodiverziteta: 5, embalaza: 4 },
    communityActive: true,
    products: [
      { id: "p9", name: "Cvetlični med", category: "Med", description: "Poliflora med iz ekoloških travnikov", price: "12.00", unit: "kozarec", seasonal: true, image: "🍯" },
      { id: "p10", name: "Propolis tinktura", category: "Čebelji izdelki", description: "Naravna propolisova tinktura za krepitev imunskega sistema", price: "15.00", unit: "steklenička", seasonal: false, image: "💧" },
    ],
    tags: ["Med", "Čebelji izdelki", "Ekološko"],
  },
  {
    id: "5",
    name: "Maja Horvat",
    farmName: "Kmetija pod Pohorjem",
    region: "Koroška",
    description: "Živinoreja in mlečni izdelki iz ekološke reje. Naše krave se pasejo na gorskih pašnikih brez uporabe antibiotikov.",
    avatar: "🧀",
    score: { lokalnost: 4, trajnostna: 4, biodiverziteta: 3, embalaza: 4 },
    communityActive: true,
    products: [
      { id: "p11", name: "Domači sir", category: "Mlečni izdelki", description: "Trdi sir iz mleka krav s prostega pašništva", price: "14.00", unit: "kg", seasonal: false, image: "🧀" },
      { id: "p12", name: "Sveže maslo", category: "Mlečni izdelki", description: "Ročno stepeno maslo iz ekološkega mleka", price: "8.00", unit: "250g", seasonal: false, image: "🧈" },
      { id: "p13", name: "Jogurt", category: "Mlečni izdelki", description: "Naravni jogurt brez dodatkov", price: "3.00", unit: "0.5l", seasonal: false, image: "🥛" },
    ],
    tags: ["Mlečni izdelki", "Živinoreja"],
  },
  {
    id: "6",
    name: "Tomaž Breznik",
    farmName: "Breznikova domačija",
    region: "Pomurje",
    description: "Na rodovitni pomurski zemlji pridelujemo žita, bučno olje in sezonsko zelenjavo. Vse brez uporabe kemičnih gnojil.",
    avatar: "🌾",
    score: { lokalnost: 5, trajnostna: 5, biodiverziteta: 4, embalaza: 5 },
    communityActive: true,
    products: [
      { id: "p14", name: "Bučno olje", category: "Olja", description: "Hladno stiskano štajersko bučno olje", price: "16.00", unit: "0.5l", seasonal: false, image: "🎃" },
      { id: "p15", name: "Polnozrnata moka", category: "Žita", description: "Sveže mleta moka iz ekološke pšenice", price: "3.50", unit: "kg", seasonal: false, image: "🌾" },
    ],
    tags: ["Olja", "Žita", "Ekološko"],
  },
];

export const allCategories = Array.from(
  new Set(farmers.flatMap((f) => f.products.map((p) => p.category)))
).sort();

export const allRegions = Array.from(
  new Set(farmers.map((f) => f.region))
).sort();
