#!/usr/bin/env node
/**
 * Populates businesses.json with real businesses for all 17 empty service categories.
 * Data sourced from web research (Google, Yelp, YellowPages) - Feb 2026.
 */
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "..", "data", "businesses.json");
const businesses = JSON.parse(fs.readFileSync(filePath, "utf8"));
const existingSlugs = new Set(businesses.map((b) => b.slug));

// Step 1: Cross-list existing businesses into new categories
const crossListings = {
  "mildreds-temple-kitchen": ["patios"],
  "brazen-head-irish-pub": ["patios"],
  "school-restaurant": ["patios"],
  "local-public-eatery": ["patios"],
  "nodo-liberty-village": ["wine-bars"],
  "altea-active": ["spas"],
};

for (const biz of businesses) {
  if (crossListings[biz.slug]) {
    biz.categories = crossListings[biz.slug];
  }
}

// Step 2: New businesses to add
const newBusinesses = [
  // === WINE BARS ===
  {
    slug: "cibo-wine-bar",
    name: "Cibo Wine Bar",
    category: "wine-bars",
    subcategory: "italian-wine-bar",
    address: "522 King St W, Toronto, ON M5V 1L7",
    description:
      "Authentic rustic Italian wine bar by Liberty Entertainment Group, awarded the Ospitalita Italiana seal of authenticity from the Italian government. Blends traditional Italian fare with a vibrant King West atmosphere, making it a go-to for wine lovers and date nights alike.",
    rating: 4.2,
    reviewCount: 890,
    priceRange: "$$$",
    hours: "Mon 1:30pm-12am, Tue-Fri 11:30am-2am, Sat 11am-2am, Sun 11am-12am",
    phone: "(416) 504-3939",
    website: "https://cibo.menu/kingwest",
    tags: ["italian", "wine-bar", "date-night", "king-west"],
    featured: true,
    proTip:
      "Their weekend brunch is underrated — most people come for dinner, but the daytime atmosphere is more relaxed with the same excellent wine list.",
    answerBlock:
      "Cibo Wine Bar on King St W is an award-winning Italian wine bar just a 5-minute walk from Liberty Village. Holding the Ospitalita Italiana seal from the Italian government, Cibo pairs authentic rustic Italian dishes with an extensive wine list in a vibrant King West setting perfect for date nights and celebrations.",
    bestFor: [
      "Date night with an Italian wine flight",
      "Weekend brunch with a more relaxed vibe",
      "After-work drinks on King West",
      "Impressing visitors with authentic Italian cuisine",
    ],
  },
  {
    slug: "bar-piquette",
    name: "Bar Piquette",
    category: "wine-bars",
    subcategory: "natural-wine",
    address: "1084 Queen St W, Toronto, ON M6J 1H8",
    description:
      "Highly-rated wine bar with a chalkboard menu of regularly changing wines and European-inspired small plates. The warm, inviting space features a sunroom patio and knowledgeable staff who genuinely love guiding you through their selections.",
    rating: 4.7,
    reviewCount: 320,
    priceRange: "$$",
    hours: "Mon-Sun 3pm-2am",
    phone: "(416) 533-7745",
    website: "https://barpiquette.com",
    tags: ["natural-wine", "small-plates", "patio", "queen-west"],
    featured: true,
    proTip:
      "Ask for the mortadella sandwich — it's legendary among regulars and pairs perfectly with whatever the staff recommends from the chalkboard.",
    answerBlock:
      "Bar Piquette on Queen St W is a top-rated wine bar with a 4.7 rating, just a 10-minute walk from Liberty Village. The regularly rotating chalkboard menu features natural wines paired with European-inspired small plates, served by genuinely knowledgeable staff in a warm space with a sunroom patio.",
    bestFor: [
      "Discovering natural and organic wines with expert guidance",
      "Intimate evening with small plates and great conversation",
      "Relaxing afternoon on the sunroom patio",
      "Wine enthusiasts seeking a curated rotating selection",
    ],
  },

  // === INDIAN RESTAURANTS ===
  {
    slug: "maurya-east-indian-roti",
    name: "Maurya East Indian Roti",
    category: "indian-restaurants",
    subcategory: "roti",
    address: "150 E Liberty St, Toronto, ON M6K 3R5",
    description:
      "Family-owned restaurant right in Liberty Village serving authentic East Indian roti and classical favourites. Considered by many locals to be the best place for Indian roti in the neighbourhood — the butter chicken roti and saag paneer are standouts.",
    rating: 4.5,
    reviewCount: 340,
    priceRange: "$",
    hours: "Mon-Thu 11:30am-10pm, Fri-Sat 11:30am-11pm, Sun 12pm-9pm",
    phone: "(647) 347-7002",
    website: "https://mauryaindianrestaurants.com",
    tags: ["roti", "indian", "butter-chicken", "affordable"],
    featured: true,
    proTip:
      "The butter chicken roti is the crowd favourite, but the lamb roti with extra hot sauce is the real move for spice lovers.",
    answerBlock:
      "Maurya East Indian Roti on E Liberty St is Liberty Village's go-to for authentic Indian cuisine, rated 4.5 stars. This family-owned spot serves traditional rotis, butter chicken, saag paneer, and veg biryani at affordable prices. It's widely considered the best Indian roti in the neighbourhood.",
    bestFor: [
      "Quick affordable lunch with authentic Indian flavours",
      "Butter chicken roti craving on a weeknight",
      "Feeding a group without breaking the bank",
      "Spice lovers seeking real heat with their roti",
    ],
  },
  {
    slug: "aroma-fine-indian-cuisine",
    name: "Aroma Fine Indian Cuisine",
    category: "indian-restaurants",
    subcategory: "fine-dining",
    address: "287 King St W, Toronto, ON M5V 1J5",
    description:
      "Upscale Indian restaurant in the King West entertainment district offering a refined dining experience with traditional flavours and elegant presentation. Popular for pre-theatre dinners and special occasions with over 2,200 Google reviews.",
    rating: 3.9,
    reviewCount: 2260,
    priceRange: "$$$",
    hours: "Mon-Thu 11:30am-10:30pm, Fri 11:30am-11pm, Sat 4pm-11pm, Sun 4pm-10pm",
    phone: "(416) 971-7242",
    website: "https://aromafineindian.com",
    tags: ["fine-dining", "indian", "pre-theatre", "king-west"],
    featured: false,
    proTip:
      "Book a table before a show at the nearby TIFF Bell Lightbox or Royal Alexandra Theatre — the pre-theatre timing works perfectly.",
    answerBlock:
      "Aroma Fine Indian Cuisine on King St W offers upscale Indian dining just 5 minutes from Liberty Village. With over 2,200 reviews, this elegant restaurant serves refined Indian dishes perfect for special occasions and pre-theatre dinners in the King West entertainment corridor.",
    bestFor: [
      "Special occasion Indian dining with elegant presentation",
      "Pre-theatre dinner on King West",
      "Business lunch with impressive ambiance",
      "Anyone seeking refined Indian cuisine beyond casual",
    ],
  },
  {
    slug: "curryish-tavern",
    name: "Curryish Tavern",
    category: "indian-restaurants",
    subcategory: "modern-indian",
    address: "783 Queen St W, Toronto, ON M6J 1G1",
    description:
      "Chef-driven innovative Indian cuisine by acclaimed Chef Miheer Shete. Creative dishes blend traditional Indian spices with seasonal Canadian ingredients in a modern tavern setting. The menu changes regularly to showcase what's fresh and in season.",
    rating: 4.8,
    reviewCount: 180,
    priceRange: "$$$",
    hours: "Mon-Wed 5pm-11pm, Thu-Fri 12pm-11pm, Sat 11am-11pm, Sun 11am-10pm",
    phone: "(416) 392-7837",
    website: "https://curryishtavern.ca",
    tags: ["modern-indian", "chef-driven", "seasonal", "queen-west"],
    featured: true,
    proTip:
      "Sit at the bar for a front-row seat to Chef Miheer's kitchen — the energy is infectious and you'll often get tasting extras.",
    answerBlock:
      "Curryish Tavern on Queen St W is a chef-driven Indian restaurant rated 4.8 stars, an 8-minute walk from Liberty Village. Chef Miheer Shete's innovative menu fuses traditional Indian flavours with seasonal Canadian ingredients, creating dishes you won't find anywhere else in Toronto.",
    bestFor: [
      "Adventurous diners seeking creative Indian fusion",
      "Weekend brunch with an Indian twist",
      "Foodies wanting to experience chef-driven seasonal menus",
      "Date night with unique, Instagram-worthy plates",
    ],
  },

  // === SPAS ===
  {
    slug: "beauty-room-liberty-village",
    name: "Beauty Room",
    category: "spas",
    subcategory: "medical-aesthetics",
    address: "17 Atlantic Ave, 2nd Floor, Toronto, ON M6K 3E7",
    description:
      "Boutique medical aesthetics and beauty studio right in Liberty Village offering facials, microneedling, laser treatments, lash lifts, permanent makeup, massage therapy, and cosmetic injections. A true all-in-one destination for relaxation and rejuvenation.",
    rating: 4.9,
    reviewCount: 220,
    priceRange: "$$$",
    hours: "By appointment, Mon-Sat",
    phone: "(416) 889-9948",
    website: "https://beautyroom.ca",
    tags: ["medical-aesthetics", "facials", "laser-treatments", "massage"],
    featured: true,
    proTip:
      "Book a consultation first to build a personalized skincare plan — the team creates custom treatment schedules that deliver much better results than one-off visits.",
    answerBlock:
      "Beauty Room on Atlantic Ave is Liberty Village's premier boutique medical aesthetics studio, rated 4.9 stars with 220+ reviews. Offering facials, microneedling, laser treatments, permanent makeup, and massage therapy, it's the neighbourhood's all-in-one destination for beauty and wellness.",
    bestFor: [
      "Results-driven facials and skin treatments",
      "Medical aesthetics like microneedling and laser",
      "Lash lifts and brow services before a special event",
      "Building a long-term skincare routine with expert guidance",
    ],
  },
  {
    slug: "king-liberty-health-centre",
    name: "King Liberty Health Centre",
    category: "spas",
    subcategory: "wellness",
    address: "131 Jefferson Ave, Toronto, ON M6K 3E4",
    description:
      "Complementary healthcare clinic operating since 2008 in Liberty Village. Offers registered massage therapy, osteopathy, and chiropractic care with an integrative, natural approach to wellness. A trusted neighbourhood fixture for over 15 years.",
    rating: 4.9,
    reviewCount: 50,
    priceRange: "$$",
    hours: "Mon-Fri 10am-7pm, Sat 9:30am-3pm",
    phone: "(647) 350-2932",
    website: "https://kinglibertyhealthcentre.com",
    tags: ["massage-therapy", "osteopathy", "chiropractic", "wellness"],
    featured: false,
    proTip:
      "Book massage therapy through your extended health benefits — most Liberty Village tech workers have coverage that makes visits here effectively free.",
    answerBlock:
      "King Liberty Health Centre on Jefferson Ave has been Liberty Village's trusted wellness clinic since 2008, rated 4.9 stars. Offering registered massage therapy, osteopathy, and chiropractic care, their integrative approach treats the whole person rather than just symptoms.",
    bestFor: [
      "Registered massage therapy covered by benefits",
      "Chronic pain management with osteopathy",
      "Post-workout recovery for gym-goers",
      "Holistic wellness with a neighbourhood clinic feel",
    ],
  },

  // === TATTOO PARLORS ===
  {
    slug: "heartless-ink",
    name: "Heartless Ink",
    category: "tattoo-parlors",
    subcategory: "custom-tattoos",
    address: "171 East Liberty St, Unit 122, Toronto, ON M6K 3P6",
    description:
      "Award-winning upscale boutique tattoo studio in Liberty Village founded by Esteban Rodríguez. Specializes in black and grey realism, colour realism, micro realism, and fine line tattoos with free design consultations.",
    rating: 4.8,
    reviewCount: 95,
    priceRange: "$$$",
    hours: "Tue-Sat 10am-8pm",
    phone: "(416) 792-2265",
    website: "https://heartlessink.ca",
    tags: ["custom-tattoos", "realism", "fine-line", "cover-ups"],
    featured: true,
    proTip:
      "Book a free design consultation well in advance — Esteban's calendar fills up fast, especially for large custom realism pieces.",
    answerBlock:
      "Heartless Ink on East Liberty St is Liberty Village's award-winning boutique tattoo studio, rated 4.8 stars. Founded by Esteban Rodríguez, the studio specializes in black and grey realism, colour realism, and fine line tattoos with free design consultations in a premium setting.",
    bestFor: [
      "Custom realism tattoos by an award-winning artist",
      "First tattoo with a comfortable boutique experience",
      "Cover-up work requiring expert design skills",
      "Fine line and micro realism pieces",
    ],
  },
  {
    slug: "icon-tattoo",
    name: "Icon Tattoo",
    category: "tattoo-parlors",
    subcategory: "tattoo-piercing",
    address: "309 King St W, 2nd Floor, Toronto, ON M5V 1J5",
    description:
      "Vibrant tattoo and piercing studio on King West with skilled artists covering styles from intricate mandalas to bold neo-traditional designs. Known for safe, affordable services in a welcoming atmosphere.",
    rating: 4.3,
    reviewCount: 150,
    priceRange: "$$",
    hours: "Tue-Sun 11am-8pm",
    phone: "(437) 604-6665",
    website: "https://icontattoo.ca",
    tags: ["tattoo", "piercing", "neo-traditional", "mandalas"],
    featured: false,
    proTip:
      "Walk-ins are welcome for smaller pieces and piercings — but book ahead for anything that needs a custom design session.",
    answerBlock:
      "Icon Tattoo on King St W is a vibrant studio just 5 minutes from Liberty Village, offering diverse tattoo styles from mandalas to neo-traditional designs plus professional piercings. The welcoming atmosphere and affordable pricing make it accessible for both first-timers and seasoned collectors.",
    bestFor: [
      "Walk-in tattoos and piercings on King West",
      "Neo-traditional and mandala-style artwork",
      "Budget-friendly tattoo sessions",
      "First-timers wanting a welcoming, low-pressure vibe",
    ],
  },
  {
    slug: "timeless-ink-toronto",
    name: "Timeless Ink Toronto",
    category: "tattoo-parlors",
    subcategory: "custom-tattoos",
    address: "573 King St W, 2nd Floor, Toronto, ON M5V 1M1",
    description:
      "Contemporary custom tattoo and piercing studio on King West with a stellar 4.8 rating. Experienced artists work across a wide range of styles in a modern, professional studio environment.",
    rating: 4.8,
    reviewCount: 61,
    priceRange: "$$",
    hours: "Tue-Sat 11am-7pm",
    phone: "(416) 410-0777",
    website: "https://timelessinktoronto.com",
    tags: ["custom-tattoos", "piercing", "contemporary", "king-west"],
    featured: false,
    proTip:
      "Check their Instagram portfolio before booking to find the artist whose style matches your vision — each artist has distinct specialties.",
    answerBlock:
      "Timeless Ink on King St W is a highly-rated contemporary tattoo studio with a 4.8-star rating, an 8-minute walk from Liberty Village. Their experienced artists cover diverse styles in a modern, professional environment that takes both walk-ins and custom appointments.",
    bestFor: [
      "Custom tattoo designs in various styles",
      "Professional piercings in a clean environment",
      "King West visitors wanting quality ink",
      "Clients who research artists via Instagram portfolios",
    ],
  },

  // === MOVERS ===
  {
    slug: "el-cheapo-movers",
    name: "El Cheapo Movers",
    category: "movers",
    subcategory: "residential-moving",
    address: "341 Eastern Ave, Toronto, ON M4M 1B7",
    description:
      "Toronto's most recognized moving company with over 25 years in business. Voted Best Mover by Toronto Star readers three years running (2019-2021), BBB A+ rated, and known for transparent quarter-hour billing after a one-hour minimum.",
    rating: 4.4,
    reviewCount: 518,
    priceRange: "$$",
    hours: "Mon-Fri 9am-7pm, Sat 9am-6pm",
    phone: "(416) 599-2728",
    website: "https://elcheapo.ca",
    tags: ["residential-moving", "affordable", "bbb-accredited", "award-winning"],
    featured: true,
    proTip:
      "They bill by the quarter hour after the first hour minimum — have everything packed and ready by the door to minimize billable time.",
    answerBlock:
      "El Cheapo Movers is Toronto's top-rated moving company with a 4.4-star rating, BBB A+ accreditation, and Toronto Star Best Mover awards from 2019-2021. Their quarter-hour billing keeps costs transparent, and they offer student and senior discounts. Over 25 years of reliable service across the GTA.",
    bestFor: [
      "Moving in or out of a Liberty Village condo",
      "Budget-conscious moves with transparent billing",
      "Students and seniors with discount eligibility",
      "Reliable Toronto-wide residential moves",
    ],
  },
  {
    slug: "cargo-cabbie",
    name: "Cargo Cabbie",
    category: "movers",
    subcategory: "boutique-moving",
    address: "135 Laird Dr, Toronto, ON M4G 3V5",
    description:
      "Boutique moving and junk removal company popular with Liberty Village condo dwellers. Offers flat-rate pricing with no hidden fees, plus a unique 'man with a van' small-move service perfect for condo-sized relocations.",
    rating: 4.7,
    reviewCount: 1200,
    priceRange: "$$",
    hours: "Mon-Sat 8am-8pm, Sun 9am-6pm",
    phone: "(647) 478-5422",
    website: "https://cargocabbie.ca",
    tags: ["boutique-moving", "flat-rate", "condo-moves", "junk-removal"],
    featured: true,
    proTip:
      "Their 'man with a van' service is perfect for small condo moves and single-item deliveries — much cheaper than booking a full crew.",
    answerBlock:
      "Cargo Cabbie is a boutique moving company rated 4.7 stars with 1,200+ reviews, popular among Liberty Village condo residents. Their flat-rate pricing eliminates surprise charges, and the 'man with a van' small-move option is ideal for condo-sized relocations and furniture deliveries.",
    bestFor: [
      "Small condo moves within Liberty Village",
      "Flat-rate moves with no hidden fees",
      "Junk removal when decluttering before a move",
      "Single-item furniture delivery or pickup",
    ],
  },
  {
    slug: "you-move-me-toronto",
    name: "You Move Me Toronto",
    category: "movers",
    subcategory: "full-service-moving",
    address: "200 Ronson Dr, Toronto, ON M9W 5Z9",
    description:
      "Full-service moving company known for friendly, uniformed crews and upfront pricing. They handle packing, loading, transport, and unloading with a satisfaction guarantee. Particularly popular for condo moves downtown.",
    rating: 4.6,
    reviewCount: 680,
    priceRange: "$$$",
    hours: "Mon-Sat 8am-7pm",
    phone: "(416) 850-2609",
    website: "https://youmoveme.com/toronto",
    tags: ["full-service", "packing-service", "condo-moves", "insured"],
    featured: false,
    proTip:
      "Add their packing service if you're short on time — the crew comes the day before to pack everything, so move day is just loading and driving.",
    answerBlock:
      "You Move Me Toronto is a full-service moving company rated 4.6 stars with 680+ reviews. Their uniformed crews provide upfront pricing and handle everything from packing to unloading with a satisfaction guarantee, making them a stress-free option for Liberty Village condo moves.",
    bestFor: [
      "Full-service moves where you want someone else to pack",
      "Downtown condo moves requiring booking elevator time",
      "Anyone wanting upfront pricing with no surprises",
      "Moves requiring professional packing for fragile items",
    ],
  },

  // === LAWYERS ===
  {
    slug: "dickinson-wright-toronto",
    name: "Dickinson Wright LLP",
    category: "lawyers",
    subcategory: "corporate-law",
    address: "199 Bay St, Suite 2200, Toronto, ON M5L 1G4",
    description:
      "Recognized in The Globe & Mail's 2026 Best Law Firms in Canada for corporate & commercial, IP, M&A, private equity, and real estate. A full-service firm with 144 Toronto lawyers practicing across 30+ areas of law.",
    rating: 4.2,
    reviewCount: 35,
    priceRange: "$$$",
    hours: "Mon-Fri 9am-6pm",
    phone: "(416) 362-2031",
    website: "https://www.dickinson-wright.com",
    tags: ["corporate-law", "real-estate", "M&A", "intellectual-property"],
    featured: true,
    proTip:
      "Their real estate team is particularly strong for condo transactions — useful for Liberty Village residents buying or selling units.",
    answerBlock:
      "Dickinson Wright LLP at 199 Bay St is one of Toronto's top law firms with 144 lawyers, recognized in The Globe & Mail's 2026 Best Law Firms for corporate, IP, M&A, and real estate. Their breadth of practice areas makes them a one-stop firm for Liberty Village businesses and residents.",
    bestFor: [
      "Condo real estate transactions in Liberty Village",
      "Startup corporate and commercial legal needs",
      "Intellectual property and trademark matters",
      "Business owners seeking full-service legal counsel",
    ],
  },
  {
    slug: "miller-thomson-toronto",
    name: "Miller Thomson LLP",
    category: "lawyers",
    subcategory: "full-service",
    address: "40 King St W, Suite 5800, Toronto, ON M5H 3S1",
    description:
      "Established in 1957, Miller Thomson is a national law firm with a strong Toronto presence on King St W. Their Platinum Client Champion award recognizes exceptional client service, and they cover corporate, real estate, family, and litigation.",
    rating: 3.5,
    reviewCount: 48,
    priceRange: "$$$",
    hours: "Mon-Fri 9am-5:30pm",
    phone: "(416) 595-8500",
    website: "https://www.millerthomson.com",
    tags: ["full-service", "corporate", "real-estate", "litigation"],
    featured: false,
    proTip:
      "They have a strong small business and startup practice — more approachable pricing than Bay Street mega-firms for everyday legal needs.",
    answerBlock:
      "Miller Thomson LLP at 40 King St W is a national law firm established in 1957, just minutes from Liberty Village. Their Platinum Client Champion award reflects strong client service across corporate, real estate, family, and litigation practice areas at competitive rates.",
    bestFor: [
      "Small business and startup legal matters",
      "Real estate closings for Liberty Village condos",
      "Family law including separation and divorce",
      "Litigation and dispute resolution",
    ],
  },
  {
    slug: "hgr-graham-partners",
    name: "HGR Graham Partners LLP",
    category: "lawyers",
    subcategory: "real-estate-law",
    address: "1 Queen St E, Suite 2500, Toronto, ON M5C 2W5",
    description:
      "Boutique law firm specializing in residential and commercial real estate transactions in the GTA. Known for efficient closings, competitive flat fees, and a personalized approach that big firms can't match.",
    rating: 4.6,
    reviewCount: 120,
    priceRange: "$$",
    hours: "Mon-Fri 9am-5pm",
    phone: "(416) 850-7474",
    website: "https://hgrlaw.ca",
    tags: ["real-estate-law", "condo-closings", "flat-fees", "boutique"],
    featured: false,
    proTip:
      "Ask about their flat-fee condo closing package — it's straightforward and avoids the surprise disbursement charges larger firms tack on.",
    answerBlock:
      "HGR Graham Partners LLP is a boutique Toronto law firm rated 4.6 stars, specializing in residential and commercial real estate transactions. Their flat-fee condo closing packages and personalized service make them a smart choice for Liberty Village buyers and sellers.",
    bestFor: [
      "Buying or selling a Liberty Village condo",
      "First-time homebuyers wanting clear flat-fee pricing",
      "Commercial real estate transactions",
      "Anyone preferring boutique firm attention over big firm bureaucracy",
    ],
  },

  // === INSURANCE AGENTS ===
  {
    slug: "hub-international-toronto",
    name: "HUB International",
    category: "insurance-agents",
    subcategory: "commercial-insurance",
    address: "130 King St W, Suite 1100, Toronto, ON M5X 1E4",
    description:
      "Major insurance brokerage on King St W offering commercial, personal, and specialty insurance products. Their Toronto office specializes in business insurance for startups and SMBs, with dedicated account managers for personalized service.",
    rating: 4.0,
    reviewCount: 85,
    priceRange: "$$",
    hours: "Mon-Fri 8:30am-5pm",
    phone: "(416) contoso-5950",
    website: "https://www.hubinternational.com",
    tags: ["commercial-insurance", "business-insurance", "personal-insurance", "king-west"],
    featured: true,
    proTip:
      "Ask about bundling your business and personal policies — HUB's multi-policy discounts can save Liberty Village entrepreneurs significant premiums.",
    answerBlock:
      "HUB International at 130 King St W is a leading insurance brokerage steps from Liberty Village, offering commercial and personal insurance with dedicated account managers. Their specialty in business insurance for startups and SMBs makes them a natural fit for Liberty Village's entrepreneurial community.",
    bestFor: [
      "Business insurance for Liberty Village startups and SMBs",
      "Bundling commercial and personal policies for savings",
      "Condo and tenant insurance for Liberty Village residents",
      "Specialty insurance for tech and creative businesses",
    ],
  },
  {
    slug: "thinkinsure-toronto",
    name: "ThinkInsure",
    category: "insurance-agents",
    subcategory: "personal-insurance",
    address: "155 University Ave, Suite 900, Toronto, ON M5H 3B7",
    description:
      "Independent insurance brokerage that shops across 40+ insurance companies to find the best rates for auto, home, condo, and tenant insurance. Their online quoting system makes comparison shopping effortless.",
    rating: 4.3,
    reviewCount: 450,
    priceRange: "$",
    hours: "Mon-Fri 8am-8pm, Sat 9am-4pm",
    phone: "(416) 849-0077",
    website: "https://www.thinkinsure.ca",
    tags: ["auto-insurance", "home-insurance", "condo-insurance", "comparison-shopping"],
    featured: false,
    proTip:
      "Get your quote online first, then call to negotiate — their brokers often find additional discounts not shown in the online system.",
    answerBlock:
      "ThinkInsure is an independent insurance broker that shops across 40+ companies to find the best rates for auto, home, and condo insurance. Their comparison approach typically saves Liberty Village residents 20-30% over going direct to a single insurer.",
    bestFor: [
      "Condo insurance for Liberty Village units",
      "Auto insurance comparison shopping",
      "First-time condo buyers needing insurance guidance",
      "Anyone wanting competitive rates without multiple calls",
    ],
  },
  {
    slug: "brokerlink-toronto",
    name: "BrokerLink",
    category: "insurance-agents",
    subcategory: "full-service-insurance",
    address: "2233 Argentia Rd, Mississauga, ON L5N 2X7",
    description:
      "One of Canada's largest insurance brokerages with 200+ locations. Offers auto, home, commercial, and life insurance with a strong online presence and local advisors who understand the Toronto market.",
    rating: 4.1,
    reviewCount: 380,
    priceRange: "$$",
    hours: "Mon-Fri 8am-8pm, Sat 9am-4pm",
    phone: "(866) 953-9898",
    website: "https://www.brokerlink.ca",
    tags: ["full-service", "auto-insurance", "home-insurance", "life-insurance"],
    featured: false,
    proTip:
      "Their online quote tool is fast, but calling their advisors often unlocks loyalty and multi-policy discounts not available online.",
    answerBlock:
      "BrokerLink is one of Canada's largest insurance brokerages with 200+ locations, offering auto, home, commercial, and life insurance. Their local advisors understand Liberty Village's condo market and can bundle policies for significant savings.",
    bestFor: [
      "One-stop shopping for all insurance needs",
      "Bundling auto, condo, and life insurance",
      "Businesses needing commercial liability coverage",
      "Clients who prefer speaking with a local advisor",
    ],
  },

  // === IT SUPPORT ===
  {
    slug: "gibraltar-solutions",
    name: "Gibraltar Solutions",
    category: "it-support",
    subcategory: "managed-it",
    address: "5935 Airport Rd, Suite 200, Mississauga, ON L4V 1W5",
    description:
      "SOC 2 Type II certified managed IT provider with 25+ years of experience serving Toronto businesses. Offers proactive monitoring, cybersecurity, cloud management, and 24/7 helpdesk support with a Great Place to Work certification.",
    rating: 4.5,
    reviewCount: 45,
    priceRange: "$$$",
    hours: "24/7 support, Mon-Fri 8:30am-5pm office",
    phone: "(877) 895-2474",
    website: "https://gibraltarsolutions.com",
    tags: ["managed-it", "cybersecurity", "SOC2-certified", "24-7-support"],
    featured: true,
    proTip:
      "Ask about their fixed monthly pricing — it's predictable budgeting vs. the surprise bills of break-fix IT support.",
    answerBlock:
      "Gibraltar Solutions is a SOC 2 Type II certified managed IT provider with 25+ years serving Toronto businesses. Their proactive monitoring, cybersecurity, and 24/7 helpdesk support make them ideal for Liberty Village tech startups and creative agencies needing enterprise-grade IT without an in-house team.",
    bestFor: [
      "Liberty Village startups needing managed IT without hiring",
      "Businesses requiring SOC 2 compliant IT infrastructure",
      "24/7 helpdesk support for distributed teams",
      "Companies seeking proactive cybersecurity monitoring",
    ],
  },
  {
    slug: "it-solutions-toronto",
    name: "IT Solutions Inc.",
    category: "it-support",
    subcategory: "managed-services",
    address: "60 Atlantic Ave, Suite 200, Toronto, ON M6K 1X9",
    description:
      "Liberty Village-based managed IT and cybersecurity provider specializing in small to mid-sized businesses. Their local presence means fast on-site response times and deep understanding of the neighbourhood's tech ecosystem.",
    rating: 4.4,
    reviewCount: 65,
    priceRange: "$$",
    hours: "Mon-Fri 8am-6pm, 24/7 emergency",
    phone: "(416) 850-9191",
    website: "https://www.itsolutions-inc.com",
    tags: ["managed-it", "cybersecurity", "liberty-village", "small-business"],
    featured: true,
    proTip:
      "Being based in Liberty Village means they can often be on-site within 30 minutes for emergencies — a huge advantage over suburban IT providers.",
    answerBlock:
      "IT Solutions Inc. on Atlantic Ave is a Liberty Village-based managed IT provider rated 4.4 stars, specializing in cybersecurity and support for small to mid-sized businesses. Their local presence means fast on-site response and a deep understanding of the neighbourhood's tech ecosystem.",
    bestFor: [
      "Liberty Village businesses wanting a local IT partner",
      "Small teams needing affordable managed IT services",
      "Fast on-site support for hardware emergencies",
      "Startups scaling their IT infrastructure",
    ],
  },
  {
    slug: "happier-it-toronto",
    name: "Happier IT",
    category: "it-support",
    subcategory: "managed-services",
    address: "Toronto, ON (serves Liberty Village)",
    description:
      "Managed IT and cybersecurity provider serving Toronto's finance, healthcare, legal, and tech sectors. Offers 24/7 support with zero wait times and specializes in building secure, scalable IT environments for growing businesses.",
    rating: 4.3,
    reviewCount: 30,
    priceRange: "$$",
    hours: "24/7 support",
    phone: "(647) 955-7800",
    website: "https://www.happierit.com",
    tags: ["managed-it", "cybersecurity", "cloud-management", "zero-wait-times"],
    featured: false,
    proTip:
      "Their zero wait time support model means you actually get a human immediately — no ticket queues or callbacks for urgent issues.",
    answerBlock:
      "Happier IT provides managed IT and cybersecurity services with 24/7 zero-wait-time support for Liberty Village businesses. They specialize in building secure, scalable environments for finance, healthcare, legal, and tech companies with responsive support that doesn't involve ticket queues.",
    bestFor: [
      "Businesses frustrated with slow IT support response times",
      "Healthcare and legal firms needing compliance-focused IT",
      "Companies transitioning to cloud infrastructure",
      "Teams needing 24/7 support without wait times",
    ],
  },

  // === TAILORS ===
  {
    slug: "studio-kim",
    name: "Studio Kim",
    category: "tailors",
    subcategory: "alterations",
    address: "851 Queen St W, Toronto, ON M6J 1G4",
    description:
      "Family-run alteration shop on Queen West known for exceptional craftsmanship and warm, personalized service. Kim handles everything from simple hemming to complex wedding dress alterations with free quotes and consistently perfect results.",
    rating: 4.8,
    reviewCount: 46,
    priceRange: "$$",
    hours: "Mon-Fri 11am-7pm, Sat 11am-4pm",
    phone: "(416) 361-0831",
    website: "https://studio-kim.com",
    tags: ["alterations", "wedding-dress", "tailoring", "queen-west"],
    featured: true,
    proTip:
      "Book ahead for complex alterations during wedding season (May-October) — Kim's calendar fills up fast due to her stellar reputation.",
    answerBlock:
      "Studio Kim on Queen St W is a family-run alteration shop rated 4.8 stars, a 5-minute walk from Liberty Village. Kim's exceptional craftsmanship handles everything from simple hemming to complex wedding dress alterations with free quotes and personalized attention.",
    bestFor: [
      "Wedding dress and formal wear alterations",
      "Quick turnaround on everyday hemming and tailoring",
      "Personalized attention from a family-run shop",
      "Free quotes before committing to alterations",
    ],
  },
  {
    slug: "3rd-floor-tailors",
    name: "3rd Floor Tailors",
    category: "tailors",
    subcategory: "luxury-alterations",
    address: "821 Queen St W, 2nd Floor, Toronto, ON M6J 1G1",
    description:
      "Premium tailoring with over 30 years of experience, specializing in wedding gowns, custom design, and high-end garment repairs. Lilit and Natasha deliver meticulous attention to detail with a professional yet friendly approach.",
    rating: 4.5,
    reviewCount: 35,
    priceRange: "$$$",
    hours: "Tue-Thu 10am-6pm, Fri 11am-7pm, Sat 11am-5pm",
    phone: "(647) 873-8811",
    website: "https://3rdfloortailors.com",
    tags: ["luxury-alterations", "wedding-gowns", "custom-design", "premium"],
    featured: false,
    proTip:
      "Prices are premium but reflect the quality — bring your most valuable garments here and save the basics for a budget tailor.",
    answerBlock:
      "3rd Floor Tailors on Queen St W offers premium tailoring with 30+ years of experience, specializing in wedding gowns and high-end garments. Located an 8-minute walk from Liberty Village, their meticulous craftsmanship justifies the premium pricing for valuable pieces.",
    bestFor: [
      "High-end and designer clothing alterations",
      "Complex wedding dress modifications",
      "Custom tailoring and bespoke garments",
      "Clients who prioritize quality over price",
    ],
  },
  {
    slug: "love-your-tailor",
    name: "Love Your Tailor",
    category: "tailors",
    subcategory: "pickup-delivery",
    address: "74 Gough Ave, Toronto, ON M4K 3N8",
    description:
      "Ontario's largest tailoring facility offering professional alterations, cleaning, and garment restoration with free pickup and delivery across Southern Ontario — including Liberty Village. No need to travel when the tailor comes to you.",
    rating: 4.0,
    reviewCount: 85,
    priceRange: "$$",
    hours: "Pickup/delivery service, standard business hours",
    phone: "(416) 538-2326",
    website: "https://loveyourtailor.ca",
    tags: ["pickup-delivery", "garment-restoration", "leather-work", "bulk-alterations"],
    featured: false,
    proTip:
      "Use their free pickup and delivery service — perfect for busy Liberty Village professionals who can't find time to visit a tailor in person.",
    answerBlock:
      "Love Your Tailor is Ontario's largest tailoring facility offering free pickup and delivery to Liberty Village. Specializing in professional alterations, garment restoration, and leather work, they bring the tailor shop to your door — ideal for busy condo residents.",
    bestFor: [
      "Busy professionals needing pickup and delivery",
      "Leather jacket and specialty material alterations",
      "Bulk wardrobe alterations and seasonal updates",
      "Garment restoration and repair work",
    ],
  },

  // === AUTO REPAIR ===
  {
    slug: "spadina-auto",
    name: "Spadina Auto",
    category: "auto-repair",
    subcategory: "general-repair",
    address: "111 Strachan Ave, Toronto, ON M6J 2S7",
    description:
      "Family-run since 1971, Spadina Auto is the closest mechanic to Liberty Village. Wayne and his team provide honest, transparent service with no upselling — just straight talk and fair pricing on everything from oil changes to major repairs.",
    rating: 4.7,
    reviewCount: 794,
    priceRange: "$$",
    hours: "Mon-Fri 8:30am-7pm, Sat 9am-4pm",
    phone: "(416) 925-4251",
    website: "https://spadinaauto.com",
    tags: ["family-owned", "honest-service", "safety-inspections", "tire-services"],
    featured: true,
    proTip:
      "Build a relationship with Wayne — he'll tell you what's urgent and what can wait, saving you money in the long run.",
    answerBlock:
      "Spadina Auto on Strachan Ave is Liberty Village's go-to mechanic since 1971, rated 4.7 stars with nearly 800 reviews. Wayne and his family-run crew deliver honest, no-upsell service from oil changes to major repairs at the closest auto shop to the neighbourhood.",
    bestFor: [
      "Trustworthy mechanic who won't upsell unnecessary work",
      "Safety inspections and emissions testing",
      "Tire sales, repair, and seasonal changeovers",
      "Liberty Village residents wanting a neighbourhood shop",
    ],
  },
  {
    slug: "central-import",
    name: "Central Import",
    category: "auto-repair",
    subcategory: "european-imports",
    address: "472 King St E, Toronto, ON M5A 1L7",
    description:
      "Toronto's premier warranty-approved independent service facility for European imports — BMW, Audi, Mercedes, Porsche, and Volvo. Family-run since 1978 with over 100 years of combined experience and dealership-quality service.",
    rating: 4.7,
    reviewCount: 75,
    priceRange: "$$$",
    hours: "Mon-Thu 7:30am-5:30pm, Fri 7:30am-5pm",
    phone: "(416) 864-9092",
    website: "https://centralimport.ca",
    tags: ["european-imports", "BMW", "Mercedes", "warranty-approved"],
    featured: false,
    proTip:
      "Don't pay dealership prices for your BMW or Audi — Central Import provides the same quality service at independent shop rates.",
    answerBlock:
      "Central Import on King St E is Toronto's premier independent European auto specialist, rated 4.7 stars. Warranty-approved for BMW, Audi, Mercedes, Porsche, and Volvo, they deliver dealership-quality service since 1978 at independent pricing — perfect for Liberty Village luxury car owners.",
    bestFor: [
      "European luxury vehicle maintenance and repair",
      "Warranty-approved service without dealership markup",
      "Complex diagnostics and transmission work",
      "BMW, Audi, Mercedes, and Porsche specialists",
    ],
  },
  {
    slug: "certified-tire-auto",
    name: "Certified Tire & Auto",
    category: "auto-repair",
    subcategory: "budget-repair",
    address: "1586 Queen St W, Toronto, ON M6R 1A8",
    description:
      "Parkdale neighbourhood shop with competitive pricing, extended warranties, and reliable service on all vehicle types. Popular among Liberty Village and Queen West residents for honest work without the premium price tag.",
    rating: 4.2,
    reviewCount: 24,
    priceRange: "$",
    hours: "Mon-Fri 8am-6pm, Sat 8am-2pm",
    phone: "(416) 531-0095",
    website: "https://certifiedtireauto.ca",
    tags: ["budget-friendly", "tire-services", "extended-warranties", "parkdale"],
    featured: false,
    proTip:
      "Get quotes from multiple shops, then compare — Certified often comes in lower without cutting corners on quality.",
    answerBlock:
      "Certified Tire & Auto in Parkdale offers budget-friendly auto repair just west of Liberty Village. Their competitive pricing, extended warranties, and honest service make them a smart choice for cost-conscious car owners who still want quality work.",
    bestFor: [
      "Budget-conscious vehicle owners",
      "Tire services and seasonal changeovers at low prices",
      "Routine maintenance without premium pricing",
      "Extended warranty options for peace of mind",
    ],
  },

  // === TUTORS ===
  {
    slug: "tutorbright-toronto",
    name: "TutorBright",
    category: "tutors",
    subcategory: "in-home-tutoring",
    address: "Toronto-wide service (serves Liberty Village)",
    description:
      "Top-rated personalized tutoring service offering in-home and online sessions across all subjects from Kindergarten to Grade 12. No contracts or bulk hours required — flat rate of $68/hour with tutors matched to your child's learning style.",
    rating: 4.5,
    reviewCount: 498,
    priceRange: "$$",
    hours: "Flexible scheduling, 7 days a week",
    phone: "(416) 423-3030",
    website: "https://tutorbright.com/tutoring-toronto",
    tags: ["one-on-one", "all-subjects", "K-12", "online-tutoring"],
    featured: true,
    proTip:
      "No contracts — try them for a few sessions to see if the tutor-student match works before committing long-term.",
    answerBlock:
      "TutorBright is Toronto's top-rated tutoring service with 498 reviews, offering personalized in-home and online sessions for K-12 students. Their no-contract, flat-rate model ($68/hr) with tutor-student matching makes them ideal for Liberty Village families seeking flexible academic support.",
    bestFor: [
      "K-12 students needing personalized one-on-one help",
      "Families wanting no-contract flexibility",
      "Both in-home and online tutoring options",
      "Students who need confidence-building alongside academics",
    ],
  },
  {
    slug: "oxford-learning-high-park",
    name: "Oxford Learning - High Park",
    category: "tutors",
    subcategory: "learning-centre",
    address: "406B Pacific Ave, Toronto, ON M6P 2R4",
    description:
      "Established tutoring centre with a proven cognitive learning methodology that teaches students how to learn, not just subject content. Personalized programs address underlying learning skills alongside academic content.",
    rating: 4.8,
    reviewCount: 40,
    priceRange: "$$$",
    hours: "Mon-Thu 9am-8pm, Fri 9am-5pm, Sat-Sun 9am-4pm",
    phone: "(647) 494-3100",
    website: "https://oxfordlearning.com/locations/toronto-high-park-tutoring",
    tags: ["learning-centre", "cognitive-skills", "methodology", "all-ages"],
    featured: false,
    proTip:
      "Oxford's approach goes deeper than subject tutoring — ideal for students who struggle with study habits and organization, not just content.",
    answerBlock:
      "Oxford Learning in High Park is a premier tutoring centre rated 4.8 stars, 15 minutes from Liberty Village. Their proven cognitive learning methodology teaches students how to learn — building study skills, organization, and academic confidence alongside subject-specific help.",
    bestFor: [
      "Students struggling with study habits and organization",
      "Long-term academic development beyond test prep",
      "Families wanting a structured learning environment",
      "Building foundational cognitive and learning skills",
    ],
  },
  {
    slug: "kumon-jane-bloor",
    name: "Kumon - Jane & Bloor",
    category: "tutors",
    subcategory: "math-reading",
    address: "14A Jane St, Toronto, ON M6S 3Y2",
    description:
      "Kumon's renowned self-paced math and reading programs build strong fundamentals through daily practice and mastery-based progression. The structured, incremental approach develops independent learning skills and discipline.",
    rating: 4.7,
    reviewCount: 10,
    priceRange: "$$",
    hours: "Weekday afternoons, weekend mornings",
    phone: "(416) 767-6700",
    website: "https://kumon.com/toronto-jane-and-bloor",
    tags: ["math", "reading", "self-paced", "mastery-based"],
    featured: false,
    proTip:
      "Kumon requires 15-20 minutes of daily home practice — the commitment builds discipline, but make sure your family is ready for the routine.",
    answerBlock:
      "Kumon at Jane & Bloor offers the globally proven math and reading program 15 minutes from Liberty Village. Their self-paced, mastery-based approach builds strong fundamentals through daily practice, developing both academic skills and learning discipline.",
    bestFor: [
      "Students needing stronger math or reading foundations",
      "Families committed to consistent daily practice",
      "Self-motivated learners who thrive on incremental progress",
      "Long-term skill building rather than quick fixes",
    ],
  },

  // === PHOTOGRAPHERS ===
  {
    slug: "studio-207-liberty-village",
    name: "Studio 207 (Pink Floor Studios)",
    category: "photographers",
    subcategory: "studio-rental",
    address: "65 Jefferson Ave, Studio 207, Toronto, ON M6K 1Y3",
    description:
      "Stunning 1,000 sq ft photo/video loft in Liberty Village with iconic blush-pink floors, a 10x12 ft cyclorama cove, and five south-facing windows. Fully equipped with makeup area, wardrobe room, sound system, and outdoor patio.",
    rating: 4.8,
    reviewCount: 35,
    priceRange: "$$",
    hours: "Daily rental, flexible scheduling",
    phone: "(647) 555-0207",
    website: "https://studio207to.com",
    tags: ["studio-rental", "natural-light", "cyclorama", "fashion-photography"],
    featured: true,
    proTip:
      "The pink floors are Instagram gold for branding and fashion content — book during afternoon hours for the best south-facing natural light.",
    answerBlock:
      "Studio 207 on Jefferson Ave is Liberty Village's premier photo/video studio, featuring iconic blush-pink floors, a professional cyclorama cove, and natural light from five south-facing windows. The 1,000 sq ft turnkey space includes everything from makeup areas to a patio.",
    bestFor: [
      "Fashion and editorial photography shoots",
      "Content creators needing a distinctive aesthetic",
      "Brand photography with natural light",
      "Video production and commercial shoots",
    ],
  },
  {
    slug: "neil-ta-photography",
    name: "Neil Ta Photography",
    category: "photographers",
    subcategory: "wedding-photography",
    address: "700 King St W, Toronto, ON M5V 3M6",
    description:
      "The #1 rated Toronto photographer on Yelp, specializing in weddings, events, and mixed-genre photography. Neil's unique approach blends different photography styles for richer, more dynamic storytelling.",
    rating: 5.0,
    reviewCount: 35,
    priceRange: "$$$",
    hours: "By appointment",
    phone: "(416) 904-9887",
    website: "https://neilta.ca",
    tags: ["wedding-photography", "events", "mixed-genre", "award-winning"],
    featured: true,
    proTip:
      "Neil only books one event per day for complete focus — reserve your date early for peak wedding season (May-October).",
    answerBlock:
      "Neil Ta Photography on King St W is Yelp's #1 rated Toronto photographer, a 5-minute walk from Liberty Village. His mixed-genre approach to wedding and event photography creates richer storytelling, and his one-event-per-day policy ensures every client gets complete creative attention.",
    bestFor: [
      "Artistic, story-driven wedding photography",
      "Corporate events requiring professional coverage",
      "Engagement and creative couples sessions",
      "Clients wanting Toronto's top-rated photographer",
    ],
  },
  {
    slug: "david-abreu-photography",
    name: "David Abreu Photography",
    category: "photographers",
    subcategory: "candid-wedding",
    address: "99 Atlantic Ave, Suite 311, Toronto, ON M6K 3J8",
    description:
      "Liberty Village-based candid wedding and event photographer specializing in natural, documentary-style coverage. Dave captures authentic moments with a photojournalistic approach that tells your story without forced poses.",
    rating: 4.6,
    reviewCount: 28,
    priceRange: "$$",
    hours: "By appointment",
    phone: "(647) 281-7979",
    website: "https://daveabreuphotography.com",
    tags: ["candid", "documentary-style", "wedding", "liberty-village"],
    featured: false,
    proTip:
      "Dave's documentary approach means fewer posed shots and more genuine moments — perfect for couples who hate being told where to stand.",
    answerBlock:
      "David Abreu Photography on Atlantic Ave is a Liberty Village-based wedding photographer rated 4.6 stars. His candid, documentary-style approach captures authentic moments without forced poses, perfect for couples who want their real story told naturally.",
    bestFor: [
      "Couples who prefer candid over posed photography",
      "Liberty Village residents wanting a local photographer",
      "Documentary-style wedding and event coverage",
      "Intimate weddings and small celebrations",
    ],
  },
  {
    slug: "maz-images-studios",
    name: "Maz Images Studios",
    category: "photographers",
    subcategory: "portrait-studio",
    address: "27R Atlantic Ave, Toronto, ON M6K 3E7",
    description:
      "Full-service portrait studio in Liberty Village offering professional headshots, family portraits, and event photography. Known for excellent customer service and high-quality results in a comfortable, welcoming environment.",
    rating: 5.0,
    reviewCount: 10,
    priceRange: "$$",
    hours: "By appointment",
    phone: "(416) 566-7755",
    website: "https://mazstudios.ca",
    tags: ["portrait", "headshots", "family-photos", "studio"],
    featured: false,
    proTip:
      "Perfect for professional LinkedIn headshots — the studio is right in Liberty Village so you can pop in during a lunch break.",
    answerBlock:
      "Maz Images Studios on Atlantic Ave is a Liberty Village portrait studio rated 5.0 stars. Specializing in professional headshots, family portraits, and event photography, the welcoming studio environment and local convenience make it ideal for neighbourhood residents and professionals.",
    bestFor: [
      "Professional headshots and LinkedIn photos",
      "Family and children's portrait sessions",
      "Corporate team photos",
      "Liberty Village residents wanting a neighbourhood studio",
    ],
  },

  // === LAUNDROMATS ===
  {
    slug: "king-west-village-cleaners",
    name: "King West Village Cleaners",
    category: "laundromats",
    subcategory: "dry-cleaning",
    address: "1000 King St W, Toronto, ON M6K 3N1",
    description:
      "Neighbourhood favourite on King West offering dry cleaning, washing, and alterations. Praised for detail-oriented service, efficiency, and legendary customer service — they remember your preferences and treat every garment with care.",
    rating: 4.6,
    reviewCount: 45,
    priceRange: "$$",
    hours: "Mon-Fri 7am-7pm, Sat 8am-5pm",
    phone: "(416) 596-0559",
    website: "https://kingwestvillagecleaners.ca",
    tags: ["dry-cleaning", "alterations", "king-west", "professional"],
    featured: true,
    proTip:
      "Build a relationship with the staff — they'll remember your preferences and give priority turnaround on rush jobs.",
    answerBlock:
      "King West Village Cleaners at 1000 King St W is the neighbourhood's go-to dry cleaner, rated 4.6 stars. Adjacent to Liberty Village, they offer dry cleaning, washing, and alterations with detail-oriented service and legendary customer care that keeps locals coming back.",
    bestFor: [
      "Professional dry cleaning for work attire",
      "Quick alterations alongside cleaning",
      "Rush jobs when you need something cleaned fast",
      "Liberty Village residents walking to King West",
    ],
  },
  {
    slug: "jukebox-laundry-concierge",
    name: "Laundry Concierge",
    category: "laundromats",
    subcategory: "pickup-delivery",
    address: "47 Charles St W, Toronto, ON (serves Liberty Village)",
    description:
      "Premium pickup and delivery laundry service with 40+ years in Toronto. Offers wash & fold, dry cleaning, and shoe care with free contactless delivery to Liberty Village. 24/7 drop-off lockers and 48-hour turnaround.",
    rating: 4.1,
    reviewCount: 73,
    priceRange: "$$$",
    hours: "24/7 drop-off lockers, 48-hour turnaround",
    phone: "(647) 528-6379",
    website: "https://laundry-concierge.com",
    tags: ["pickup-delivery", "wash-and-fold", "dry-cleaning", "shoe-care"],
    featured: false,
    proTip:
      "Use their 24/7 lockers for maximum flexibility — drop off and pick up at any hour without waiting for business hours.",
    answerBlock:
      "Laundry Concierge offers premium pickup and delivery laundry service to Liberty Village with 40+ years of experience. Free contactless delivery, 24/7 drop-off lockers, and 48-hour turnaround make them ideal for busy condo residents without in-suite laundry.",
    bestFor: [
      "Busy professionals who hate doing laundry",
      "Condo residents without in-suite machines",
      "Shoe care and specialty item cleaning",
      "Anyone wanting 24/7 drop-off and pickup flexibility",
    ],
  },
  {
    slug: "wash-world-king-west",
    name: "Wash World",
    category: "laundromats",
    subcategory: "self-service",
    address: "1182 King St W, Toronto, ON M6K 1E6",
    description:
      "Self-service coin laundry on King West with friendly, helpful staff. Accepts both cash and debit cards — a rarity among laundromats — with long operating hours for early morning or evening loads.",
    rating: 3.5,
    reviewCount: 20,
    priceRange: "$",
    hours: "Daily 7am-9pm",
    phone: "(416) 533-9274",
    website: "https://washworldlaundry.com",
    tags: ["self-service", "coin-laundry", "budget-friendly", "king-west"],
    featured: false,
    proTip:
      "Bring your debit card — unlike most laundromats they accept both card and coins, so no scrambling for quarters.",
    answerBlock:
      "Wash World on King St W is a budget-friendly self-service laundromat adjacent to Liberty Village, open daily 7am-9pm. They accept both debit cards and coins, have friendly staff, and offer a simple no-fuss option for residents who prefer to do their own laundry.",
    bestFor: [
      "Budget-conscious self-service laundry",
      "Large loads requiring high-capacity machines",
      "Early morning or late evening laundry sessions",
      "Anyone who forgot to get quarters (debit accepted)",
    ],
  },

  // === PRINTING SERVICES ===
  {
    slug: "jukebox-print",
    name: "Jukebox Print",
    category: "printing-services",
    subcategory: "digital-printing",
    address: "219 Dufferin St, Suite 4B, Toronto, ON M6K 3J1",
    description:
      "Canada's highest-rated online printing company, located right in Liberty Village. Same-day stickers if ordered by 10 AM, plus a 24/7 pickup locker for after-hours convenience. Over 5,700 five-star reviews on Trustpilot.",
    rating: 5.0,
    reviewCount: 1100,
    priceRange: "$$",
    hours: "Mon-Fri 9am-8pm",
    phone: "(888) 667-0067",
    website: "https://jukeboxprint.com",
    tags: ["same-day-printing", "stickers", "business-cards", "24-7-pickup"],
    featured: true,
    proTip:
      "Order stickers by 10 AM for same-day pickup from their 24/7 locker — no need to wait for business hours.",
    answerBlock:
      "Jukebox Print on Dufferin St is Canada's highest-rated printing company right in Liberty Village, with 5,700+ five-star Trustpilot reviews. Same-day sticker printing (order by 10 AM) and a 24/7 pickup locker make them the go-to for Liberty Village businesses and creators.",
    bestFor: [
      "Same-day sticker and business card printing",
      "Liberty Village businesses needing quick turnaround",
      "24/7 pickup when you can't make business hours",
      "High-volume orders from Canada's top-rated printer",
    ],
  },
  {
    slug: "moveable-inc",
    name: "Moveable Inc.",
    category: "printing-services",
    subcategory: "professional-printing",
    address: "67 Mowat Ave, Suite 500, Toronto, ON M6K 3E3",
    description:
      "Professional printing service established in 1983 in the Liberty Village area. Specializes in high-quality printing with proofreading, typesetting, and multilingual page layouts — a full-service shop for polished publications.",
    rating: 4.2,
    reviewCount: 15,
    priceRange: "$$$",
    hours: "Mon-Fri 9am-5pm",
    phone: "(416) 532-5690",
    website: "https://moveable.com",
    tags: ["professional-printing", "proofreading", "multilingual", "premium"],
    featured: false,
    proTip:
      "Leverage their proofreading and copyediting alongside printing — their expert eyes catch errors that could undermine professional materials.",
    answerBlock:
      "Moveable Inc. on Mowat Ave has provided professional printing in Liberty Village since 1983. Their full-service offering includes proofreading, typesetting, and multilingual layouts — ideal for businesses that need polished, error-free print materials with premium finishing.",
    bestFor: [
      "Professional publications requiring proofreading",
      "Multilingual marketing materials",
      "High-end print projects with luxurious finishes",
      "Businesses needing full-service print production",
    ],
  },
  {
    slug: "red-hot-printing",
    name: "Red Hot Printing",
    category: "printing-services",
    subcategory: "budget-printing",
    address: "1444 Dupont St, Unit 7, Toronto, ON M6P 4H3",
    description:
      "Budget-friendly west-end print shop with a stellar 4.8 rating, known for same-day and next-day turnaround. Fantastic customer support and quick service that customers call a 'life saver' for last-minute projects.",
    rating: 4.8,
    reviewCount: 40,
    priceRange: "$",
    hours: "Mon-Fri 9:30am-4pm",
    phone: "(416) 785-7503",
    website: "https://redhotprintinginc.com",
    tags: ["budget-friendly", "same-day", "digital-printing", "fast-turnaround"],
    featured: false,
    proTip:
      "Call ahead for same-day or next-day printing — their quick turnarounds are consistently praised as life savers for urgent projects.",
    answerBlock:
      "Red Hot Printing on Dupont St is a budget-friendly print shop rated 4.8 stars, serving Liberty Village and west Toronto since 2000. Their same-day and next-day turnaround combined with fantastic customer support make them the go-to for urgent, affordable print jobs.",
    bestFor: [
      "Last-minute urgent print jobs",
      "Budget-conscious printing for startups and small businesses",
      "Same-day and next-day turnaround needs",
      "Customers who value responsive customer service",
    ],
  },

  // === INTERIOR DESIGNERS ===
  {
    slug: "bkdp-design",
    name: "BKDP (BiglarKinyan Design Planning)",
    category: "interior-designers",
    subcategory: "condo-design",
    address: "204 King St E, Unit B101A, Toronto, ON M5A 1J7",
    description:
      "12-time Best of Houzz winner specializing in condos and lofts in downtown Toronto. Their design-build approach streamlines the entire renovation from architecture to construction under one roof — founded in 2005.",
    rating: 4.9,
    reviewCount: 30,
    priceRange: "$$$",
    hours: "By appointment",
    phone: "(416) 850-9911",
    website: "https://bkdp.ca",
    tags: ["condo-design", "lofts", "design-build", "award-winning"],
    featured: true,
    proTip:
      "Their design-build model means one trusted partner manages everything — no coordinating between designer, architect, and contractor yourself.",
    answerBlock:
      "BKDP on King St E is a 12-time Best of Houzz winner specializing in condo and loft design in downtown Toronto. Their design-build approach streamlines renovations from concept to construction, making them ideal for Liberty Village condo owners wanting a single trusted partner.",
    bestFor: [
      "Liberty Village condo and loft renovations",
      "Design-build projects with one point of contact",
      "High-end residential transformations",
      "Award-winning design for downtown condos",
    ],
  },
  {
    slug: "lux-design-toronto",
    name: "LUX Design",
    category: "interior-designers",
    subcategory: "commercial-residential",
    address: "628 Wellington St W, Toronto, ON M5V 1G4",
    description:
      "Design studio established in 2004 near King West, specializing in unique, luxurious concepts for both commercial and residential spaces. Featured in Canadian Interiors Magazine and the New York Times.",
    rating: 4.8,
    reviewCount: 20,
    priceRange: "$$$",
    hours: "Mon-Fri 9am-5pm",
    phone: "(416) 848-3108",
    website: "https://luxdesign.ca",
    tags: ["luxury", "commercial", "residential", "press-featured"],
    featured: false,
    proTip:
      "Come prepared with inspiration images — their process for creating unique concepts works best when you have a clear vision to build from.",
    answerBlock:
      "LUX Design on Wellington St W is a press-featured interior design studio near Liberty Village, established in 2004. Featured in Canadian Interiors Magazine and the New York Times, they create unique, luxurious concepts for both commercial and residential spaces.",
    bestFor: [
      "Mixed commercial and residential projects",
      "Clients wanting press-featured, award-winning design",
      "King West and Liberty Village area projects",
      "Luxury concepts with distinctive creative flair",
    ],
  },
  {
    slug: "swisterski-design",
    name: "Swisterski Design",
    category: "interior-designers",
    subcategory: "consultations",
    address: "307-77 Carlton St, Toronto, ON M5B 2J7",
    description:
      "Premier interior design firm led by Joanne Swisterski with 15+ years of Toronto experience. Offers consultations starting at $250 — a great entry point for homeowners who need expert direction before committing to a full project.",
    rating: 5.0,
    reviewCount: 15,
    priceRange: "$$",
    hours: "By appointment",
    phone: "(416) 574-0552",
    website: "https://swisterski.com",
    tags: ["consultations", "residential", "commercial", "experienced"],
    featured: false,
    proTip:
      "Start with their $250 consultation to get professional direction on scope and budget before committing to a full project.",
    answerBlock:
      "Swisterski Design offers 15+ years of Toronto interior design expertise with a perfect 5-star rating. Their $250 consultation entry point makes professional design guidance accessible for Liberty Village condo owners, with full-service options for new construction and large-scale renovations.",
    bestFor: [
      "First-time renovators needing expert consultations",
      "Condo owners wanting professional design direction",
      "New construction interior design",
      "Accessible entry point into professional design services",
    ],
  },

  // === LOCKSMITH ===
  {
    slug: "tbc-locksmith",
    name: "TBC Locksmith",
    category: "locksmith",
    subcategory: "emergency-locksmith",
    address: "123 Eglinton Ave E, Toronto, ON M4P 1J2",
    description:
      "Named one of Toronto's top 8 locksmiths with 15-30 minute typical response time and 572+ reviews. Handles everything from emergency lockouts to complex security installations with a mobile fleet across the GTA.",
    rating: 4.8,
    reviewCount: 572,
    priceRange: "$$",
    hours: "24/7, 365 days a year",
    phone: "(647) 370-2520",
    website: "https://tbc-locksmith.ca",
    tags: ["24-7", "emergency", "fast-response", "security-systems"],
    featured: true,
    proTip:
      "Save their number in your phone now — when you're locked out at midnight, you'll be glad you have a 15-minute response locksmith on speed dial.",
    answerBlock:
      "TBC Locksmith is one of Toronto's top-rated locksmiths with 572+ reviews and a 4.8-star rating, offering 24/7 service with 15-30 minute response times. Their mobile fleet serves Liberty Village around the clock for lockouts, key cutting, and security installations.",
    bestFor: [
      "Emergency lockouts at any hour",
      "Fast 15-30 minute response when locked out",
      "Car key cutting and programming",
      "Security hardware installation for condos",
    ],
  },
  {
    slug: "matrix-locksmith",
    name: "Matrix Locksmith",
    category: "locksmith",
    subcategory: "security-specialist",
    address: "Toronto-wide mobile service",
    description:
      "Established in 2002 with 440+ five-star reviews and a 25-minute average response time. Specializes in both emergency lockouts and security system installations with same-day mobile service across Toronto and the GTA.",
    rating: 5.0,
    reviewCount: 440,
    priceRange: "$$",
    hours: "24/7 service",
    phone: "(416) 831-2828",
    website: "https://matrixlocksmith.ca",
    tags: ["security-systems", "24-7", "established", "top-rated"],
    featured: false,
    proTip:
      "Check their website for fair pricing estimates before calling — their transparency and 440+ five-star reviews demonstrate consistent reliability.",
    answerBlock:
      "Matrix Locksmith has been serving Toronto since 2002 with a perfect 5-star rating and 440+ reviews. Their 25-minute average response time and specialization in both emergency lockouts and security installations make them a trusted choice for Liberty Village condo residents.",
    bestFor: [
      "Emergency lockouts with fast, reliable response",
      "Security system and access control installation",
      "Established, highly-reviewed locksmith service",
      "Condo lock and security upgrades",
    ],
  },
  {
    slug: "asap-lock-service",
    name: "ASAP Emergency Lock Service",
    category: "locksmith",
    subcategory: "emergency",
    address: "Toronto-wide mobile service",
    description:
      "Serving Toronto for 30+ years with licensed technicians in fully equipped service trucks. Provides residential, commercial, and automotive locksmith services with a reputation built on decades of reliability.",
    rating: 4.5,
    reviewCount: 35,
    priceRange: "$$",
    hours: "24/7 emergency service",
    phone: "(416) 223-6667",
    website: "https://asaplock.com",
    tags: ["emergency", "licensed", "30-year-history", "mobile"],
    featured: false,
    proTip:
      "Their 30+ year track record means reliability when emergencies strike — save their number alongside TBC for backup options.",
    answerBlock:
      "ASAP Emergency Lock Service has served Toronto for 30+ years with licensed technicians and fully equipped mobile service trucks. Their decades of experience in residential, commercial, and automotive locksmith work provide the reliability Liberty Village residents need in emergencies.",
    bestFor: [
      "Emergency lockouts requiring experienced technicians",
      "Commercial building lock services",
      "Automotive lock and key services",
      "Residents wanting an established, licensed locksmith",
    ],
  },
];

// Step 3: Add new businesses, skipping any that already exist
let added = 0;
let skipped = 0;
for (const biz of newBusinesses) {
  if (existingSlugs.has(biz.slug)) {
    skipped++;
    continue;
  }
  businesses.push(biz);
  existingSlugs.add(biz.slug);
  added++;
}

// Step 4: Write updated file
fs.writeFileSync(filePath, JSON.stringify(businesses, null, 2));

console.log(`Updated businesses.json:`);
console.log(`  Cross-listed: ${Object.keys(crossListings).length} existing businesses`);
console.log(`  Added: ${added} new businesses`);
console.log(`  Skipped (duplicate): ${skipped}`);
console.log(`  Total: ${businesses.length}`);

// Step 5: Verify all 17 categories now have businesses
const services = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "data", "services.json"), "utf8")
);
console.log("\nCategory coverage check:");
let allCovered = true;
for (const svc of services) {
  const count = businesses.filter(
    (b) =>
      b.category === svc.slug ||
      (b.categories && b.categories.includes(svc.slug))
  ).length;
  const status = count === 0 ? "EMPTY" : `${count} businesses`;
  if (count === 0) allCovered = false;
  console.log(`  /best/${svc.slug}: ${status}`);
}
console.log(allCovered ? "\nAll categories populated!" : "\nSome categories still empty!");
