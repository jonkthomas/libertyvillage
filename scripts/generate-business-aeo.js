#!/usr/bin/env node

/**
 * generate-business-aeo.js
 *
 * Adds answerBlock and bestFor fields to all businesses in businesses.json
 * for Answer Engine Optimization (AEO).
 *
 * answerBlock: 40-60 word paragraph explaining why someone should visit
 * bestFor: Array of 3-5 specific use-case scenarios
 */

const fs = require('fs');
const path = require('path');

const BUSINESSES_PATH = path.join(__dirname, '..', 'data', 'businesses.json');

function getStreetName(address) {
  if (!address) return 'Liberty Village';
  const street = address.split(',')[0].replace(/^\d+\s*/, '').replace(/\s*(Unit|Suite)\s*\d+/i, '').trim();
  return street || 'Liberty Village';
}

function wordCount(str) {
  return str.split(/\s+/).filter(Boolean).length;
}

/**
 * Generate answerBlock and bestFor for each business based on its existing data.
 */
function generateAEO(biz) {
  const slug = biz.slug;
  const street = getStreetName(biz.address);
  const rating = biz.rating;
  const price = biz.priceRange;
  const tags = biz.tags || [];
  const cat = biz.category;

  // Map of slug -> { answerBlock, bestFor }
  const data = {

    // === RESTAURANTS ===
    'mildreds-temple-kitchen': {
      answerBlock: `Mildred's Temple Kitchen on Hanna Ave is Liberty Village's original brunch destination, famous for blueberry buttermilk pancakes served in a converted factory space. Rated ${rating} stars by over 1,200 locals, the industrial-chic atmosphere and elevated Canadian comfort food at dinner make it a neighbourhood institution that's earned its reputation over two decades.`,
      bestFor: ['Saturday morning brunch with friends', 'special occasion dinner in a heritage space', 'out-of-town guests you want to impress', 'date night with elevated comfort food']
    },

    'nodo-liberty-village': {
      answerBlock: `NODO on East Liberty St brings authentic Neapolitan pizza to Liberty Village with dough fermented for 72 hours and baked in a custom Naples-imported oven. Rated ${rating} stars, the communal tables and open kitchen create a warm, casual trattoria vibe that's hard to find elsewhere in the neighbourhood. Their house-made pasta is equally impressive.`,
      bestFor: ['casual weeknight dinner with friends', 'wood-fired pizza craving on a Friday', 'family-friendly Italian dinner', 'group dinner where everyone shares']
    },

    'chiang-mai-thai': {
      answerBlock: `Chiang Mai on East Liberty St has been serving honest Thai food since before Liberty Village was full of condos. The lunch combos are the best deal in the neighbourhood at under $15, and the pad thai and green curry are consistently solid. Rated ${rating} stars, this no-frills spot lets the food do all the talking.`,
      bestFor: ['quick weekday lunch under $15', 'reliable takeout on a lazy evening', 'budget-friendly dinner that still delivers on flavour', 'late-night Thai food delivery to your condo']
    },

    'burger-drops': {
      answerBlock: `Burger Drops on East Liberty St has built a cult following with its smashed burgers that rival anything on the Toronto burger scene. Rated ${rating} stars, the tight, focused menu of burgers, loaded fries, and milkshakes means every item is dialled in. The double smash with house-made pickles and special sauce is the one to order.`,
      bestFor: ['quick satisfying lunch in under 20 minutes', 'late-afternoon burger craving', 'casual solo meal when you know exactly what you want', 'grabbing smash burgers for a movie night at home']
    },

    'impact-kitchen': {
      answerBlock: `Impact Kitchen on Atlantic Ave is where Liberty Village's fitness crowd refuels with macro-counted bowls, grass-fed burgers, and cold-pressed juices. Rated ${rating} stars, every dish lists its nutritional breakdown so you can stay on track without sacrificing flavour. Their weekly meal prep packages are a go-to for work-from-home professionals in the area.`,
      bestFor: ['post-workout meal with full macro info', 'healthy weekday lunch between meetings', 'weekly meal prep pickup for condo dwellers', 'guilt-free weekend brunch alternative']
    },

    'local-public-eatery': {
      answerBlock: `LOCAL Public Eatery on East Liberty St is the neighbourhood's top spot for watching sports over elevated pub food and craft beer. Rated ${rating} stars with over 900 reviews, the massive patio is one of Liberty Village's best warm-weather hangouts. Daily happy hour from 3 to 6pm offers $7 appetizers and discounted drafts.`,
      bestFor: ['after-work drinks with coworkers on the patio', 'watching Leafs or Raptors games with friends', 'weekend brunch with a Caesar bar', 'casual group dinner where nobody has to decide on a cuisine']
    },

    'school-restaurant': {
      answerBlock: `School on Fraser Ave occupies a beautifully restored 1890s schoolhouse with soaring ceilings and original chalkboards, creating one of the most atmospheric dining rooms in Toronto. Rated ${rating} stars, the creative Canadian menu with global influences and inventive cocktails make it a standout date night destination. The upstairs loft feels like a private dining room.`,
      bestFor: ['impressive date night in a heritage setting', 'anniversary or birthday dinner', 'weekend brunch in a one-of-a-kind space', 'cocktail-forward evening with inventive drinks']
    },

    'oeb-breakfast-co': {
      answerBlock: `OEB Breakfast Co. on East Liberty St brought its Calgary-born brunch cult to Liberty Village, and the neighbourhood hasn't looked back. Rated ${rating} stars, the Holy Smoked Meat Benedict and handcrafted crepes are made from scratch with premium ingredients. Use the online waitlist on weekends to skip standing in line outside.`,
      bestFor: ['weekend brunch worth waiting in line for', 'weekday breakfast meeting over premium eggs benny', 'treating yourself to a proper sit-down breakfast', 'brunch with visiting family who love food']
    },

    'brazen-head-irish-pub': {
      answerBlock: `Brazen Head on East Liberty St is the beating heart of Liberty Village pub culture, with a massive wraparound patio that's arguably the neighbourhood's best warm-weather spot. Rated ${rating} stars with over 1,100 reviews, the dark wood interior, Guinness on tap, and weekly trivia and live music nights keep the regulars coming back year after year.`,
      bestFor: ['Wednesday trivia night with your crew', 'sunny afternoon pints on the patio', 'watching a Premier League match with a Guinness', 'casual first date at a neighbourhood pub']
    },

    'moxies-liberty-village': {
      answerBlock: `Moxie's on East Liberty St is a polished casual dining spot with a crowd-pleasing menu covering everything from steaks to sushi rolls. Rated ${rating} stars, the sleek space and consistent service make it a reliable pick when your group can't agree on a cuisine. Half-price appetizers kick in after 9pm for a solid late-night option.`,
      bestFor: ['group dinner where nobody can decide what to eat', 'reliable lunch meeting with clients', 'late-night half-price appetizers after a show', 'casual family dinner with a varied menu']
    },

    // === BARS & ENTERTAINMENT ===
    'the-rec-room-liberty-village': {
      answerBlock: `The Rec Room on Lynn Williams St is a massive entertainment complex with arcade games, VR, live music, and multiple bars under one roof. Rated ${rating} stars with over 1,400 reviews, it's Liberty Village's go-to for group outings and celebrations. Double-credit Tuesdays make it the best value day for gaming, and weekends turn into a DJ-driven club scene.`,
      bestFor: ['birthday party with a big group', 'rainy Saturday with arcade games and drinks', 'team outing from the office', 'casual date with competitive games and cocktails']
    },

    // === BREWERIES ===
    'liberty-commons-big-rock-brewery': {
      answerBlock: `Liberty Commons at Big Rock Brewery on East Liberty St is a sprawling beer hall celebrating Liberty Village's manufacturing heritage with house-brewed craft beers and communal tables. Rated ${rating} stars, the rotating seasonal brews, wood-fired pizzas, and beer cheese pretzels make it ideal for big groups. Ask about the brewer's small-batch for something you won't find on the main menu.`,
      bestFor: ['Saturday afternoon beer flights with friends', 'group outing that needs communal seating', 'pairing wood-fired pizza with house-brewed craft beer', 'trying experimental small-batch brews']
    },

    'craft-beer-market-liberty-village': {
      answerBlock: `Craft Beer Market on Liberty St boasts over 100 taps of Canadian craft beer in a stunning converted warehouse with exposed brick and steel beams. Rated ${rating} stars with over 1,000 reviews, it's one of the most impressive beer bars in Toronto. The staff genuinely knows their beer and the upper mezzanine is the best spot during Leafs games.`,
      bestFor: ['exploring 100+ Canadian craft beers on tap', 'after-work drinks with beer-loving coworkers', 'Leafs game viewing with craft beer and sharing plates', 'impressing a beer enthusiast visiting from out of town']
    },

    'left-field-brewery': {
      answerBlock: `Left Field Brewery on Wagstaff Dr is a baseball-themed craft brewery tucked into the industrial south end of Liberty Village. Rated ${rating} stars, their Eephus oatmeal brown ale and Greenwood IPA are local staples, while seasonal small-batch releases keep regulars coming back. The patio fills fast on summer weekends with locals and craft beer pilgrims alike.`,
      bestFor: ['Saturday afternoon flight on the patio', 'discovering small-batch seasonal releases', 'casual hangout in an authentic taproom setting', 'taking home fresh cans of local craft beer']
    },

    // === PIZZA ===
    'pizza-libretto-liberty-village': {
      answerBlock: `Pizza Libretto on Liberty St serves VPN-certified Neapolitan pizza with a leopard-spotted crust that comes out of a 900-degree oven in under 90 seconds. Rated ${rating} stars, the Margherita is a masterclass in simplicity, and this location has a quieter neighbourhood feel than the busier downtown spots. Ask about the Nduja pizza for a spicy hidden gem.`,
      bestFor: ['quick weeknight dinner with outstanding pizza', 'casual dinner with kids who love pizza', 'date night over Neapolitan pizza and wine', 'takeout pizza that actually rivals dine-in quality']
    },

    // === THAI ===
    'pai-northern-thai': {
      answerBlock: `Pai Northern Thai Kitchen on East Liberty St is widely considered one of Toronto's best Thai restaurants, and the Liberty Village outpost matches the quality of the famous original. Rated ${rating} stars with over 1,500 reviews, the Khao Soi is a must-order — rich, coconut-y, and deeply satisfying. Expect a wait at peak hours because the reputation is well-earned.`,
      bestFor: ['best Thai food in Liberty Village, no contest', 'Khao Soi craving on a cold evening', 'dinner with someone who thinks they know Thai food', 'impressive yet affordable date night']
    },

    // === ITALIAN ===
    'cibo-liberty-village': {
      answerBlock: `Cibo Wine Bar on Liberty St brings Italian elegance to Liberty Village with refined pasta, thin-crust pizza, and an outstanding wine list. Rated ${rating} stars, the dark, moody atmosphere makes it one of the best date-night spots in the area. The Aperitivo hour from 4 to 6pm on weekdays offers half-price appetizers and $10 cocktails.`,
      bestFor: ['romantic date night with Italian wine', 'weekday Aperitivo hour with half-price bites', 'anniversary dinner without trekking downtown', 'girls\' night with pasta and cocktails']
    },

    // === COFFEE SHOPS ===
    'balzacs-coffee-liberty-village': {
      answerBlock: `Balzac's Coffee Roasters inside the heritage Liberty Market building on East Liberty St is the neighbourhood's unofficial living room. Rated ${rating} stars, the Parisian-inspired decor, excellent espresso, and ample seating make it perfect for remote workers and casual meetups. The back room near the windows is the quietest spot for getting real work done.`,
      bestFor: ['remote work session with reliable wifi', 'casual coffee meetup with a friend', 'quiet morning espresso before the crowds arrive', 'waiting for your Mildred\'s brunch table']
    },

    'louie-coffee-bar': {
      answerBlock: `Louie Coffee Bar on East Liberty St is a compact, design-forward spot that takes espresso seriously. Rated ${rating} stars, they pull shots using rotating single-origin beans and their lattes are consistently beautiful in both presentation and taste. The vibe is more grab-and-go, but a few window seats work for a quick break between errands.`,
      bestFor: ['quick high-quality espresso on the go', 'trying a rotating single-origin pour-over', 'monthly seasonal latte you won\'t find elsewhere', 'picking up coffee on your walk to the office']
    },

    'arvo-coffee': {
      answerBlock: `Arvo Coffee on Fraser Ave is a minimalist Australian-style coffee shop that nails the basics. Rated ${rating} stars, the flat whites and long blacks are exceptional, served in a bright, calm space with concrete floors and blonde wood. Their pastries and toasties are simple but excellent. Order the oat milk flat white — it's what the baristas drink themselves.`,
      bestFor: ['perfect flat white from an Aussie-style shop', 'quiet morning coffee away from the crowds', 'light pastry and espresso before a meeting', 'coffee purist who wants no fuss, just quality']
    },

    'dark-horse-espresso-liberty-village': {
      answerBlock: `Dark Horse Espresso on Liberty St has been a Toronto indie coffee institution for over a decade, and the Liberty Village outpost anchors the creative freelancer scene. Rated ${rating} stars, the strong espresso, generous portions, and plenty of power outlets make it the go-to for remote workers. The 24-hour cold brew in summer is smooth enough to drink black.`,
      bestFor: ['freelancer camp-out with reliable power outlets', 'strong no-nonsense espresso on a rainy morning', 'summer cold brew you can drink black', 'afternoon pick-me-up between client calls']
    },

    'jimmys-coffee-liberty-village': {
      answerBlock: `Jimmy's Coffee on Atlantic Ave is a beloved Toronto chainlet with rustic, lived-in charm that makes every location feel like your spot. Rated ${rating} stars, the morning drip coffee draws a loyal crowd, and the signature peanut butter cookie is legitimately one of the best cookies in Toronto. Get one before noon because they sell out most days.`,
      bestFor: ['morning drip coffee and the best cookie in LV', 'cozy weekend coffee in a neighbourhood institution', 'grabbing a bag of locally roasted beans', 'casual catch-up with a neighbour over coffee']
    },

    // === GYMS & FITNESS ===
    'goodlife-fitness-liberty-village': {
      answerBlock: `GoodLife Fitness on Jefferson Ave is one of the busiest locations in the chain, serving Liberty Village's young professional crowd. Rated ${rating} stars, the facility covers cardio, free weights, and group fitness classes and is walkable from virtually every condo in the area. Avoid the 5:30 to 7:30pm rush and hit the 6am or 8:30pm sweet spots instead.`,
      bestFor: ['convenient daily gym close to your condo', 'early morning workout before the office', 'drop-in group fitness class on a whim', 'straightforward gym membership without the premium price']
    },

    'f45-training-liberty-village': {
      answerBlock: `F45 Training on East Liberty St delivers signature 45-minute functional workouts that alternate between cardio and resistance circuits daily. Rated ${rating} stars, the coaches know members by name and the community vibe keeps people showing up at 6am. The early morning classes have the most consistent crew and the best energy in the neighbourhood.`,
      bestFor: ['structured morning workout with built-in accountability', 'breaking out of a solo gym routine', 'making gym friends through group training', 'high-intensity circuit training in 45 minutes flat']
    },

    'altea-active': {
      answerBlock: `Altea Active on Western Battery Rd feels more like a boutique hotel than a gym, with a massive workout floor, swimming pool, hot yoga studio, spa, and restaurant across multiple levels. Rated ${rating} stars, the premium membership price is steep but delivers a genuine luxury fitness experience. The rooftop pool is nearly empty on weekday mornings.`,
      bestFor: ['luxury gym experience with pool and spa access', 'hot yoga followed by a swim', 'weekday morning rooftop pool lap session', 'treating fitness as self-care, not just exercise']
    },

    'orangetheory-fitness-liberty-village': {
      answerBlock: `Orangetheory on East Liberty St brings heart-rate-based interval training to Liberty Village's tech-savvy crowd. Rated ${rating} stars, the one-hour classes mix treadmill, rowing, and floor work with real-time heart rate tracking on screens throughout the studio. Book popular time slots through the app exactly 24 hours ahead because they fill instantly.`,
      bestFor: ['data-driven workout with real-time heart rate tracking', 'structured cardio and strength in one session', 'breaking a fitness plateau with interval training', 'competitive workout where you can track improvement']
    },

    'movati-athletic-liberty-village': {
      answerBlock: `Movati Athletic on Lynn Williams St bridges the gap between a basic gym and a luxury club, offering a pool, hot yoga studio, and extensive group fitness schedule alongside a solid weight room. Rated ${rating} stars, it's the mid-premium sweet spot for people who want more than GoodLife without the Altea price tag. The saltwater pool is nearly empty at midday.`,
      bestFor: ['gym membership with pool access at a reasonable price', 'midday saltwater pool laps during the workweek', 'hot yoga and weight training under one roof', 'weekend group fitness classes with variety']
    },

    'studio-spin-liberty-village': {
      answerBlock: `SpinCo on East Liberty St delivers high-energy 45-minute indoor cycling classes set to curated playlists in a dark, club-like studio. Rated ${rating} stars, the bikes have performance metrics and a leaderboard for those who like to compete. Regulars know that bikes 3 and 17 have the smoothest resistance dials — book early to snag them.`,
      bestFor: ['high-energy cardio session with a killer playlist', 'competitive cycling with leaderboard tracking', 'morning spin class before the workday', 'workout that feels more like a party than exercise']
    },

    // === PILATES & BARRE ===
    'studio-lagree-liberty-village': {
      answerBlock: `Studio Lagree on Atlantic Ave uses the patented Megaformer machine for slow-burn, full-body workouts that will have your muscles shaking within minutes. Rated ${rating} stars, the 40-minute sessions combine Pilates, strength training, and cardio in a deceptively intense format. Instructors offer modifications for all fitness levels, making it accessible despite the intensity.`,
      bestFor: ['low-impact strength training that still challenges you', 'Pilates alternative with more resistance work', 'efficient 40-minute full-body workout', 'rebuilding strength after an injury with modifications']
    },

    'pure-barre-liberty-village': {
      answerBlock: `Pure Barre on East Liberty St offers low-impact, high-intensity barre classes combining ballet-inspired movements with strength training and stretching. Rated ${rating} stars, the 50-minute sessions focus on isometric holds and small-range movements that build lean strength. The supportive community makes it welcoming for beginners, but take the foundations class first.`,
      bestFor: ['ballet-inspired workout that builds lean muscle', 'low-impact fitness for joint-sensitive exercisers', 'consistent workout routine with a supportive community', 'complementing running or cycling with flexibility work']
    },

    // === YOGA ===
    'yoga-tree-liberty-village': {
      answerBlock: `Yoga Tree on Atlantic Ave offers classes from gentle restorative sessions to power vinyasa, led by some of the most experienced instructors in Toronto's yoga community. Rated ${rating} stars, the studio spaces are clean and well-maintained with quality props provided. The Sunday evening restorative class is the most underrated session on the schedule.`,
      bestFor: ['Sunday evening restorative yoga to reset before Monday', 'morning vinyasa flow to start the day', 'exploring different yoga styles under one roof', 'de-stressing after a long work week']
    },

    // === HAIR & GROOMING ===
    'bsuite-hair-salon': {
      answerBlock: `b.suite on Atlantic Ave is a modern suite-based salon where independent stylists rent private spaces, giving you one-on-one attention without the chaos of a traditional salon floor. Rated ${rating} stars, the best stylists have months-long wait lists. Check Instagram for each stylist's portfolio before booking because they all specialize in different techniques.`,
      bestFor: ['personalized haircut in a private suite', 'finding a colourist who specializes in your hair type', 'intimate salon experience without the noise', 'trying a new stylist based on their Instagram portfolio']
    },

    'baz-and-banks-barber': {
      answerBlock: `Baz & Banks on East Liberty St is a sharp, modern barbershop that elevates the neighbourhood haircut into a proper grooming experience. Rated ${rating} stars, the barbers are skilled with fades, tapers, and classic cuts, plus they offer hot towel shaves and beard grooming. Stick with one barber and they'll remember your preferences every visit.`,
      bestFor: ['clean fade or taper from a skilled barber', 'hot towel shave for a special occasion', 'regular grooming routine with a barber who knows your cut', 'beard trim and shaping by someone who cares']
    },

    'lavish-hair-studio': {
      answerBlock: `Lavish Hair Studio on Wade Ave at the edge of Liberty Village specializes in balayage and lived-in colour techniques that look natural and grow out gracefully. Rated ${rating} stars, the warm, personal atmosphere makes you feel like a regular from day one. Book a consultation before your first colour appointment so the stylists can see your hair in person.`,
      bestFor: ['balayage or lived-in colour that looks natural', 'keratin treatment to tame frizz', 'hair extensions consultation and install', 'finding a long-term colourist you trust']
    },

    // === NAILS ===
    'tips-and-toes-nail-salon': {
      answerBlock: `Tips & Toes on East Liberty St is a clean, friendly nail spa right in the heart of Liberty Village's retail strip. Rated ${rating} stars, they handle manicures, pedicures, and gel services at reasonable prices with quick turnaround that doesn't feel rushed. Tuesday is the quietest day for walk-ins when the technicians can take their time.`,
      bestFor: ['quick gel manicure during a lunch break', 'walk-in mani-pedi without an appointment', 'pre-event nail refresh at a fair price', 'Tuesday afternoon pampering when it\'s quiet']
    },

    // === PET SERVICES ===
    'liberty-village-animal-hospital': {
      answerBlock: `Liberty Village Animal Hospital on Hanna Ave is the neighbourhood's primary vet clinic, handling everything from routine check-ups to dental cleanings and minor surgeries. Rated ${rating} stars, the vets are compassionate and thorough in a neighbourhood with possibly Toronto's highest dog-per-capita ratio. Book annual visits in January when the schedule is lighter.`,
      bestFor: ['annual check-up and vaccinations for your dog', 'new pet registration with a neighbourhood vet', 'dental cleaning for your cat or dog', 'urgent vet visit with same-week availability']
    },

    'liberty-pooch': {
      answerBlock: `Liberty Pooch offers professional dog walking and pet sitting tailored to Liberty Village's condo-dwelling pups, with GPS-tracked small group walks through local parks. Rated ${rating} stars, they also provide puppy visits and overnight care for when you travel. A meet-and-greet walk matches your dog's temperament with the right group for a better fit.`,
      bestFor: ['weekday dog walking while you work from home or the office', 'pet sitting and overnight care during a weekend trip', 'socializing a new puppy with small group walks', 'reliable GPS-tracked walks so you know where your dog went']
    },

    'woofstock-pet-supplies': {
      answerBlock: `Woof & Whiskers on East Liberty St caters to Liberty Village's massive pet owner population with premium food brands, toys, treats, and Canadian-made products. Rated ${rating} stars, the staff are genuinely knowledgeable about pet nutrition and will help you find the right food for your pet's specific needs. Ask about auto-delivery to your condo lobby.`,
      bestFor: ['finding the right premium food for your pet\'s diet', 'stocking up on treats and toys on a weekend walk', 'getting expert pet nutrition advice in person', 'setting up monthly food auto-delivery to your condo']
    },

    'the-dog-house-grooming': {
      answerBlock: `The Dog House on Hanna Ave treats Liberty Village dogs like royalty, from basic baths to full breed-specific grooming with patience and premium, gentle products. Rated ${rating} stars, they handle even nervous or fidgety pups with care. Book a standalone nail trim first if your dog is anxious so they can get comfortable before a full grooming session.`,
      bestFor: ['full grooming session for your breed', 'quick bath and nail trim between groomings', 'first grooming experience for an anxious pup', 'regular grooming schedule with a trusted team']
    },

    // === DENTAL ===
    'liberty-village-dental': {
      answerBlock: `Liberty Village Dental on East Liberty St offers comprehensive care from cleanings to Invisalign in a modern office right in the main retail hub. Rated ${rating} stars with over 300 reviews, evening and Saturday appointments make it genuinely convenient for working professionals. Book the first slot of the day if you're nervous about the dentist.`,
      bestFor: ['evening or Saturday dental appointment that fits your schedule', 'Invisalign consultation close to home', 'routine cleaning with a gentle, patient team', 'anxious patient who needs a calm dental experience']
    },

    'edition-dental': {
      answerBlock: `Edition Dental on Jefferson Ave is a boutique dental practice focused on cosmetic and restorative work including veneers, whitening, and smile makeovers. Rated ${rating} stars, the spa-like office with calming interiors makes it feel nothing like a typical clinic. Their digital smile design shows you a preview of results before you commit to any cosmetic work.`,
      bestFor: ['veneer consultation with digital smile preview', 'professional teeth whitening for a special event', 'smile makeover with a boutique dental team', 'finding a dentist who treats the visit like a spa experience']
    },

    // === HEALTH & WELLNESS ===
    'liberty-village-physio': {
      answerBlock: `Liberty Village Physiotherapy on Atlantic Ave handles sports injuries, post-surgical rehab, and chronic pain with personalized treatment plans rather than cookie-cutter exercises. Rated ${rating} stars, the registered physiotherapists also offer acupuncture and shockwave therapy. Early morning slots get the longest, most thorough sessions before the schedule stacks up.`,
      bestFor: ['sports injury rehab with a personalized plan', 'post-surgery recovery with hands-on treatment', 'chronic back or neck pain from desk work', 'acupuncture or shockwave therapy for stubborn pain']
    },

    'liberty-village-chiropractic': {
      answerBlock: `Liberty Village Chiropractic on Atlantic Ave provides evidence-based care focused on desk workers and athletes, the two dominant populations in the neighbourhood. Rated ${rating} stars, treatments combine spinal adjustments with soft tissue work and corrective exercises. Mention you work at a desk and they'll include a free ergonomic workstation assessment with your first visit.`,
      bestFor: ['desk-worker back pain relief with ergonomic advice', 'athlete recovery with evidence-based adjustments', 'direct-billing chiropractic that takes your insurance hassle-free', 'free ergonomic assessment with your first appointment']
    },

    'liberty-village-massage-therapy': {
      answerBlock: `Myodetox on East Liberty St combines registered massage therapy with movement assessment and corrective exercise to find the root cause of pain rather than just treating symptoms. Rated ${rating} stars, the sleek, professional clinic is a far cry from a dimly lit spa experience. Book a 60-minute assessment for your first visit to make every future session more targeted.`,
      bestFor: ['therapeutic massage focused on fixing the root problem', 'sports massage for active Liberty Village residents', 'first-visit movement assessment for chronic tightness', 'direct-billing RMT that works with most insurance']
    },

    'liberty-village-family-medicine': {
      answerBlock: `The Liberty Village Family Health Team on Atlantic Ave is a multidisciplinary clinic offering family medicine, mental health counseling, and dietitian services under one roof. Rated ${rating} stars, they provide continuity of care that walk-in clinics can't match. Call the first Monday of each month about new patient intake — spots open in batches and fill within days.`,
      bestFor: ['finding a family doctor actually accepting new patients', 'same-day urgent appointment with your own doctor', 'mental health counseling covered by OHIP', 'multidisciplinary care with a dietitian on site']
    },

    // === BAKERY ===
    'sweet-flour-bake-shop': {
      answerBlock: `Sweet Flour Bake Shop on East Liberty St is a charming from-scratch bakery known for flaky butter tarts, seasonal pies, and beautifully decorated custom cakes, all baked in small batches daily. Rated ${rating} stars, locals pre-order holiday pies weeks in advance because they cap orders and sell out every year. The butter tart alone justifies a visit.`,
      bestFor: ['picking up the best butter tart in Liberty Village', 'pre-ordering a custom cake for a birthday or event', 'holiday pie order placed weeks in advance', 'Saturday morning pastry run on your weekend walk']
    },

    // === COWORKING ===
    'spaces-liberty-village': {
      answerBlock: `Spaces on East Liberty St is a premium flexible workspace from IWG with private offices, dedicated desks, and hot-desking in a modern, airy design above the retail strip. Rated ${rating} stars, the rooftop patio and in-house cafe elevate it beyond typical coworking. Try a free day pass before committing because the energy shifts dramatically between Monday and Friday.`,
      bestFor: ['premium coworking with rooftop patio access', 'private office for a growing startup team', 'professional meeting room for client presentations', 'day pass to test coworking before committing']
    },

    'the-fueling-station': {
      answerBlock: `The Fueling Station on Fraser Ave is a community-focused coworking space in a converted warehouse that caters to freelancers, startups, and small creative agencies. Rated ${rating} stars, the exposed brick, communal kitchen, and regular networking events create genuine character that corporate coworking chains can't replicate. Attend a community dinner before signing up.`,
      bestFor: ['freelancer looking for community, not just a desk', 'creative agency needing warehouse-style office space', 'networking with other startups over monthly community dinners', 'affordable coworking alternative to WeWork or Spaces']
    },

    'wework-liberty-village': {
      answerBlock: `WeWork on Atlantic Ave occupies a beautifully converted heritage building blending exposed brick character with polished, Instagram-ready interiors. Rated ${rating} stars, it draws a mix of tech startups and remote workers with private offices, dedicated desks, and craft beer on tap. The top floor common area has the best natural light and fewest people.`,
      bestFor: ['well-known coworking brand with reliable amenities', 'tech startup needing flexible office space', 'remote worker wanting a change from home or coffee shops', 'heritage building workspace with modern perks']
    },

    // === GROCERY & PHARMACY ===
    'freshco-liberty-village': {
      answerBlock: `FreshCo on East Liberty St is Liberty Village's most convenient full-service grocery store with noticeably lower prices than nearby specialty shops. Rated ${rating} stars, the produce section is surprisingly good for a discount grocer. Shop before 10am on weekdays to avoid the cramped aisles because this store serves the entire neighbourhood and it shows during peak hours.`,
      bestFor: ['affordable weekly grocery run without leaving LV', 'quick produce and essentials pickup', 'early morning shopping to avoid the crowds', 'budget-conscious groceries in a pricey neighbourhood']
    },

    'shoppers-drug-mart-liberty-village': {
      answerBlock: `Shoppers Drug Mart on East Liberty St is the neighbourhood's primary pharmacy with extended hours that are a lifesaver when everything else closes. Rated ${rating} stars, the pharmacy team is efficient and they carry the usual cosmetics and household essentials. Time bigger purchases for weekend Optimum points promotions with 20x points events for maximum value.`,
      bestFor: ['late-evening prescription pickup after work', 'stocking up on essentials during 20x Optimum points events', 'quick cosmetics or household item run', 'pharmacy with extended hours when you need something urgently']
    },

    'rexall-liberty-village': {
      answerBlock: `Rexall Pharmacy on East Liberty St provides a second pharmacy option in Liberty Village that's convenient for residents on the west side of the neighbourhood. Rated ${rating} stars, the pharmacy team is friendly, handles transfers smoothly, and is consistently less busy than the Shoppers location. A solid alternative when shorter wait times matter to you.`,
      bestFor: ['prescription transfer for shorter wait times', 'west-side pharmacy closer to your condo', 'quick over-the-counter medication pickup', 'friendly pharmacist who takes time to explain your medication']
    },

    // === DRY CLEANING ===
    'king-west-dry-cleaners': {
      answerBlock: `King West Dry Cleaners on Lynn Williams St handles suits, dress shirts, and delicates with consistent quality and offers same-day service if you drop off before 10am. Rated ${rating} stars, their alterations team is skilled with everything from hemming to complex tailoring. Set up weekly pickup and delivery to your condo for a 15% recurring order discount.`,
      bestFor: ['same-day dry cleaning for tomorrow\'s presentation', 'recurring weekly shirt service with condo delivery', 'suit alterations and tailoring done right', 'move-in deep clean of curtains and bedding']
    },

    // === BANKING ===
    'scotiabank-liberty-village': {
      answerBlock: `Scotiabank on East Liberty St is the most convenient full-service bank in Liberty Village with a 24/7 ATM and personal banking, mortgage, and investment services. Rated ${rating} stars, it matters more than you'd think when the nearest alternative is a trek to King Street. Skip the branch for routine transactions and save in-person visits for mortgage or investment consultations.`,
      bestFor: ['mortgage consultation with a neighbourhood advisor', 'quick 24/7 ATM access in Liberty Village', 'opening an investment account close to home', 'in-person banking when the app won\'t do']
    },

    'liberty-village-rbc': {
      answerBlock: `RBC Royal Bank on East Liberty St provides full personal and small business banking with modern facilities and well-trained advisors. Rated ${rating} stars, the branch handles mortgage applications, investment accounts, and everyday banking. Book mortgage appointments for Tuesday or Wednesday mornings when advisors have more time to find you the best rate.`,
      bestFor: ['mortgage pre-approval close to home', 'small business banking for your LV startup', 'investment account review with an advisor', 'Tuesday morning mortgage appointment for unhurried service']
    },

    // === OPTOMETRY ===
    'liberty-village-optometry': {
      answerBlock: `Liberty Village Optometry on East Liberty St provides comprehensive eye exams, contact lens fittings, and a curated selection of independent designer frames you won't find at chain optical stores. Rated ${rating} stars, the optometrists use modern diagnostic equipment and take time to explain their findings. They direct-bill insurance so there are no surprises at checkout.`,
      bestFor: ['annual eye exam with modern diagnostic equipment', 'finding trendy independent frames not sold at chains', 'contact lens fitting or prescription update', 'insurance direct-billing with no out-of-pocket surprises']
    },

    'benchmark-optometry': {
      answerBlock: `BenchMark Optometry on Atlantic Ave combines thorough eye health assessments using retinal imaging technology with a curated frame shop stocking independent eyewear brands. Rated ${rating} stars, the staff help you find styles that actually suit your face shape. Tell them your insurance budget upfront and they'll steer you to brands that maximize your coverage.`,
      bestFor: ['comprehensive eye exam with retinal imaging', 'shopping independent eyewear brands with expert styling help', 'maximizing your insurance frame coverage', 'upgrading from chain-store glasses to something with character']
    },

    // === PERSONAL TRAINING ===
    'personal-training-liberty-village': {
      answerBlock: `Precision Athletics on Hanna Ave is a private training studio offering one-on-one and small group sessions with individualized programs built on thorough assessments. Rated ${rating} stars, the coaches focus on progressive overload and measurable results in a well-equipped space free from commercial gym distractions. Commit to at least 8 sessions to see real results.`,
      bestFor: ['one-on-one training with a tailored program', 'breaking through a strength plateau with expert coaching', 'returning to fitness after time off with proper assessment', 'small group training with friends who share your goals']
    },

    // === REAL ESTATE ===
    'real-estate-liberty-village': {
      answerBlock: `The Liberty Village Real Estate Team on Atlantic Ave specializes exclusively in neighbourhood condos with intimate knowledge of every building, floor plan, and maintenance fee. Rated ${rating} stars, they know micro-market trends that generalist agents miss. Ask about which buildings have upcoming special assessments — that insider knowledge alone can save you tens of thousands.`,
      bestFor: ['buying your first condo in Liberty Village', 'selling your LV condo with a neighbourhood specialist', 'free no-pressure home evaluation', 'getting insider intel on building special assessments']
    },

    // === BIKE SHOP ===
    'bike-share-liberty-village': {
      answerBlock: `Sweet Pete's on East Liberty St is a full-service bike shop with new and used sales, expert repairs, and seasonal tune-ups from mechanics who are honest about what your bike actually needs. Rated ${rating} stars, they also stock urban cycling accessories suited to condo living. Bring your bike in for a March tune-up before the April rush stretches wait times past a week.`,
      bestFor: ['spring tune-up before cycling season starts', 'buying a commuter bike suited for condo storage', 'honest repair diagnosis without the upsell', 'picking up locks and urban cycling gear']
    },

    // === ACCOUNTING ===
    'liberty-village-accounting': {
      answerBlock: `Blueprint Accounting on Atlantic Ave serves Liberty Village's freelancers, small businesses, and incorporated professionals with year-round tax planning and bookkeeping. Rated ${rating} stars, they specialize in the tech startup and creative professional demographics that fill the neighbourhood. Reach out in January for tax prep instead of waiting for the March crunch.`,
      bestFor: ['freelancer tax planning and quarterly check-ins', 'startup bookkeeping with cloud-based tools', 'incorporated professional year-end tax filing', 'proactive January tax prep before the spring rush']
    },

    // === DAYCARE ===
    'liberty-village-daycare': {
      answerBlock: `Liberty Village Child Care Centre on Western Battery Rd provides licensed play-based daycare for infants through preschool age in a purpose-built facility. Rated ${rating} stars, the curriculum focuses on social-emotional development with structured learning and outdoor time. Get on the waitlist the moment you're expecting because the wait can stretch 12 to 18 months.`,
      bestFor: ['licensed infant and toddler daycare in LV', 'play-based preschool program with outdoor time', 'new parents who need to join a waitlist early', 'walkable daycare for Liberty Village families']
    },

    // === CATERING ===
    'caterers-liberty-village': {
      answerBlock: `Feast Catering Co. on Hanna Ave operates out of a commercial kitchen in the warehouse district and specializes in corporate catering for Liberty Village's tech offices and creative agencies. Rated ${rating} stars, their custom menus go well beyond the usual sandwich platter. Order by 10am the day before and ask about the weekly rotating menu to keep your team happy.`,
      bestFor: ['weekly office lunch catering that avoids menu fatigue', 'corporate event catering with custom menus', 'team celebration lunch delivered to your office', 'holiday party catering for a Liberty Village company']
    },

    // === EVENT SPACE ===
    'event-space-liberty-village': {
      answerBlock: `Artscape Youngplace on Shaw St is a stunning multi-purpose arts facility in a converted school building on the border of Liberty Village. Rated ${rating} stars, the gallery spaces and performance hall host everything from art exhibitions and product launches to weddings. The heritage architecture provides a dramatic backdrop that requires minimal additional decor.`,
      bestFor: ['wedding venue with dramatic heritage architecture', 'product launch or corporate event space', 'art exhibition in a converted schoolhouse gallery', 'winter event with beautiful natural afternoon light']
    },

    // === SUSHI ===
    'sushi-liberty-village': {
      answerBlock: `Miku Toronto on Bay St near the waterfront is the closest premium sushi experience to Liberty Village and worth the short trip. Rated ${rating} stars with over 1,800 reviews, their signature aburi flame-seared sushi is a Vancouver import that's become a Toronto staple. The waterfront views and elevated atmosphere make it a genuine splurge-worthy destination.`,
      bestFor: ['special occasion sushi dinner with waterfront views', 'trying aburi flame-seared sushi for the first time', 'anniversary or birthday splurge meal', 'impressing a client with Toronto\'s best Japanese cuisine']
    },

    // === MUSIC LESSONS ===
    'music-lessons-liberty-village': {
      answerBlock: `Liberty Village Music School on Atlantic Ave offers private lessons in guitar, piano, drums, and voice for kids and adults at all levels, taught by working musicians. Rated ${rating} stars, the soundproofed studios and flexible scheduling work around irregular hours. Book a trial lesson first because instructor fit is everything when it comes to sticking with music.`,
      bestFor: ['adult beginner guitar or piano lessons', 'kids\' music lessons with flexible scheduling', 'finding a voice coach who is also a working musician', 'trial lesson to find the right instructor match']
    },

    // === FLORIST ===
    'florist-liberty-village': {
      answerBlock: `Tonic Blooms on Atlantic Ave is a boutique florist creating lush, modern arrangements with locally sourced and seasonal flowers. Rated ${rating} stars, their romantic, textural style featuring garden roses and ranunculus makes them popular for weddings in Liberty Village gallery spaces. Subscribe to their weekly flower delivery for a better per-arrangement price.`,
      bestFor: ['weekly fresh flower subscription for your home', 'wedding flowers with a romantic, textural style', 'same-day bouquet for an anniversary or apology', 'seasonal arrangement as a housewarming gift']
    },

    // === HOUSE CLEANING ===
    'cleaning-liberty-village': {
      answerBlock: `Mopify is a Toronto-based cleaning service popular with Liberty Village condo dwellers for its easy online booking and transparent pricing based on condo size. Rated ${rating} stars, their vetted cleaners handle weekly tidying, deep cleans, and move-in/move-out services with no hidden fees. Book recurring biweekly cleans for priority scheduling over one-off bookings.`,
      bestFor: ['biweekly condo cleaning with online booking', 'move-in or move-out deep clean', 'spring deep clean of your Liberty Village unit', 'reliable recurring cleaning with priority scheduling']
    },

    // === SHORT-TERM RENTALS ===
    'modern-liberty-village-townhouse': {
      answerBlock: `This modern two-storey townhouse in the heart of Liberty Village features a fully equipped kitchen, open-concept living, private rooftop patio, and dedicated workspace. Rated ${rating} stars with over 125 reviews, it's steps from the best restaurants, coffee shops, and the King streetcar. The local host has excellent neighbourhood recommendations if you just ask.`,
      bestFor: ['weekend Toronto trip with a home-like base', 'remote work month-stay with dedicated workspace and rooftop', 'couple\'s getaway steps from Liberty Village restaurants', 'family visit needing a full kitchen and multiple levels']
    },

    'liberty-village-loft-free-parking': {
      answerBlock: `This bright open-concept loft with free parking — a rare perk in Liberty Village — features exposed brick, high ceilings, and a comfortable queen bed on a quiet street. Rated ${rating} stars, it's a short walk to East Liberty restaurants and the 504 streetcar. The included parking spot is a major deal, especially on TFC and Argos game days when street parking disappears.`,
      bestFor: ['road trip to Toronto needing free parking', 'TFC or Argos game weekend with hassle-free parking', 'loft-style stay with industrial Liberty Village character', 'couple\'s getaway who want to drive around Toronto']
    },

    'chic-1br-loft-townhouse-liberty-village': {
      answerBlock: `This stylish one-bedroom loft townhouse has soaring ceilings and a mezzanine sleeping area that makes it feel much larger than a typical one-bedroom rental. Rated ${rating} stars, the fully stocked kitchen and cozy sectional are perfect for unwinding after exploring Toronto. Walking distance to Liberty Village's best brunch spots and nightlife.`,
      bestFor: ['couple\'s weekend exploring Toronto\'s west end', 'solo traveller wanting more character than a hotel', 'stylish base for a long weekend of eating and drinking in LV', 'Airbnb with a loft layout that actually feels spacious']
    },

    'liberty-village-bmo-field-roof-patio': {
      answerBlock: `This well-located suite near BMO Field includes a shared rooftop patio and parking, making it perfect for sports fans visiting for TFC, Argos, or Exhibition Place events. Rated ${rating} stars, the clean, modern space has everything you need for a comfortable game-day stay. Walk to BMO Field in under 10 minutes and skip the parking nightmare entirely.`,
      bestFor: ['BMO Field game stay with walkable stadium access', 'Exhibition Place event weekend with parking included', 'TFC match trip with rooftop pre-game hangout', 'budget-friendly sports fan accommodation near the stadium']
    },

    'spacious-private-townhouse-loft-lv': {
      answerBlock: `This spacious multi-level townhouse loft with two bedrooms and a separate living area offers plenty of room to spread out for small groups or families visiting Toronto. Rated ${rating} stars, it's walking distance to grocery stores, cafes, and the streetcar line. The extra space makes it a far better option than cramming everyone into a hotel room.`,
      bestFor: ['family visit to Toronto needing space for kids', 'small group trip with separate sleeping areas', 'extended stay where you need room to spread out', 'visiting Toronto with grandparents who need their own bedroom']
    },

    'prime-location-stylish-lv-townhouse': {
      answerBlock: `This thoughtfully decorated townhouse sits in a prime Liberty Village location close to all the action on East Liberty Street. Rated ${rating} stars, the host provides a local guidebook with genuinely good restaurant and coffee shop recommendations you won't find on Google. Clean, well-maintained, and designed with a visitor's comfort in mind.`,
      bestFor: ['first-time Toronto visitor wanting local insider tips', 'weekend getaway in a stylish, well-located townhouse', 'business trip with a more personal feel than a hotel', 'exploring Liberty Village from the best possible location']
    },

    'downtown-toronto-condo-liberty-village': {
      answerBlock: `This compact but comfortable condo in a modern Liberty Village building comes with building amenities including a gym and rooftop terrace. Rated ${rating} stars, it's an affordable base for exploring Toronto's west end with the King streetcar right nearby for quick trips downtown. The building gym saves you from needing a day pass elsewhere.`,
      bestFor: ['budget-friendly Toronto stay with building amenities', 'solo traveller needing an affordable, clean base', 'remote work trip with gym access and transit nearby', 'short Toronto visit where you just need a good home base']
    },

    'apartment-in-liberty-village': {
      answerBlock: `This straightforward apartment in Liberty Village is a no-frills rental where everything is clean and functional with good transit access via the nearby King streetcar. Rated ${rating} stars, it's a short walk to local restaurants and shops. A solid option when you plan to spend most of your time out exploring Toronto and just need a reliable place to sleep.`,
      bestFor: ['budget Toronto trip focused on exploring, not the rental', 'solo traveller who values clean and functional over fancy', 'last-minute Toronto booking at a fair price', 'transit-accessible base for getting around the city']
    }
  };

  return data[slug] || null;
}

function main() {
  console.log('Reading businesses.json...');
  const raw = fs.readFileSync(BUSINESSES_PATH, 'utf-8');
  const businesses = JSON.parse(raw);
  console.log(`Found ${businesses.length} businesses.\n`);

  let errors = [];
  let successCount = 0;

  for (const biz of businesses) {
    const aeo = generateAEO(biz);

    if (!aeo) {
      errors.push(`[MISSING] No AEO data generated for: ${biz.slug}`);
      continue;
    }

    biz.answerBlock = aeo.answerBlock;
    biz.bestFor = aeo.bestFor;

    // Validate
    const wc = wordCount(aeo.answerBlock);
    if (wc < 40 || wc > 65) {
      errors.push(`[WORD COUNT] ${biz.slug}: answerBlock has ${wc} words (expected 40-65)`);
    }

    const bfLen = aeo.bestFor.length;
    if (bfLen < 3 || bfLen > 5) {
      errors.push(`[BESTFOR COUNT] ${biz.slug}: bestFor has ${bfLen} items (expected 3-5)`);
    }

    successCount++;
  }

  // Write back
  console.log('Writing updated businesses.json...');
  fs.writeFileSync(BUSINESSES_PATH, JSON.stringify(businesses, null, 2) + '\n', 'utf-8');
  console.log('Done.\n');

  // Validation summary
  console.log('=== VALIDATION RESULTS ===');
  console.log(`Total businesses: ${businesses.length}`);
  console.log(`Successfully processed: ${successCount}`);
  console.log(`Issues found: ${errors.length}`);

  if (errors.length > 0) {
    console.log('\nIssues:');
    for (const err of errors) {
      console.log(`  ${err}`);
    }
  } else {
    console.log('\nAll businesses passed validation!');
  }

  // Print word count details
  console.log('\n=== WORD COUNT DETAILS ===');
  for (const biz of businesses) {
    if (biz.answerBlock) {
      const wc = wordCount(biz.answerBlock);
      const status = (wc >= 40 && wc <= 65) ? 'OK' : 'WARN';
      console.log(`  [${status}] ${biz.slug}: ${wc} words, ${biz.bestFor.length} bestFor items`);
    }
  }

  // Validate JSON roundtrip
  console.log('\n=== JSON VALIDATION ===');
  try {
    const reRead = fs.readFileSync(BUSINESSES_PATH, 'utf-8');
    const reParsed = JSON.parse(reRead);
    console.log(`JSON is valid. ${reParsed.length} businesses parsed successfully.`);

    // Check all have the new fields
    const missing = reParsed.filter(b => !b.answerBlock || !b.bestFor);
    if (missing.length > 0) {
      console.log(`WARNING: ${missing.length} businesses still missing AEO fields:`);
      missing.forEach(b => console.log(`  - ${b.slug}`));
    } else {
      console.log('All businesses have answerBlock and bestFor fields.');
    }
  } catch (e) {
    console.error('JSON VALIDATION FAILED:', e.message);
  }
}

main();
