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
    farmName: "Green Hill Farm",
    region: "Gorenjska",
    description: "An organic farm in the heart of Gorenjska, specializing in vegetables and herbs. For three generations we have been caring for soil fertility without the use of pesticides.",
    avatar: "🌿",
    score: { lokalnost: 5, trajnostna: 5, biodiverziteta: 4, embalaza: 4 },
    communityActive: true,
    products: [
      { id: "p1", name: "Organic tomatoes", category: "Vegetables", description: "Variety-rich tomatoes, grown without pesticides", price: "3.50", unit: "kg", seasonal: true, image: "🍅" },
      { id: "p2", name: "Fresh herbs", category: "Herbs", description: "Mix of fresh herbs: basil, parsley, chives", price: "2.00", unit: "bunch", seasonal: true, image: "🌿" },
      { id: "p3", name: "Homegrown potatoes", category: "Vegetables", description: "Traditional potato varieties", price: "1.80", unit: "kg", seasonal: false, image: "🥔" },
    ],
    tags: ["Vegetables", "Herbs", "Organic"],
  },
  {
    id: "2",
    name: "Marko Kovač",
    farmName: "Kovač Homestead",
    region: "Štajerska",
    description: "On our farm we grow fruit and process it into natural juices and jams. Our orchard includes heritage apple and pear varieties.",
    avatar: "🍎",
    score: { lokalnost: 4, trajnostna: 5, biodiverziteta: 5, embalaza: 3 },
    communityActive: true,
    products: [
      { id: "p4", name: "Apple juice", category: "Drinks", description: "100% natural apple juice with no added sugar", price: "4.50", unit: "liter", seasonal: false, image: "🧃" },
      { id: "p5", name: "Homemade jam", category: "Processed", description: "Mixed fruit jam, cooked the traditional way", price: "5.00", unit: "jar", seasonal: false, image: "🫙" },
      { id: "p6", name: "Organic apples", category: "Fruit", description: "Heritage apple varieties from our organic orchard", price: "2.50", unit: "kg", seasonal: true, image: "🍏" },
    ],
    tags: ["Fruit", "Drinks", "Processed"],
  },
  {
    id: "3",
    name: "Petra Zupančič",
    farmName: "Sunny Garden Farm",
    region: "Primorska",
    description: "The Mediterranean climate allows us to grow olives, beans and seasonal vegetables. All production is organic with our own composting.",
    avatar: "🫒",
    score: { lokalnost: 5, trajnostna: 4, biodiverziteta: 4, embalaza: 5 },
    communityActive: false,
    products: [
      { id: "p7", name: "Extra virgin olive oil", category: "Oils", description: "Cold-pressed olive oil from our own grove", price: "18.00", unit: "0.5l", seasonal: false, image: "🫒" },
      { id: "p8", name: "Dried beans", category: "Legumes", description: "Traditional coastal beans, sun-dried", price: "6.00", unit: "kg", seasonal: false, image: "🫘" },
    ],
    tags: ["Oils", "Legumes", "Mediterranean"],
  },
  {
    id: "4",
    name: "Janez Kranjc",
    farmName: "Kranjc Farm",
    region: "Dolenjska",
    description: "A family farm focused on beekeeping and honey production. We preserve the native Carniolan honey bee.",
    avatar: "🐝",
    score: { lokalnost: 5, trajnostna: 5, biodiverziteta: 5, embalaza: 4 },
    communityActive: true,
    products: [
      { id: "p9", name: "Wildflower honey", category: "Honey", description: "Polyfloral honey from organic meadows", price: "12.00", unit: "jar", seasonal: true, image: "🍯" },
      { id: "p10", name: "Propolis tincture", category: "Bee products", description: "Natural propolis tincture for immune support", price: "15.00", unit: "bottle", seasonal: false, image: "💧" },
    ],
    tags: ["Honey", "Bee products", "Organic"],
  },
  {
    id: "5",
    name: "Maja Horvat",
    farmName: "Pohorje Foothill Farm",
    region: "Koroška",
    description: "Livestock farming and dairy products from organic husbandry. Our cows graze on mountain pastures without the use of antibiotics.",
    avatar: "🧀",
    score: { lokalnost: 4, trajnostna: 4, biodiverziteta: 3, embalaza: 4 },
    communityActive: true,
    products: [
      { id: "p11", name: "Farmhouse cheese", category: "Dairy", description: "Hard cheese from free-range cow milk", price: "14.00", unit: "kg", seasonal: false, image: "🧀" },
      { id: "p12", name: "Fresh butter", category: "Dairy", description: "Hand-churned butter from organic milk", price: "8.00", unit: "250g", seasonal: false, image: "🧈" },
      { id: "p13", name: "Yogurt", category: "Dairy", description: "Natural yogurt with no additives", price: "3.00", unit: "0.5l", seasonal: false, image: "🥛" },
    ],
    tags: ["Dairy", "Livestock"],
  },
  {
    id: "6",
    name: "Tomaž Breznik",
    farmName: "Breznik Homestead",
    region: "Pomurje",
    description: "On the fertile Pomurje soil we grow grains, pumpkin seed oil and seasonal vegetables. All without chemical fertilizers.",
    avatar: "🌾",
    score: { lokalnost: 5, trajnostna: 5, biodiverziteta: 4, embalaza: 5 },
    communityActive: true,
    products: [
      { id: "p14", name: "Pumpkin seed oil", category: "Oils", description: "Cold-pressed Styrian pumpkin seed oil", price: "16.00", unit: "0.5l", seasonal: false, image: "🎃" },
      { id: "p15", name: "Wholegrain flour", category: "Grains", description: "Freshly milled flour from organic wheat", price: "3.50", unit: "kg", seasonal: false, image: "🌾" },
    ],
    tags: ["Oils", "Grains", "Organic"],
  },
];

export const allCategories = Array.from(
  new Set(farmers.flatMap((f) => f.products.map((p) => p.category)))
).sort();

export const allRegions = Array.from(
  new Set(farmers.map((f) => f.region))
).sort();
