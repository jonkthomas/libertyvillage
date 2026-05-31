/**
 * generate-service-faqs.js
 *
 * Generates specificFaqs for ALL 60 services in services.json.
 * - Uses real business names from businesses.json where available
 * - Copies existing hardcoded FAQs for restaurants, dentists, gyms, short-term-rentals
 * - Writes localized, "People Also Ask"-style FAQs for every other service
 * - Validates: no generic questions, answers 30-65 words
 */

const fs = require("fs");
const path = require("path");

const servicesPath = path.join(__dirname, "..", "data", "services.json");
const businessesPath = path.join(__dirname, "..", "data", "businesses.json");

const services = JSON.parse(fs.readFileSync(servicesPath, "utf8"));
const businesses = JSON.parse(fs.readFileSync(businessesPath, "utf8"));

// Build category -> business names map
const bizByCategory = {};
businesses.forEach((b) => {
  if (!bizByCategory[b.category]) bizByCategory[b.category] = [];
  bizByCategory[b.category].push(b);
});

// ============================================================
// FAQ DATA FOR ALL 60 SERVICES
// ============================================================

const allFaqs = {
  // --- 4 EXISTING HARDCODED FAQ SERVICES (copied from page.tsx) ---
  restaurants: [
    {
      question: "What are the best restaurants in Liberty Village?",
      answer:
        "Liberty Village has a diverse dining scene with standouts like Mildred's Temple Kitchen for brunch, School Restaurant for date nights in a restored 1890s schoolhouse, Impact Kitchen for healthy bowls on Atlantic Ave, and LOCAL Public Eatery for pub food and craft beer on East Liberty.",
    },
    {
      question: "Are there good patio restaurants in Liberty Village?",
      answer:
        "Yes, Liberty Village has excellent patios. Liberty Commons at Big Rock Brewery and Brazen Head Irish Pub have the largest ones. LOCAL Public Eatery's patio fills up fast on summer evenings along East Liberty. Most patios open from May through October, weather permitting.",
    },
    {
      question: "What's the best brunch spot in Liberty Village?",
      answer:
        "Mildred's Temple Kitchen at 85 Hanna Ave is the iconic Liberty Village brunch destination, famous for blueberry buttermilk pancakes since 2004. OEB Breakfast Co. on East Liberty is another top pick with shorter waits if you use their online waitlist system.",
    },
    {
      question: "Are there late-night restaurants in Liberty Village?",
      answer:
        "Several spots serve food late. Brazen Head Irish Pub is open until 2am with a full pub menu. The Rec Room on Lynn Williams St serves food until midnight or later on weekends. Moxie's late-night menu kicks in after 9pm with half-price appetizers.",
    },
  ],

  dentists: [
    {
      question: "How much does a dental cleaning cost in Liberty Village?",
      answer:
        "Standard cleanings at Liberty Village dental offices run $200-350 without insurance. Liberty Village Dental on East Liberty and Edition Dental on Jefferson Ave both accept major insurance plans with direct billing, so you may pay nothing out of pocket depending on your coverage.",
    },
    {
      question: "Are there emergency dentists in Liberty Village?",
      answer:
        "Liberty Village Dental at 171 East Liberty St accommodates same-day emergency appointments during business hours, open Monday through Saturday. Edition Dental on Jefferson Ave also handles urgent cases. For after-hours emergencies, the nearest option is the dental ER at Toronto Western Hospital.",
    },
    {
      question: "Do Liberty Village dentists offer weekend hours?",
      answer:
        "Yes. Liberty Village Dental offers Saturday hours from 9am to 3pm, and Edition Dental has Saturday appointments from 10am to 3pm. Sunday availability is rare in the neighbourhood, so book Saturday slots early as they fill quickly, especially for family appointments.",
    },
    {
      question: "Do Liberty Village dentists accept walk-ins?",
      answer:
        "Liberty Village Dental sometimes accepts walk-ins for urgent issues depending on the day's schedule, but appointments are strongly recommended. Edition Dental is appointment-only. Call ahead in the morning for the best chance at a same-day slot at either clinic.",
    },
  ],

  gyms: [
    {
      question: "How much do gyms cost in Liberty Village?",
      answer:
        "Gym memberships range widely. GoodLife Fitness starts around $30-50 per month for basic access. Movati Athletic runs $60-80 monthly with pool access. Premium Altea Active on Western Battery Rd costs $150-200 per month but includes a pool, spa, hot yoga studio, and restaurant.",
    },
    {
      question: "Are there 24-hour gyms in Liberty Village?",
      answer:
        "GoodLife Fitness on Jefferson Ave has the longest hours, open from 5am to 11pm on weekdays. Movati Athletic on Lynn Williams St has similar extended hours. For true 24/7 access, the nearest options are just outside the neighbourhood on King Street West.",
    },
    {
      question: "What fitness classes are available in Liberty Village?",
      answer:
        "Liberty Village has excellent variety. F45 Training on East Liberty offers functional HIIT classes. Studio Lagree on Atlantic Ave specializes in Megaformer Pilates. Orangetheory delivers heart-rate interval training, and SpinCo runs high-energy cycling classes. Most studios offer free trial classes for newcomers.",
    },
    {
      question: "Are there outdoor fitness options in Liberty Village?",
      answer:
        "Lamport Stadium Park is popular for outdoor workouts and has a running track. The rail corridor trail is great for jogging. Precision Athletics on Hanna Ave runs outdoor boot camps in warmer months, and several personal trainers offer sessions in local parks and condo courtyards.",
    },
  ],

  "short-term-rentals": [
    {
      question: "How much do Airbnbs cost in Liberty Village?",
      answer:
        "Nightly rates in Liberty Village range from $80-130 for studios and budget apartments to $150-250 for townhouses with multiple bedrooms. Prices peak during summer months and TFC game weekends at BMO Field. Most listings include WiFi, kitchen access, and self check-in.",
    },
    {
      question: "Is Liberty Village a safe neighbourhood for Airbnb guests?",
      answer:
        "Yes. Liberty Village is a safe, well-lit residential neighbourhood popular with young professionals. The streets are active day and evening, with restaurants and shops along East Liberty Street and King Street West. The area has a strong community feel with standard big-city precautions.",
    },
    {
      question: "What is the best Airbnb in Liberty Village?",
      answer:
        "The Modern Liberty Village Townhouse consistently ranks as the top-rated short-term rental with a 4.9 rating and 127 reviews. It offers a private rooftop patio, dedicated workspace, and is steps from the best restaurants and the King streetcar line.",
    },
    {
      question:
        "Can I walk to BMO Field from Liberty Village Airbnbs?",
      answer:
        "Yes. Most Liberty Village rentals are within a 5-15 minute walk of BMO Field, home to Toronto FC and the Toronto Argonauts. The Liberty Village Suite near BMO Field is specifically located for game-day convenience, eliminating downtown traffic and expensive event parking.",
    },
    {
      question:
        "Do Liberty Village Airbnbs include parking?",
      answer:
        "Some do. The Liberty Village Loft with Free Parking includes a dedicated spot, which is a significant perk given the area's limited street parking. The Liberty Village Suite also offers parking. Always confirm parking availability with your host before booking, especially on game days.",
    },
  ],

  // --- ALL OTHER SERVICES ---

  "coffee-shops": [
    {
      question: "What are the best coffee shops in Liberty Village for remote work?",
      answer:
        "Balzac's Coffee Roasters in the Liberty Market building is the neighbourhood's top laptop-friendly cafe with ample seating and great espresso. Dark Horse Espresso Bar on Liberty St has plenty of power outlets and strong WiFi. Jimmy's Coffee on Atlantic Ave is cozier but equally work-friendly.",
    },
    {
      question: "Are there specialty coffee shops in Liberty Village?",
      answer:
        "Yes. Arvo Coffee on Fraser Ave serves Australian-style flat whites with single-origin beans. Louie Coffee Bar on East Liberty pulls rotating single-origin espresso with beautiful latte art. Dark Horse Espresso is an established Toronto indie roaster with a loyal local following.",
    },
    {
      question: "What time do Liberty Village coffee shops open?",
      answer:
        "Most open early for the commuter crowd. Balzac's and Dark Horse Espresso open at 7am weekdays. Jimmy's Coffee on Atlantic Ave also opens at 7am. Arvo Coffee opens at 7:30am. Weekend hours typically start an hour later, around 8am to 8:30am across the neighbourhood.",
    },
    {
      question: "How much does coffee cost in Liberty Village?",
      answer:
        "Expect to pay $4-6 for a latte or specialty drink at most Liberty Village cafes. Drip coffee runs $2.50-4 depending on the shop. Jimmy's Coffee and Dark Horse tend to be slightly cheaper than Balzac's, and Arvo's pricing is mid-range for the quality you get.",
    },
  ],

  "brunch-spots": [
    {
      question: "Do Liberty Village brunch spots take reservations?",
      answer:
        "Most do not take weekend brunch reservations. OEB Breakfast Co. on East Liberty offers an online waitlist so you can add your name from home and arrive when your table is ready. Mildred's Temple Kitchen on Hanna Ave is first-come-first-served, and lines start forming by 10am on Saturdays.",
    },
    {
      question: "How long is the wait for brunch in Liberty Village?",
      answer:
        "Peak weekend waits can hit 30-60 minutes at popular spots. Mildred's Temple Kitchen gets packed by 10:30am on Saturdays. OEB Breakfast Co. has shorter effective waits if you use their app waitlist. Arriving before 10am at either spot cuts wait times significantly.",
    },
    {
      question: "What's the most affordable brunch in Liberty Village?",
      answer:
        "OEB Breakfast Co. offers filling breakfast plates starting around $16-20. LOCAL Public Eatery has a solid weekend brunch with Caesar bar and mains from $15. For the cheapest morning meal, grab a pastry and coffee combo from Sweet Flour Bake Shop for under $10.",
    },
    {
      question: "Are there weekday brunch options in Liberty Village?",
      answer:
        "OEB Breakfast Co. serves their full breakfast menu Monday through Friday from 7am to 3pm. Mildred's Temple Kitchen runs a lunch menu on weekdays but saves brunch for weekends only. Impact Kitchen on Atlantic Ave serves all-day breakfast bowls that fill the weekday brunch gap.",
    },
  ],

  bars: [
    {
      question: "What are the best bars in Liberty Village for craft beer?",
      answer:
        "Craft Beer Market at 1 Liberty St has over 100 taps of Canadian craft beer in a converted warehouse. Liberty Commons at Big Rock Brewery serves house-brewed craft beer with a beer hall atmosphere. Left Field Brewery on Wagstaff Dr is a must-visit taproom for serious beer drinkers.",
    },
    {
      question: "Are there trivia nights at Liberty Village bars?",
      answer:
        "Brazen Head Irish Pub on East Liberty hosts popular Wednesday trivia nights starting at 7pm. It is the best free entertainment in the neighbourhood and teams form early, so arrive by 6:30pm to claim a good table. Craft Beer Market also runs occasional trivia events.",
    },
    {
      question: "Which Liberty Village bars have the best patios?",
      answer:
        "Brazen Head Irish Pub has arguably the best wraparound patio in the neighbourhood. Craft Beer Market's upper mezzanine offers great atmosphere during sports games. The Rec Room on Lynn Williams St has an outdoor area that gets busy on summer weekends with DJs.",
    },
    {
      question: "Are there bars open late in Liberty Village?",
      answer:
        "Brazen Head Irish Pub stays open until 2am seven days a week. The Rec Room runs until 2am on Friday and Saturday nights with DJ events and a club-like atmosphere. Craft Beer Market closes at 1am on weekends. Most Liberty Village bars close earlier on weeknights.",
    },
  ],

  patios: [
    {
      question: "When do Liberty Village patios open for the season?",
      answer:
        "Most Liberty Village patios open in late April or early May, weather permitting. Brazen Head Irish Pub's wraparound patio and Liberty Commons at Big Rock Brewery's beer garden are typically among the first to open. The season runs through October, with heaters extending it at some spots.",
    },
    {
      question: "Which Liberty Village patio is best for groups?",
      answer:
        "Liberty Commons at Big Rock Brewery on East Liberty has communal tables and a spacious beer garden that fits large groups easily. Brazen Head Irish Pub's wraparound patio also handles big parties well. LOCAL Public Eatery has one of the largest patios along East Liberty Street.",
    },
    {
      question: "Are there heated patios in Liberty Village?",
      answer:
        "Several spots run heaters to extend the season into fall. Cibo Wine Bar on Liberty St and Craft Beer Market both offer heated outdoor seating. Brazen Head Irish Pub adds heaters in early fall. Check with individual restaurants as heating availability varies by year and weather.",
    },
    {
      question: "Can I bring my dog to Liberty Village patios?",
      answer:
        "Many Liberty Village patios are dog-friendly. Brazen Head Irish Pub and Craft Beer Market both welcome leashed dogs on their outdoor patios. LEFT Field Brewery's taproom patio is also popular with dog owners. Always check with staff first, as policies can vary seasonally.",
    },
  ],

  "yoga-studios": [
    {
      question: "How much do yoga classes cost in Liberty Village?",
      answer:
        "Drop-in rates run $20-30 per class at most Liberty Village studios. Yoga Tree on Atlantic Ave offers monthly unlimited passes around $130-160. Class packs bring the per-class cost down to $15-20. Most studios offer a discounted introductory month for new students around $40-60.",
    },
    {
      question: "Is there hot yoga in Liberty Village?",
      answer:
        "Yes. Yoga Tree on Atlantic Ave offers hot yoga classes as part of their regular schedule. Altea Active on Western Battery Rd has a dedicated hot yoga studio included with gym membership. Movati Athletic on Lynn Williams St also runs heated yoga classes for members.",
    },
    {
      question: "What types of yoga classes are offered in Liberty Village?",
      answer:
        "Yoga Tree on Atlantic Ave offers vinyasa flow, hot yoga, restorative, and meditation classes with experienced Toronto instructors. Altea Active runs power yoga and hot yoga sessions. Several private instructors also teach in condo party rooms and at Lamport Stadium Park during summer.",
    },
    {
      question: "Are there beginner yoga classes in Liberty Village?",
      answer:
        "Yoga Tree on Atlantic Ave runs beginner-friendly gentle and restorative classes with clear instruction on fundamentals. Their Sunday evening restorative class is especially good for newcomers as it is never crowded. Most studios offer modifications in every class regardless of experience level.",
    },
  ],

  pilates: [
    {
      question: "How much does Pilates cost in Liberty Village?",
      answer:
        "Studio Lagree on Atlantic Ave charges $30-40 per Megaformer class, with packages reducing the per-class cost. Pure Barre on East Liberty runs similar pricing for barre-Pilates fusion classes. Both offer introductory deals for new clients, typically a week of unlimited classes for $40-50.",
    },
    {
      question: "What's the difference between Pilates and Lagree in Liberty Village?",
      answer:
        "Studio Lagree on Atlantic Ave uses the patented Megaformer machine for a slow-burn, high-intensity workout combining Pilates, strength, and cardio. Pure Barre blends ballet-inspired movements with Pilates principles. Traditional mat Pilates focuses on core control. Lagree is considered more physically demanding.",
    },
    {
      question: "Are there reformer Pilates classes in Liberty Village?",
      answer:
        "Studio Lagree on Atlantic Ave offers Megaformer classes, which are a next-generation version of reformer Pilates with 40-minute sessions that deliver a full-body workout. Pure Barre uses a ballet barre rather than a reformer. Both studios are on the East Liberty retail corridor.",
    },
    {
      question: "Do Liberty Village Pilates studios offer trial classes?",
      answer:
        "Yes. Studio Lagree typically offers a discounted first class or intro package for newcomers. Pure Barre on East Liberty recommends their foundations class for beginners to learn proper barre technique. Both studios post current offers on their websites and social media channels.",
    },
  ],

  doctors: [
    {
      question: "Are there family doctors accepting new patients in Liberty Village?",
      answer:
        "Liberty Village Family Health Team on Atlantic Ave opens new patient intake periodically, usually on the first Monday of each month. Spots fill within days, so call early. Walk-in clinics nearby on King Street West are available when you cannot wait for a roster spot.",
    },
    {
      question: "Are there walk-in clinics in Liberty Village?",
      answer:
        "The closest walk-in clinics are along King Street West, just north of the neighbourhood. Liberty Village Family Health Team at 99 Atlantic Ave offers same-day urgent appointments for rostered patients. For unrostered residents, Appletree clinics on King West accept walk-ins during business hours.",
    },
    {
      question: "How long is the wait to see a doctor in Liberty Village?",
      answer:
        "Walk-in clinic waits on King West typically run 30-90 minutes depending on the time of day. Rostered patients at Liberty Village Family Health Team can usually get same-day urgent appointments. For non-urgent referrals, expect a wait of 1-3 weeks for specialist appointments in the area.",
    },
    {
      question: "Do Liberty Village doctors offer virtual appointments?",
      answer:
        "Liberty Village Family Health Team offers virtual phone and video consultations for rostered patients, especially for prescription renewals and follow-ups. Several King West walk-in clinics also provide telehealth options through apps like Maple and Telus Health. Check OHIP coverage before booking.",
    },
  ],

  veterinarians: [
    {
      question: "How much does a vet visit cost in Liberty Village?",
      answer:
        "A standard wellness exam at Liberty Village Animal Hospital on Hanna Ave runs $60-90. Vaccinations are $30-50 each. Dental cleanings typically cost $400-800 depending on complexity. Pet insurance is recommended, as emergency visits can run $500 or more in the neighbourhood.",
    },
    {
      question: "Is there an emergency vet near Liberty Village?",
      answer:
        "Liberty Village Animal Hospital at 55 Hanna Ave handles urgent cases during business hours Monday through Saturday. For after-hours emergencies, the closest 24-hour emergency vet is the Veterinary Emergency Clinic at 920 Yonge St, about a 15-minute drive from Liberty Village.",
    },
    {
      question: "Do Liberty Village vets accept new patients?",
      answer:
        "Liberty Village Animal Hospital at 55 Hanna Ave does accept new patients, though booking initial appointments may take 1-2 weeks during busy periods. Book your first visit in January or February when the schedule is lighter than the busy spring and summer months.",
    },
    {
      question: "Are there vets open on Saturday in Liberty Village?",
      answer:
        "Liberty Village Animal Hospital on Hanna Ave offers Saturday hours from 9am to 3pm. They are closed on Sundays. Because the neighbourhood has one of Toronto's highest dog populations, Saturday appointments fill up quickly so book at least a week in advance.",
    },
  ],

  "dog-walkers": [
    {
      question: "How much do dog walkers charge in Liberty Village?",
      answer:
        "Professional dog walking in Liberty Village typically costs $18-25 per 30-minute group walk and $25-40 for private walks. Liberty Pooch offers small group walks with GPS tracking so you can see your dog's route. Monthly packages with daily walks run $350-500 depending on frequency.",
    },
    {
      question: "Are Liberty Village dog walkers insured and bonded?",
      answer:
        "Reputable dog walkers like Liberty Pooch carry liability insurance and are bonded. Always ask for proof of insurance before hiring. Liberty Pooch also runs background checks on all walkers and provides GPS tracking during every walk for complete transparency with pet owners.",
    },
    {
      question: "Where do dog walkers take dogs in Liberty Village?",
      answer:
        "Liberty Pooch and other local dog walkers use several neighbourhood spots including the off-leash area near Lamport Stadium, Stanley Park, and the trails along the Gardiner corridor. Group walks typically stay within Liberty Village and the surrounding King West and Parkdale borders.",
    },
    {
      question: "Do Liberty Village dog walkers offer puppy visits?",
      answer:
        "Yes. Liberty Pooch offers midday puppy visits for condo-dwelling puppies who cannot handle a full walk yet. Visits include a bathroom break, playtime, and feeding if needed. This service is popular with Liberty Village residents working from the neighbourhood's many coworking spaces.",
    },
  ],

  "dog-groomers": [
    {
      question: "How much does dog grooming cost in Liberty Village?",
      answer:
        "The Dog House Grooming on Hanna Ave charges $50-80 for a basic bath and brush, and $80-130 for a full groom including breed-specific cuts. Prices vary by dog size and coat condition. Nail trims are available as a standalone service for $15-20 without a full appointment.",
    },
    {
      question: "Do Liberty Village dog groomers offer pickup service?",
      answer:
        "Some groomers in the neighbourhood offer pickup and drop-off to local condos. The Dog House Grooming at 38 Hanna Ave is centrally located within walking distance of most Liberty Village buildings. Call ahead to ask about pickup availability, especially for large dogs or mobility-limited owners.",
    },
    {
      question: "How often should I groom my dog in Liberty Village?",
      answer:
        "The Dog House Grooming recommends every 4-6 weeks for full grooms depending on breed and coat type. Monthly nail trims are standard. Liberty Village's urban environment means dogs pick up more dirt and debris on walks, so regular bathing matters more here than in suburban areas.",
    },
    {
      question: "Are there groomers good with nervous dogs in Liberty Village?",
      answer:
        "The Dog House Grooming on Hanna Ave specializes in handling anxious dogs with patience and gentle products. They suggest booking a standalone nail trim first to let nervous dogs get comfortable with the groomers before committing to a full grooming session in their shop.",
    },
  ],

  "hair-salons": [
    {
      question: "How much does a haircut cost at Liberty Village salons?",
      answer:
        "Women's cuts typically range from $60-120 depending on the stylist and salon. b.suite on Atlantic Ave is a suite-based salon where prices vary by individual stylist. Lavish Hair Studio near Wade Ave charges $70-100 for cuts. Colour services start around $150 and go up significantly for balayage.",
    },
    {
      question: "Which Liberty Village salon is best for balayage?",
      answer:
        "Lavish Hair Studio near Wade Ave specializes in balayage and lived-in colour techniques that grow out naturally. The stylists at b.suite on Atlantic Ave also include colour specialists with strong Instagram portfolios. Always book a consultation before your first colour appointment to get an accurate quote.",
    },
    {
      question: "Do Liberty Village hair salons take walk-ins?",
      answer:
        "Most Liberty Village salons are appointment-only. b.suite on Atlantic Ave operates entirely by appointment with independent stylists who set their own schedules. Lavish Hair Studio on Wade Ave sometimes accommodates same-day requests for simple cuts. Call ahead rather than showing up to avoid disappointment.",
    },
    {
      question: "Are there affordable hair salons in Liberty Village?",
      answer:
        "Prices in Liberty Village reflect Toronto's west-end market. For more budget-friendly cuts, check newer stylists at b.suite on Atlantic Ave who often charge less while building their clientele. Some stylists offer discounts for weekday morning appointments when demand is lower across the neighbourhood.",
    },
  ],

  barbers: [
    {
      question: "How much does a men's haircut cost in Liberty Village?",
      answer:
        "A standard men's cut at Baz & Banks Barber on East Liberty runs $35-50. Fades and more detailed work may cost slightly more. Hot towel shaves and beard trims are available as add-ons for $15-25. Baz & Banks delivers a full grooming experience beyond a basic haircut.",
    },
    {
      question: "Do Liberty Village barbers take walk-ins?",
      answer:
        "Baz & Banks Barber on East Liberty accepts walk-ins but appointments are recommended, especially on Saturdays. Their busiest times are Friday evenings and Saturday mornings. Booking online saves wait time, and sticking with one barber means they remember your cut preferences each visit.",
    },
    {
      question: "Are there barbers open on weekends in Liberty Village?",
      answer:
        "Yes. Baz & Banks Barber on East Liberty is open Saturday 9am to 6pm and Sunday 10am to 5pm. Weekend slots fill quickly with the neighbourhood's young professional crowd, so booking ahead by a few days is recommended for Saturday appointments especially.",
    },
    {
      question: "Where can I get a hot towel shave in Liberty Village?",
      answer:
        "Baz & Banks Barber at 1 East Liberty St offers hot towel shaves and beard grooming services alongside their regular haircut menu. The shop has a clean, modern aesthetic and the barbers are skilled with both classic razor shaves and modern beard shaping techniques.",
    },
  ],

  "nail-salons": [
    {
      question: "How much does a manicure cost in Liberty Village?",
      answer:
        "Tips & Toes Nail Spa at 171 East Liberty St charges around $25-35 for a basic manicure and $40-55 for gel. Pedicures run $35-50. Prices are reasonable for the neighbourhood, and the turnaround is quick enough to fit in during a lunch break from nearby offices or coworking spaces.",
    },
    {
      question: "Do Liberty Village nail salons take walk-ins?",
      answer:
        "Tips & Toes Nail Spa on East Liberty accepts walk-ins, though wait times can be 15-30 minutes during busy periods. Tuesday is consistently the quietest day with the shortest waits. For gel sets or specialty services, booking an appointment ensures you get your preferred time slot.",
    },
    {
      question: "Are there nail salons open on weekends in Liberty Village?",
      answer:
        "Tips & Toes Nail Spa is open Saturday 10am to 7pm and Sunday 11am to 5pm. Weekend appointments are popular so walk-ins may face longer waits. Booking ahead for Saturday mornings is recommended if you want a specific service or time slot in the neighbourhood.",
    },
    {
      question: "Where can I get gel nails in Liberty Village?",
      answer:
        "Tips & Toes Nail Spa at 171 East Liberty St offers a full range of gel manicure and pedicure services at competitive prices. They use quality gel products and the results are durable. The salon is located in the main retail strip, making it convenient to combine with other errands.",
    },
  ],

  "house-cleaning": [
    {
      question: "How much does condo cleaning cost in Liberty Village?",
      answer:
        "Mopify, popular with Liberty Village condo dwellers, charges $100-150 for a standard one-bedroom condo cleaning and $140-200 for two bedrooms. Deep cleans run 30-50 percent more. Move-in and move-out cleans are priced separately. Recurring biweekly bookings get priority scheduling and consistent cleaners.",
    },
    {
      question: "Do Liberty Village cleaning services know condo access rules?",
      answer:
        "Yes. Mopify and other local services are experienced with Liberty Village condo buildings, including elevator booking, concierge check-in procedures, and parking restrictions for staff. Provide your building's access instructions when booking. Experienced local cleaners know typical condo layouts and clean more efficiently.",
    },
    {
      question: "How often should I get my Liberty Village condo cleaned?",
      answer:
        "Most Liberty Village residents book biweekly cleaning through services like Mopify, which is sufficient for typical one or two-bedroom condos. Studios or one-bedrooms with minimal foot traffic can manage monthly cleans. Pet owners in the neighbourhood generally need weekly service to stay on top of hair.",
    },
    {
      question: "Are there eco-friendly cleaning services in Liberty Village?",
      answer:
        "Mopify uses eco-friendly products upon request at no extra charge. Several independent cleaners serving Liberty Village specialize in green cleaning with plant-based products. Specify your preference when booking, as most services default to conventional products unless you ask for the eco-friendly alternative upfront.",
    },
  ],

  movers: [
    {
      question: "How much do movers cost in Liberty Village?",
      answer:
        "Moving within Liberty Village typically costs $300-600 for a one-bedroom condo with two movers and a truck for 3-4 hours. Two-bedroom moves run $500-900. The key cost factor is elevator booking time, as most Liberty Village buildings limit moving windows to specific hours requiring efficient crews.",
    },
    {
      question: "Do I need to book the elevator for moving in Liberty Village condos?",
      answer:
        "Yes. Nearly every Liberty Village condo building requires elevator booking for moves, typically 2-4 weeks in advance through property management. Missing your window means rescheduling, so book your elevator before confirming your mover's date. End-of-month dates fill up fastest across the neighbourhood.",
    },
    {
      question: "When is the cheapest time to move in Liberty Village?",
      answer:
        "Mid-month weekday moves are cheapest, with rates 20-30 percent lower than month-end or weekend moves. Avoid the last week of the month when Liberty Village condo turnover peaks. January through March is also quieter and cheaper than the busy summer moving season across Toronto.",
    },
    {
      question: "What should I tell movers about my Liberty Village building?",
      answer:
        "Share your building's elevator booking confirmation, loading dock location, parking restrictions, and any move-in fees. Most Liberty Village condos have specific loading zones on East Liberty or Hanna Ave. Buildings on Western Battery Rd and Lynn Williams St have tricky dock access that experienced local movers already know.",
    },
  ],

  "personal-trainers": [
    {
      question: "How much do personal trainers cost in Liberty Village?",
      answer:
        "Personal training in Liberty Village runs $70-120 per hour-long session. Precision Athletics on Hanna Ave charges premium rates for their assessment-based programming in a private studio. Trainers at GoodLife Fitness offer slightly lower rates around $60-80. Package deals of 8-plus sessions reduce the per-session cost.",
    },
    {
      question: "Are there personal trainers who come to Liberty Village condos?",
      answer:
        "Yes. Several independent trainers offer sessions in Liberty Village condo fitness rooms and party rooms. Precision Athletics at 38 Hanna Ave operates from their private studio nearby. Some trainers also run sessions at Lamport Stadium Park during warmer months for outdoor training options.",
    },
    {
      question: "What should I look for in a Liberty Village personal trainer?",
      answer:
        "Precision Athletics on Hanna Ave starts with a thorough physical assessment before programming, which is the gold standard approach. Look for certified trainers with experience in your goals, whether strength, weight loss, or rehab. Commit to at least 8 sessions, as the first few are assessment-focused.",
    },
    {
      question: "Do Liberty Village gyms include personal training?",
      answer:
        "GoodLife Fitness on Jefferson Ave and Altea Active on Western Battery Rd both offer in-house personal training at additional cost beyond membership. F45 Training on East Liberty provides coach-led group sessions included in membership that feel semi-personal. Movati Athletic also has a personal training program.",
    },
  ],

  daycares: [
    {
      question: "How long is the daycare waitlist in Liberty Village?",
      answer:
        "Liberty Village Child Care Centre on Western Battery Rd has a typical waitlist of 12-18 months. The neighbourhood's growing young family population keeps demand high. Get on the waitlist as soon as you find out you are expecting to have the best chance at securing a spot for your child.",
    },
    {
      question: "How much does daycare cost in Liberty Village?",
      answer:
        "Licensed daycare in Liberty Village runs $1,500-2,200 per month for infants and $1,200-1,700 for toddlers. Liberty Village Child Care Centre on Western Battery Rd accepts the Canada-wide $10-a-day childcare subsidy applicants. Check current CWELCC fee reduction status when enrolling your child.",
    },
    {
      question: "Are there licensed daycares in Liberty Village?",
      answer:
        "Liberty Village Child Care Centre at 50 Western Battery Rd is a licensed facility offering play-based learning for infants through preschool age. The purpose-built facility meets all Ontario licensing standards. Additional licensed home daycare providers also operate within the neighbourhood on a smaller scale.",
    },
    {
      question: "What age does daycare start in Liberty Village?",
      answer:
        "Liberty Village Child Care Centre accepts infants starting at approximately 12 months through preschool age. Infant rooms fill fastest, so early waitlist registration is critical. Some neighbourhood home daycares accept children as young as 6 months. Pre-school programs for ages 3-5 have slightly shorter waitlists.",
    },
  ],

  "coworking-spaces": [
    {
      question: "How much does coworking cost in Liberty Village?",
      answer:
        "Hot-desking starts around $250-350 per month at Spaces Liberty Village above East Liberty St. WeWork on Atlantic Ave charges $350-500 monthly for dedicated desks. The Fueling Station on Fraser Ave offers more affordable plans starting around $200 for community-focused freelancer and startup workspace.",
    },
    {
      question: "Are there free coworking options in Liberty Village?",
      answer:
        "No dedicated free coworking exists, but several coffee shops serve the function. Balzac's Coffee Roasters in the Liberty Market building is the unofficial coworking hub with great WiFi and ample seating. Dark Horse Espresso and Jimmy's Coffee on Atlantic Ave are also popular with remote workers.",
    },
    {
      question: "Which Liberty Village coworking space is best for startups?",
      answer:
        "The Fueling Station on Fraser Ave is specifically designed for startups and small creative agencies, with genuine community, networking events, and affordable pricing. WeWork on Atlantic Ave suits funded startups needing a polished address. Spaces Liberty Village works best for established small businesses wanting premium facilities.",
    },
    {
      question: "Do Liberty Village coworking spaces offer meeting rooms?",
      answer:
        "Yes. Spaces Liberty Village, WeWork on Atlantic Ave, and The Fueling Station all offer bookable meeting rooms in various sizes. Spaces and WeWork include meeting room credits with higher-tier memberships. The Fueling Station charges hourly rates that are typically lower than the larger chains.",
    },
  ],

  "grocery-stores": [
    {
      question: "Is there a full grocery store in Liberty Village?",
      answer:
        "FreshCo at 171 East Liberty St is the neighbourhood's primary full-service grocery store, anchoring the main retail strip. Prices are lower than specialty shops, and the produce section is solid for a discount grocer. For specialty items, residents often supplement with trips to stores on King Street West.",
    },
    {
      question: "What time does the Liberty Village grocery store open?",
      answer:
        "FreshCo on East Liberty is open daily from 8am to 10pm. Shop before 10am on weekdays for the quietest experience, as this store serves the entire neighbourhood and aisles get cramped during peak hours. Weekend mornings between 8-9am are also relatively calm for stocking up.",
    },
    {
      question: "Are there grocery delivery options in Liberty Village?",
      answer:
        "FreshCo offers delivery through Instacart and other services. Liberty Village is well-served by grocery delivery apps including Metro, Loblaws PC Express, and Grocery Gateway. Most services deliver to condo lobbies. Many residents combine weekly FreshCo runs with online delivery for specialty and bulk items.",
    },
    {
      question: "Where do Liberty Village residents buy specialty groceries?",
      answer:
        "For specialty items, residents head to King Street West where Loblaws, Rabba, and various international shops are within a short streetcar ride. The Liberty Village farmers market runs seasonally near the community centre. Sweet Flour Bake Shop on East Liberty covers artisan bread and baked goods.",
    },
  ],

  pharmacies: [
    {
      question: "Are there pharmacies open late in Liberty Village?",
      answer:
        "Shoppers Drug Mart at 171 East Liberty St stays open until 10pm on weekdays and 9pm on Saturdays, making it the best option for late prescriptions. Rexall Pharmacy at 1 East Liberty closes at 8pm on weekdays. Neither offers true 24-hour service, but Shoppers covers most evening needs.",
    },
    {
      question: "Can I get vaccinations at Liberty Village pharmacies?",
      answer:
        "Both Shoppers Drug Mart and Rexall in Liberty Village offer flu shots, COVID boosters, and travel vaccinations by appointment. Shoppers on East Liberty has the more established immunization program. Book online through either pharmacy's website to avoid wait times for vaccination appointments.",
    },
    {
      question: "Which Liberty Village pharmacy is less busy?",
      answer:
        "Rexall Pharmacy at 1 East Liberty St is consistently less crowded than Shoppers Drug Mart and fills prescriptions faster according to local residents. If wait times at Shoppers frustrate you, transferring your prescription to Rexall is straightforward and they will handle the transfer process for you.",
    },
    {
      question: "Do Liberty Village pharmacies offer delivery?",
      answer:
        "Shoppers Drug Mart on East Liberty offers prescription delivery within Liberty Village through their app. Rexall provides a similar delivery service. Both pharmacies handle auto-refills so recurring medications arrive without manual reordering. Delivery is especially convenient for Liberty Village condo residents during winter months.",
    },
  ],

  "dry-cleaners": [
    {
      question: "Is there a dry cleaner in Liberty Village?",
      answer:
        "King West Dry Cleaners at 100 Lynn Williams St serves the neighbourhood with quality cleaning for suits, dress shirts, and delicates. They offer same-day service if you drop off before 10am. Their alterations team handles everything from hemming to complex tailoring, and they deliver to local condos.",
    },
    {
      question: "Do Liberty Village dry cleaners offer pickup and delivery?",
      answer:
        "Yes. King West Dry Cleaners delivers to Liberty Village condos and offers recurring weekly pickup schedules with a 15 percent discount on standing orders. Provide your concierge or lobby drop instructions when setting up delivery. Several app-based dry cleaning services also operate in the area.",
    },
    {
      question: "How much does dry cleaning cost in Liberty Village?",
      answer:
        "King West Dry Cleaners charges standard Toronto rates: $8-12 for dress shirts, $15-20 for suits, and $12-18 for dresses. Same-day service has a small surcharge. Setting up a recurring weekly pickup saves 15 percent and is popular with Liberty Village professionals who wear business attire regularly.",
    },
    {
      question: "Can I get same-day dry cleaning in Liberty Village?",
      answer:
        "King West Dry Cleaners at 100 Lynn Williams St offers same-day service for items dropped off before 10am Monday through Friday. Saturday drop-offs are ready by Monday. For urgent weekend needs, some app-based services like Drybar and Pressly serve Liberty Village with faster turnaround times.",
    },
  ],

  tailors: [
    {
      question: "Is there a tailor in Liberty Village?",
      answer:
        "King West Dry Cleaners at 100 Lynn Williams St has an in-house alterations team handling hemming, suit adjustments, and more complex tailoring work. For specialized tailoring, several options along King Street West are a short streetcar ride away. Quick turnarounds are standard for basic alterations in the area.",
    },
    {
      question: "How much do alterations cost near Liberty Village?",
      answer:
        "Basic hemming runs $10-20 and pant tapering costs $20-35 at shops near Liberty Village. Suit jacket alterations range from $40-80 depending on complexity. King West Dry Cleaners handles most common alterations in-house. For bridal or complex tailoring, King Street West has dedicated specialty tailors.",
    },
    {
      question: "How long do alterations take in Liberty Village?",
      answer:
        "Standard hemming and basic alterations take 2-5 business days at shops near Liberty Village. Rush service is often available for an upcharge. King West Dry Cleaners at 100 Lynn Williams St handles most alterations within a week. Complex suit work or bridal alterations may take 2-3 weeks.",
    },
    {
      question: "Where can I get a suit tailored near Liberty Village?",
      answer:
        "King West Dry Cleaners on Lynn Williams St handles suit alterations in-house. For custom suit tailoring, King Street West has several dedicated menswear tailors within a short streetcar ride. Liberty Village's professional crowd means local tailors are experienced with modern slim-fit suit adjustments and business attire.",
    },
  ],

  "auto-repair": [
    {
      question: "Where is the nearest auto repair shop to Liberty Village?",
      answer:
        "Auto repair shops cluster along Dufferin Street south of King and on Strachan Avenue, both within a short drive from Liberty Village. Several mechanics on King Street West also serve the neighbourhood. Most offer tow service if your car cannot make the trip from your Liberty Village condo parking spot.",
    },
    {
      question: "How much does an oil change cost near Liberty Village?",
      answer:
        "Standard oil changes at shops near Liberty Village run $50-80 for conventional oil and $80-120 for synthetic. Shops along Dufferin and Strachan typically offer competitive pricing. Some offer pickup service from Liberty Village condos, which saves the hassle of navigating tight building parking garages.",
    },
    {
      question: "Are there mechanics that specialize in European cars near Liberty Village?",
      answer:
        "Several specialty European auto shops operate along King Street West and Dufferin Street, serving the BMW, Audi, and Mercedes vehicles common in Liberty Village condo garages. Independent European specialists typically charge 30-40 percent less than dealerships while using OEM-equivalent parts and diagnostic equipment.",
    },
    {
      question: "Where can I get winter tires installed near Liberty Village?",
      answer:
        "Auto shops along Dufferin Street and Strachan Avenue offer tire changeover services, typically $60-100 for mounting and balancing. Book by mid-October as shops get slammed once the first frost hits Toronto. Some offer tire storage for Liberty Village condo residents who lack garage space for off-season tires.",
    },
  ],

  "bike-shops": [
    {
      question: "Is there a bike shop in Liberty Village?",
      answer:
        "Sweet Pete's Bike Shop at 1 East Liberty St is the neighbourhood's full-service bike shop offering sales, expert repairs, and seasonal tune-ups. The mechanics are knowledgeable and honest about what your bike actually needs. They stock accessories, locks, and urban cycling gear suited to condo living.",
    },
    {
      question: "How much does a bike tune-up cost in Liberty Village?",
      answer:
        "A basic tune-up at Sweet Pete's Bike Shop runs $60-90, covering brake and gear adjustment, tire inflation, and chain lubrication. Comprehensive overhauls cost $120-180. Bring your bike in during March before the April rush to avoid week-long wait times during peak spring cycling season.",
    },
    {
      question: "Does Liberty Village have good cycling infrastructure?",
      answer:
        "Liberty Village connects to the Martin Goodman Trail and Toronto's waterfront cycling network. Bike Share Toronto stations dot the neighbourhood. Sweet Pete's on East Liberty helps riders choose the right bike for urban commuting. Protected bike lanes on nearby streets continue to expand across the west end.",
    },
    {
      question: "Where can I buy an e-bike in Liberty Village?",
      answer:
        "Sweet Pete's Bike Shop at 1 East Liberty St carries e-bikes alongside traditional bicycles and can help you choose the right model for city commuting. They handle e-bike servicing and repairs as well. The Martin Goodman Trail nearby is excellent for testing an e-bike's range and comfort level.",
    },
  ],

  "massage-therapy": [
    {
      question: "How much does massage therapy cost in Liberty Village?",
      answer:
        "Registered massage therapy at Myodetox Liberty Village on East Liberty costs $120-160 for a 60-minute session. Most insurance plans cover RMT sessions, and Myodetox offers direct billing to major insurers. Prices are comparable to standard Toronto RMT rates in the King West corridor area.",
    },
    {
      question: "Do Liberty Village massage therapists direct bill insurance?",
      answer:
        "Yes. Myodetox at 1 East Liberty St direct bills to most major insurance providers, eliminating the need to submit claims yourself. Confirm your specific plan is accepted when booking. Liberty Village Physiotherapy on Atlantic Ave also offers massage therapy with insurance direct billing capabilities.",
    },
    {
      question: "What types of massage are available in Liberty Village?",
      answer:
        "Myodetox Liberty Village specializes in therapeutic and sports massage with movement assessment. They focus on finding root causes of pain rather than just treating symptoms. Their approach combines registered massage therapy with corrective exercise programming. Deep tissue, relaxation, and prenatal massage are also available nearby.",
    },
    {
      question: "Should I get massage or physiotherapy in Liberty Village?",
      answer:
        "Myodetox on East Liberty combines both approaches, starting with a 60-minute assessment to identify compensation patterns. For chronic pain or injury rehab, Liberty Village Physiotherapy on Atlantic Ave may be more appropriate. For general tension and stress relief, standard RMT massage sessions work well.",
    },
  ],

  physiotherapy: [
    {
      question: "How much does physiotherapy cost in Liberty Village?",
      answer:
        "Sessions at Liberty Village Physiotherapy on Atlantic Ave run $90-130 for 30-45 minute appointments. Initial assessments are typically longer and may cost more. Most extended health insurance plans cover physio. The clinic offers direct billing so you only pay your copay or deductible at the time of visit.",
    },
    {
      question: "Do Liberty Village physio clinics offer direct billing?",
      answer:
        "Yes. Liberty Village Physiotherapy and Rehab at 99 Atlantic Ave direct bills to most major insurance providers. Myodetox on East Liberty also handles direct billing for their physiotherapy services. Always confirm your specific plan is accepted when booking your initial assessment appointment.",
    },
    {
      question: "What conditions do Liberty Village physiotherapists treat?",
      answer:
        "Liberty Village Physiotherapy at 99 Atlantic Ave treats sports injuries, post-surgical rehab, chronic pain, and desk-worker posture issues common among the neighbourhood's remote workers. They also offer acupuncture and shockwave therapy. The clinic builds personalized treatment plans rather than using generic exercise protocols.",
    },
    {
      question: "Are there physio clinics open early or late in Liberty Village?",
      answer:
        "Liberty Village Physiotherapy on Atlantic Ave opens at 7am and stays open until 8pm on weekdays, with Saturday hours from 9am to 2pm. Early morning slots are recommended for more thorough sessions before the schedule gets busy. Myodetox on East Liberty also offers 7am start times on weekdays.",
    },
  ],

  chiropractors: [
    {
      question: "How much does a chiropractor cost in Liberty Village?",
      answer:
        "Initial assessments at Liberty Village Chiropractic on Atlantic Ave run $80-120, with follow-up adjustments costing $50-80 per visit. Most extended health insurance plans cover chiropractic care. The clinic direct bills to major insurers, so you typically only pay your copay at the point of service.",
    },
    {
      question: "Do Liberty Village chiropractors direct bill insurance?",
      answer:
        "Yes. Liberty Village Chiropractic at 99 Atlantic Ave direct bills to most major insurance providers, removing the hassle of claim submissions. Mention your insurance when booking your first appointment so they can verify coverage and let you know your out-of-pocket costs before treatment begins.",
    },
    {
      question: "Are there chiropractors good for desk workers in Liberty Village?",
      answer:
        "Liberty Village Chiropractic on Atlantic Ave specifically focuses on desk workers and athletes, the two dominant populations in the neighbourhood. Mention that you work from home or at a desk and they include a free ergonomic workstation assessment with your first visit, which alone is worth the appointment.",
    },
    {
      question: "What hours are chiropractors open in Liberty Village?",
      answer:
        "Liberty Village Chiropractic offers Monday, Wednesday, and Friday hours from 8am to 6pm, Tuesday and Thursday from 10am to 8pm, and Saturday mornings from 9am to 1pm. The alternating schedule accommodates both early risers and those who need evening appointments after work.",
    },
  ],

  optometrists: [
    {
      question: "How much does an eye exam cost in Liberty Village?",
      answer:
        "Eye exams at Liberty Village Optometry on East Liberty and BenchMark Optometry on Atlantic Ave run $90-130 for a comprehensive assessment. OHIP covers annual exams for ages 19 and under and 65-plus. Both clinics direct bill insurance and explain your coverage before you choose frames.",
    },
    {
      question: "Are there optometrists with trendy frames in Liberty Village?",
      answer:
        "BenchMark Optometry at 99 Atlantic Ave stocks independent and designer eyewear brands you won't find at chain stores. Liberty Village Optometry on East Liberty also carries curated frame selections leaning trendy. Both shops help you find styles that suit your face shape within your insurance budget.",
    },
    {
      question: "Do Liberty Village optometrists accept walk-ins?",
      answer:
        "Both Liberty Village Optometry and BenchMark Optometry prefer appointments but may accommodate walk-ins depending on availability. BenchMark on Atlantic Ave is open Monday through Saturday. For the most thorough experience, book ahead so the optometrist can allocate proper time for your assessment.",
    },
    {
      question: "Can I get same-day glasses in Liberty Village?",
      answer:
        "Standard glasses at Liberty Village Optometry and BenchMark Optometry typically take 5-10 business days as lenses are custom-ground. For urgent needs, both can arrange rush orders. Contact lens fittings and trial lenses are often available same-day after your comprehensive eye exam appointment.",
    },
  ],

  accountants: [
    {
      question: "How much does an accountant cost in Liberty Village?",
      answer:
        "Blueprint Accounting at 99 Atlantic Ave charges $200-500 for personal tax returns and $500-2,000 for small business filings depending on complexity. Year-round bookkeeping packages start around $300 monthly. Their cloud-based approach means most work happens remotely with quarterly check-in meetings.",
    },
    {
      question: "Are there accountants in Liberty Village that specialize in freelancers?",
      answer:
        "Blueprint Accounting on Atlantic Ave specifically serves Liberty Village's freelancers, incorporated professionals, and tech startups. They understand the self-employment tax nuances, HST obligations, and home office deductions common in the neighbourhood's large remote-working population. Book a tax prep consultation in January before the rush.",
    },
    {
      question: "When should I contact my Liberty Village accountant for tax season?",
      answer:
        "Blueprint Accounting recommends reaching out in January rather than waiting until March. Early consultation means you get their full attention and time for strategic tax planning. The neighbourhood's many freelancers and small business owners flood accountants by February, making last-minute bookings difficult.",
    },
    {
      question: "Do Liberty Village accountants handle incorporation?",
      answer:
        "Blueprint Accounting at 99 Atlantic Ave handles incorporation for the neighbourhood's freelancers and contractors. They advise on whether incorporating makes financial sense based on your income level and can manage the ongoing corporate filings. Their specialty is the tech startup and creative professional demographic that dominates Liberty Village.",
    },
  ],

  lawyers: [
    {
      question: "What type of lawyers are near Liberty Village?",
      answer:
        "Liberty Village and the King West corridor have lawyers specializing in real estate closings, condo board disputes, small business law, and employment issues. The neighbourhood's high volume of condo transactions means real estate lawyers are especially experienced with condo-specific issues like status certificates and special assessments.",
    },
    {
      question: "How much does a real estate lawyer cost near Liberty Village?",
      answer:
        "Real estate lawyers near Liberty Village typically charge $1,200-2,000 for a standard condo purchase closing, including title insurance and registration. Rates vary based on transaction complexity. For condo board disputes or declarations review, hourly rates of $250-400 are common in the King West area.",
    },
    {
      question: "Do I need a lawyer for buying a condo in Liberty Village?",
      answer:
        "Yes. Ontario requires a lawyer for real estate transactions. A Liberty Village-experienced real estate lawyer will review the status certificate, flag upcoming special assessments, and handle closing. Choosing a lawyer familiar with local condo buildings can save you from costly surprises specific to the neighbourhood.",
    },
    {
      question: "Are there lawyers who handle condo disputes in Liberty Village?",
      answer:
        "Several law firms along King Street West specialize in condominium law, including board disputes, noise complaints, and bylaw enforcement issues common in Liberty Village's dense condo environment. Initial consultations typically cost $100-200, and many disputes can be resolved through mediation before reaching tribunal.",
    },
  ],

  "real-estate-agents": [
    {
      question: "How much do Liberty Village condos cost?",
      answer:
        "As of recent market data, one-bedroom condos in Liberty Village typically sell for $500,000-650,000, while two-bedrooms range from $650,000-900,000. Liberty Village Real Estate Team on Atlantic Ave provides free home evaluations and tracks micro-market trends that generalist agents miss in the neighbourhood.",
    },
    {
      question: "Should I use a real estate agent who specializes in Liberty Village?",
      answer:
        "Absolutely. Liberty Village Real Estate Team at 99 Atlantic Ave knows every building, floor plan, maintenance fee, and upcoming special assessment in the neighbourhood. This insider knowledge helps you avoid problem buildings and negotiate better prices. Their free evaluations are no-pressure and genuinely informative for buyers and sellers.",
    },
    {
      question: "Which Liberty Village condo buildings are best to buy in?",
      answer:
        "Buildings vary significantly in maintenance fees, build quality, and appreciation potential. Liberty Village Real Estate Team recommends asking about special assessment history and reserve fund health before any purchase. Newer builds along Western Battery Rd differ from heritage conversions on Fraser Ave. Local expertise matters here.",
    },
    {
      question: "Is Liberty Village a good investment for condo buyers?",
      answer:
        "Liberty Village benefits from transit access via the King streetcar, a walkable lifestyle, and ongoing neighbourhood development. Rental demand stays strong due to the area's popularity with young professionals. Liberty Village Real Estate Team tracks which buildings hold value best and can guide investment-focused buyers.",
    },
  ],

  "insurance-agents": [
    {
      question: "How much is condo insurance in Liberty Village?",
      answer:
        "Condo insurance in Liberty Village typically costs $25-50 per month depending on unit size, floor level, and coverage amount. Policies cover personal belongings, liability, and improvements to your unit. Most Liberty Village residents need at least $40,000-60,000 in contents coverage given typical furnishing values.",
    },
    {
      question: "Do I need tenant insurance in Liberty Village?",
      answer:
        "Most Liberty Village landlords require tenant insurance as a lease condition, and it is strongly recommended regardless. Policies cost $15-35 monthly and cover personal belongings, liability, and additional living expenses if your unit becomes uninhabitable. Flooding from upstairs neighbours is a real risk in older condo buildings.",
    },
    {
      question: "What type of insurance do Liberty Village small businesses need?",
      answer:
        "Liberty Village's many startups and freelancers typically need commercial general liability, professional liability or errors and omissions coverage, and cyber insurance. Home-based business riders are available for freelancers working from condos. Insurance agents along King Street West specialize in small business coverage packages for the area.",
    },
    {
      question: "How do I file an insurance claim for condo damage in Liberty Village?",
      answer:
        "Contact your insurance provider immediately and document all damage with photos. Common Liberty Village claims include water damage from upstairs units and personal property theft. Your condo corporation's master policy covers the building structure, while your personal policy covers contents and improvements inside your specific unit.",
    },
  ],

  banks: [
    {
      question: "Which banks have branches in Liberty Village?",
      answer:
        "Scotiabank at 171 East Liberty St and RBC Royal Bank at 1 East Liberty St are the two full-service branches in Liberty Village. Both offer personal banking, mortgages, and investment services. Scotiabank has a 24/7 ATM. TD and BMO branches are available on nearby King Street West.",
    },
    {
      question: "Are Liberty Village banks open on Saturdays?",
      answer:
        "Both Scotiabank and RBC in Liberty Village offer Saturday hours from 10am to 3pm. Weekday hours run 9:30am to 5pm. Avoid the noon lunch rush when wait times peak. For mortgage or investment consultations, RBC advisors recommend booking Tuesday or Wednesday morning appointments.",
    },
    {
      question: "Where is the nearest ATM in Liberty Village?",
      answer:
        "Scotiabank at 171 East Liberty has a 24/7 accessible ATM, as does RBC at 1 East Liberty. Shoppers Drug Mart on East Liberty also has a bank machine inside. For fee-free withdrawals, stick to your own bank's ATM since surcharges from other banks run $2-3 per transaction.",
    },
    {
      question: "Can I get a mortgage consultation in Liberty Village?",
      answer:
        "Both Scotiabank and RBC in Liberty Village have mortgage specialists familiar with the local condo market. RBC advisors suggest booking Tuesday or Wednesday mornings for unhurried consultations. They can discuss pre-approvals, renewals, and refinancing options specific to Liberty Village property values.",
    },
  ],

  tutors: [
    {
      question: "How much do tutors cost in Liberty Village?",
      answer:
        "Private tutoring in Liberty Village runs $40-80 per hour depending on subject and level. University exam prep and specialized subjects like calculus or French command higher rates. Many tutors offer packages of 5-10 sessions at a reduced per-hour rate for committed students in the neighbourhood.",
    },
    {
      question: "Are there in-home tutors in Liberty Village?",
      answer:
        "Yes. Several tutors offer in-home sessions in Liberty Village condos and townhouses, as well as virtual options via Zoom. The neighbourhood's compact layout means tutors can easily serve multiple families in the area. Condo party rooms also work well for small group tutoring sessions.",
    },
    {
      question: "What subjects do Liberty Village tutors teach?",
      answer:
        "Local tutors cover math, science, English, and French for elementary through high school students. University-level tutoring in calculus, statistics, and essay writing is also available. Some tutors specialize in standardized test prep for students applying to private schools or competitive university programs in Toronto.",
    },
    {
      question: "Are there tutors for adults in Liberty Village?",
      answer:
        "Yes. Liberty Village's young professional population drives demand for adult tutoring in French language, business writing, coding, and professional certification exam prep. Virtual sessions are popular with the area's remote workers. Several tutors specialize in ESL for newcomers settling in the King West corridor.",
    },
  ],

  "music-lessons": [
    {
      question: "How much do music lessons cost in Liberty Village?",
      answer:
        "Liberty Village Music School at 99 Atlantic Ave charges $40-70 per 30-minute private lesson depending on instrument and instructor experience. Monthly packages of four lessons reduce the cost. Guitar, piano, drums, and voice lessons are all available for kids and adults at every skill level.",
    },
    {
      question: "Are there music lessons for adults in Liberty Village?",
      answer:
        "Yes. Liberty Village Music School on Atlantic Ave teaches adults of all levels, from absolute beginners picking up guitar for the first time to experienced musicians refining technique. The neighbourhood's creative community means the instructors are working musicians who bring real-world experience to every lesson.",
    },
    {
      question: "What instruments can I learn in Liberty Village?",
      answer:
        "Liberty Village Music School at 99 Atlantic Ave offers private lessons in guitar, piano, drums, bass, voice, and more. The studio has soundproofed rooms and flexible scheduling that works around irregular work hours. Trial lessons are available so you can find the right instructor fit before committing.",
    },
    {
      question: "Do Liberty Village music schools offer group lessons?",
      answer:
        "Liberty Village Music School offers both private and small group lessons. Group classes are more affordable per session and add a social element. The school occasionally runs workshops and ensemble sessions for students wanting to play with others. Check their schedule for upcoming group class availability.",
    },
  ],

  "pet-stores": [
    {
      question: "Is there a pet store in Liberty Village?",
      answer:
        "Woof & Whiskers at 171 East Liberty St caters to the neighbourhood's massive pet population with premium food brands, toys, treats, and accessories. The staff are knowledgeable about pet nutrition and stock local Canadian-made products. They also offer an auto-delivery program for monthly food orders to your condo lobby.",
    },
    {
      question: "What pet food brands does the Liberty Village pet store carry?",
      answer:
        "Woof & Whiskers on East Liberty stocks premium brands including raw food options, grain-free formulas, and locally made Canadian products. The staff can recommend the right food for your pet's specific dietary needs and allergies. They prioritize quality brands over mass-market grocery store options.",
    },
    {
      question: "Does the Liberty Village pet store deliver?",
      answer:
        "Woof & Whiskers offers an auto-delivery program that brings monthly food orders directly to your condo lobby, which saves hauling heavy 30-pound bags from the store. Ask about setting up recurring delivery when you find the right food for your pet. They also carry treats and supplies.",
    },
    {
      question: "Are there pet stores open on weekends in Liberty Village?",
      answer:
        "Woof & Whiskers on East Liberty is open Saturday 10am to 7pm and Sunday 11am to 5pm. Weekend afternoons are busy as dog owners stop in after walks. For a calmer shopping experience with more staff attention, visit on a weekday morning when the store is quieter.",
    },
  ],

  florists: [
    {
      question: "Is there a florist in Liberty Village?",
      answer:
        "Tonic Blooms at 113 Atlantic Ave is a boutique florist creating modern arrangements with locally sourced seasonal flowers. Their style features garden roses, ranunculus, and eucalyptus. They handle walk-in bouquets daily and are popular for weddings and events in the neighbourhood's gallery and loft venues.",
    },
    {
      question: "Does the Liberty Village florist deliver?",
      answer:
        "Tonic Blooms on Atlantic Ave delivers throughout Liberty Village and the broader Toronto area. They also offer a weekly flower subscription for homes and offices that is cheaper per arrangement than buying individual bouquets. Same-day delivery may be available for orders placed before noon.",
    },
    {
      question: "How much do flower arrangements cost in Liberty Village?",
      answer:
        "Ready-made bouquets at Tonic Blooms on Atlantic Ave start around $40-60, with custom arrangements running $80-150 depending on size and flower selection. Wedding and event florals are quoted separately based on scope. Their seasonal selections offer the best value since flowers are sourced locally when possible.",
    },
    {
      question: "Can I get wedding flowers from a Liberty Village florist?",
      answer:
        "Tonic Blooms on Atlantic Ave is experienced with weddings and events in Liberty Village's unique gallery and loft venues like Artscape Youngplace. Their romantic, textural style suits the industrial-chic spaces common in the neighbourhood. Book consultations well in advance, especially for spring and summer wedding dates.",
    },
  ],

  photographers: [
    {
      question: "Are there photographers based in Liberty Village?",
      answer:
        "Liberty Village's industrial backdrops, murals, and converted loft spaces make it a popular base for photographers specializing in portraits, events, and real estate photography. Several photographers maintain studios along Hanna Ave and Fraser Ave in the neighbourhood's warehouse district for convenient access to unique settings.",
    },
    {
      question: "How much do photographers cost in Liberty Village?",
      answer:
        "Portrait sessions from Liberty Village-based photographers typically run $200-500 for a one-hour shoot with edited digital files. Event photography ranges from $500-2,000 depending on duration. Real estate photography for condo listings starts around $150-300 per property, a key service in this condo-heavy neighbourhood.",
    },
    {
      question: "Where are the best photo shoot locations in Liberty Village?",
      answer:
        "The murals along Hanna Ave and Atlantic Ave provide colorful backdrops. Converted warehouse facades on Fraser Ave offer industrial-chic aesthetics. The heritage schoolhouse at 70 Fraser Ave and Liberty Market building are also popular. Lamport Stadium Park provides green space for outdoor portrait sessions.",
    },
    {
      question: "Can I hire a real estate photographer in Liberty Village?",
      answer:
        "Several photographers in the area specialize in condo listing photography, understanding the small-space lighting challenges of Liberty Village units. Good real estate photos are essential in this competitive market. Liberty Village Real Estate Team on Atlantic Ave can recommend photographers they trust for listing shoots.",
    },
  ],

  caterers: [
    {
      question: "Are there caterers based in Liberty Village?",
      answer:
        "Feast Catering Co. operates from a commercial kitchen on Hanna Ave and specializes in corporate catering for Liberty Village's tech offices and creative agencies. They go beyond standard sandwich platters with custom menus for meetings and private events. Order by 10am the day before for office lunch delivery.",
    },
    {
      question: "How much does catering cost in Liberty Village?",
      answer:
        "Feast Catering Co. on Hanna Ave charges $15-25 per person for corporate lunch catering and $40-80 per person for full event catering depending on menu complexity. Their weekly rotating menu keeps regular office clients fed without menu fatigue. Custom menus are their specialty for larger events.",
    },
    {
      question: "Can I get same-day catering in Liberty Village?",
      answer:
        "Feast Catering Co. requires orders by 10am the day before for standard corporate lunch delivery. Same-day catering for events is generally not available due to preparation requirements. For last-minute office food, several Liberty Village restaurants offer group ordering including LOCAL Public Eatery and Mildred's Temple Kitchen.",
    },
    {
      question: "Do Liberty Village caterers handle office lunches?",
      answer:
        "Feast Catering Co. specializes in corporate catering for the neighbourhood's many tech companies and creative agencies. Their delivery covers all of Liberty Village from their Hanna Ave kitchen. Ask about their weekly rotating menu for recurring office lunch programs that keep employees happy without repetitive orders.",
    },
  ],

  "event-spaces": [
    {
      question: "What are the best event spaces in Liberty Village?",
      answer:
        "Artscape Youngplace at 180 Shaw St offers stunning gallery spaces in a converted heritage school building perfect for product launches, exhibitions, and weddings. Liberty Commons at Big Rock Brewery handles large group events with their beer hall setup. The Rec Room on Lynn Williams St works well for corporate parties.",
    },
    {
      question: "How much does it cost to rent an event space in Liberty Village?",
      answer:
        "Artscape Youngplace gallery spaces rent from $1,500-5,000 depending on room size and duration. Converted warehouse lofts on Hanna Ave and Fraser Ave range from $2,000-8,000 for full-day events. Liberty Village's industrial heritage spaces require minimal decoration, which saves significantly on event styling costs.",
    },
    {
      question: "Are there wedding venues in Liberty Village?",
      answer:
        "Artscape Youngplace on Shaw St is the neighbourhood's most popular wedding venue, with heritage architecture and dramatic gallery spaces that photograph beautifully. Several converted loft spaces on Hanna Ave and Fraser Ave also host intimate weddings. Tonic Blooms on Atlantic Ave handles wedding florals for many local venues.",
    },
    {
      question: "Can I host a corporate event in Liberty Village?",
      answer:
        "Absolutely. Liberty Village is one of Toronto's top neighbourhoods for corporate events. Artscape Youngplace handles launches and galas, The Rec Room works for team outings, and Liberty Commons at Big Rock Brewery is ideal for holiday parties. Feast Catering Co. on Hanna Ave handles food for many local events.",
    },
  ],

  breweries: [
    {
      question: "What breweries are in Liberty Village?",
      answer:
        "Liberty Commons at Big Rock Brewery on East Liberty serves house-brewed craft beer in a sprawling beer hall setting. Left Field Brewery on Wagstaff Dr is a beloved baseball-themed taproom with flagship beers like Eephus oatmeal brown ale and Greenwood IPA plus rotating seasonal small-batch releases.",
    },
    {
      question: "Do Liberty Village breweries have taprooms?",
      answer:
        "Yes, both do. Liberty Commons at Big Rock Brewery has a massive indoor beer hall with communal tables, wood-fired pizza, and a rotating seasonal menu. Left Field Brewery on Wagstaff Dr has a taproom and patio that fill up fast on summer weekends. Flights are available at both for sampling.",
    },
    {
      question: "Can I buy beer to take home from Liberty Village breweries?",
      answer:
        "Left Field Brewery on Wagstaff Dr sells cans and bottles of their core lineup and seasonal releases to go. Liberty Commons at Big Rock Brewery also offers growler fills and packaged beer. Left Field's limited releases sell out quickly, so check their social media for new drop announcements.",
    },
    {
      question: "Are Liberty Village brewery patios dog-friendly?",
      answer:
        "Left Field Brewery's outdoor patio on Wagstaff Dr is popular with dog owners and generally welcomes leashed dogs. Liberty Commons at Big Rock Brewery also allows dogs on their patio area. Given the neighbourhood's massive dog population, you will see plenty of pups at both spots on weekends.",
    },
  ],

  "wine-bars": [
    {
      question: "Are there wine bars in Liberty Village?",
      answer:
        "Cibo Wine Bar at 100 Liberty St is the neighbourhood's premier wine bar, offering an extensive Italian wine list alongside refined pasta and pizza in a dark, moody atmosphere perfect for date nights. Their Aperitivo hour from 4-6pm on weekdays features half-price appetizers and ten-dollar cocktails.",
    },
    {
      question: "How much does wine cost at Liberty Village wine bars?",
      answer:
        "Glasses at Cibo Wine Bar on Liberty St start around $12-18, with bottles ranging from $40 to well over $100 for premium Italian selections. Their Aperitivo hour from 4-6pm weekdays offers the best value with ten-dollar cocktails alongside half-price small plates that make an affordable early dinner.",
    },
    {
      question: "What's the best wine bar for date night in Liberty Village?",
      answer:
        "Cibo Wine Bar at 100 Liberty St is the top date-night pick, with moody lighting, Italian elegance, and an outstanding wine list. School Restaurant on Fraser Ave also has an inventive cocktail menu in a romantic heritage setting. Both spots set the right tone without feeling overly formal.",
    },
    {
      question: "Do Liberty Village wine bars have happy hour?",
      answer:
        "Cibo Wine Bar runs an Aperitivo hour from 4 to 6pm on weekdays with half-price appetizers and ten-dollar cocktails. It is essentially a discounted dinner if you order enough small plates. Brazen Head Irish Pub and LOCAL Public Eatery also offer drink specials during their daily happy hour windows.",
    },
  ],

  pizza: [
    {
      question: "What's the best pizza in Liberty Village?",
      answer:
        "Pizza Libretto at 155 Liberty St serves VPN-certified Neapolitan pizza from a 900-degree wood oven, with their Margherita being a masterclass in simplicity. NODO at 1 East Liberty makes handmade pasta and pizza with 72-hour fermented dough. Liberty Commons at Big Rock Brewery also does solid wood-fired pizzas.",
    },
    {
      question: "Is there pizza delivery in Liberty Village?",
      answer:
        "Most Liberty Village pizza spots deliver to neighbourhood condos. Pizza Libretto offers delivery through major apps. NODO on East Liberty also delivers. For late-night slices, several options on King Street West serve the area through UberEats and DoorDash with typical delivery times under 30 minutes.",
    },
    {
      question: "How much does pizza cost in Liberty Village?",
      answer:
        "A Margherita at Pizza Libretto on Liberty St runs around $16-18. NODO's wood-fired pizzas are similarly priced at $15-20. Liberty Commons at Big Rock Brewery pairs pizza with house-brewed craft beer for a great combo. Delivery app markups add roughly $3-5 on top of in-restaurant prices.",
    },
    {
      question: "Are there wood-fired pizza places in Liberty Village?",
      answer:
        "Pizza Libretto at 155 Liberty St fires their pies in a 900-degree oven, producing leopard-spotted crusts in under 90 seconds. NODO at 1 East Liberty uses a custom-built Italian oven imported from Naples. Both are authentic Neapolitan-style pizzerias with the certifications to prove it.",
    },
  ],

  sushi: [
    {
      question: "What's the best sushi near Liberty Village?",
      answer:
        "Miku Toronto, while technically on the waterfront, is the closest premium sushi experience and worth the short trip. Their signature aburi flame-seared sushi is a Vancouver import beloved by Torontonians. For everyday sushi, several all-you-can-eat spots and mid-range Japanese restaurants operate along King Street West.",
    },
    {
      question: "Is there all-you-can-eat sushi near Liberty Village?",
      answer:
        "Several AYCE sushi restaurants are located along King Street West within a short streetcar ride from Liberty Village. Prices typically run $25-35 per person for lunch and $35-45 for dinner. Quality varies, so check recent Google reviews before picking a spot for the best value experience.",
    },
    {
      question: "How much does sushi cost near Liberty Village?",
      answer:
        "Miku Toronto runs $40-80 per person for a premium omakase-style experience. Mid-range sushi restaurants on King West offer maki and nigiri sets for $20-35. All-you-can-eat spots start around $25 at lunch. Delivery sushi from nearby restaurants typically adds a $4-6 delivery fee to menu prices.",
    },
    {
      question: "Can I get sushi delivered to Liberty Village?",
      answer:
        "Yes. Multiple sushi restaurants on King Street West deliver to Liberty Village through UberEats, DoorDash, and SkipTheDishes. Delivery times are typically 25-40 minutes. Miku Toronto also offers takeout for their aburi sushi if you want premium-quality sushi without the full restaurant experience.",
    },
  ],

  "thai-restaurants": [
    {
      question: "What's the best Thai food in Liberty Village?",
      answer:
        "Pai Northern Thai Kitchen at 171 East Liberty is widely considered one of the best Thai restaurants in all of Toronto. Their Khao Soi is a must-order. Chiang Mai Thai at 45 East Liberty is the OG neighbourhood Thai spot with reliable pad thai, green curry, and unbeatable weekday lunch combos under $15.",
    },
    {
      question: "How much does Thai food cost in Liberty Village?",
      answer:
        "Chiang Mai Thai on East Liberty is the neighbourhood's best value, with weekday lunch combos including curry, rice, spring roll, and soup for under $15. Pai Northern Thai is mid-range at $15-25 per entree. Both deliver to Liberty Village condos through major delivery apps.",
    },
    {
      question: "Is there Thai food delivery in Liberty Village?",
      answer:
        "Both Pai Northern Thai Kitchen and Chiang Mai Thai on East Liberty deliver throughout Liberty Village via UberEats and DoorDash. Chiang Mai's prices are especially affordable even with delivery markups. Pai's Khao Soi travels surprisingly well and is worth ordering for delivery on a cold night.",
    },
    {
      question: "Are Liberty Village Thai restaurants open for lunch?",
      answer:
        "Pai Northern Thai Kitchen opens at 11:30am for weekday lunch service. Chiang Mai Thai Restaurant opens at 11am Monday through Friday with their famous lunch combos. Both are excellent midday options for workers in the neighbourhood. Weekend lunch hours start slightly later at both locations.",
    },
  ],

  "italian-restaurants": [
    {
      question: "What are the best Italian restaurants in Liberty Village?",
      answer:
        "NODO at 1 East Liberty St serves outstanding wood-fired Neapolitan pizza with 72-hour fermented dough and house-made pasta. Cibo Wine Bar at 100 Liberty St offers refined Italian dining with an exceptional wine list and moody date-night atmosphere. Both represent different ends of the Italian dining spectrum.",
    },
    {
      question: "Is there handmade pasta in Liberty Village?",
      answer:
        "NODO at 1 East Liberty St makes their pasta in-house daily, alongside their famous wood-fired pizza. Their dough is fermented for 72 hours for maximum flavor. Cibo Wine Bar on Liberty St also serves refined pasta dishes. Both restaurants use quality imported Italian ingredients in their preparations.",
    },
    {
      question: "Which Liberty Village Italian restaurant is best for date night?",
      answer:
        "Cibo Wine Bar at 100 Liberty St is the premier Italian date-night spot, with dark moody interiors, an outstanding wine list, and refined pasta and pizza. NODO at 1 East Liberty has a warmer, more casual trattoria feel with communal tables ideal for relaxed evenings with friends.",
    },
    {
      question: "Do Italian restaurants in Liberty Village have happy hour?",
      answer:
        "Cibo Wine Bar runs an Aperitivo hour from 4 to 6pm on weekdays featuring half-price appetizers and ten-dollar cocktails. Ordering enough small plates during this window essentially gives you a discounted Italian dinner. NODO does not run a formal happy hour but has consistent regular pricing.",
    },
  ],

  "indian-restaurants": [
    {
      question: "Are there Indian restaurants in Liberty Village?",
      answer:
        "While Liberty Village does not have a dedicated Indian restaurant within its core boundaries, several excellent options on King Street West are within a short streetcar ride. The King West and Parkdale corridor has a strong selection of Indian restaurants serving butter chicken, biryani, dosa, and more.",
    },
    {
      question: "Can I get Indian food delivered to Liberty Village?",
      answer:
        "Yes. Multiple Indian restaurants along King Street West and in nearby Parkdale deliver to Liberty Village through UberEats, DoorDash, and SkipTheDishes. Delivery times are typically 20-35 minutes. Butter chicken, biryani, and tandoori dishes from these restaurants are popular orders in the neighbourhood.",
    },
    {
      question: "Where is the closest Indian restaurant to Liberty Village?",
      answer:
        "The closest Indian restaurants are along King Street West, about a 5-10 minute streetcar ride from Liberty Village. The Parkdale stretch of Queen Street West also has excellent options slightly further away. Both areas offer diverse Indian cuisine from north Indian to south Indian specialties and street food.",
    },
    {
      question: "Are there vegetarian Indian options near Liberty Village?",
      answer:
        "Indian restaurants near Liberty Village on King West and in Parkdale offer extensive vegetarian menus, as Indian cuisine naturally features many plant-based dishes. Dosa, paneer dishes, chana masala, and dal options are widely available. Several spots also cater to vegan diners with clearly marked menu items.",
    },
  ],

  "burger-joints": [
    {
      question: "What's the best burger in Liberty Village?",
      answer:
        "Burger Drops at 171 East Liberty is the neighbourhood favourite, known for smashed burgers with house-made pickles and a cult-following special sauce. The double smash with cheese and garlic aioli fries is the definitive Burger Drops experience. LOCAL Public Eatery also serves solid pub-style burgers.",
    },
    {
      question: "How much do burgers cost in Liberty Village?",
      answer:
        "Burger Drops on East Liberty offers smash burgers starting around $8-12, making it one of the best-value meals in the neighbourhood. Adding fries and a milkshake brings the total to around $18-22. LOCAL Public Eatery's burger menu runs slightly higher at $16-20 with more premium toppings.",
    },
    {
      question: "Is there a burger place open late in Liberty Village?",
      answer:
        "Burger Drops on East Liberty closes at 9pm daily, so it is not a late-night option. For late-night burgers, Brazen Head Irish Pub serves food until 2am with a solid pub burger on the menu. Moxie's late-night menu after 9pm also includes burger options on weekends.",
    },
    {
      question: "Does Burger Drops deliver in Liberty Village?",
      answer:
        "Burger Drops at 171 East Liberty offers delivery through major apps including UberEats and DoorDash. Their focused menu of smash burgers, loaded fries, and milkshakes travels well. The double smash burger holds up during delivery better than most. Expect 20-30 minute delivery times within the neighbourhood.",
    },
  ],

  bakeries: [
    {
      question: "Is there a bakery in Liberty Village?",
      answer:
        "Sweet Flour Bake Shop at 1 East Liberty St is a from-scratch bakery known for flaky butter tarts, seasonal pies, and custom cakes. Everything is baked in small batches daily. Their butter tart alone justifies a visit and is widely considered one of the best in Toronto.",
    },
    {
      question: "Can I order a custom cake in Liberty Village?",
      answer:
        "Sweet Flour Bake Shop on East Liberty creates beautifully decorated custom cakes for birthdays, weddings, and celebrations. Quality is consistent enough that locals pre-order for holidays weeks in advance. Discuss your design in person or by phone and allow at least one week for custom orders.",
    },
    {
      question: "What's the best bakery item to try in Liberty Village?",
      answer:
        "Sweet Flour Bake Shop's butter tart is legendary and the number one item to try. Their seasonal pies rotate throughout the year and always sell well. Fresh croissants are available early mornings. For holiday baking, order Thanksgiving and Christmas pies at least two weeks in advance as they cap orders.",
    },
    {
      question: "Are Liberty Village bakeries open on weekends?",
      answer:
        "Sweet Flour Bake Shop on East Liberty is open Saturday 9am to 5pm and Sunday 10am to 4pm. Arrive early for the best selection as popular items like butter tarts sell out by midday. Weekday mornings are less busy if you want to browse without a crowd.",
    },
  ],

  laundromats: [
    {
      question: "Are there laundromats near Liberty Village?",
      answer:
        "While most Liberty Village condos have in-suite laundry, laundromats along King Street West serve residents with large loads or specialty items. Drop-off wash-and-fold services are popular for bulky comforters and bedding that do not fit condo-sized machines. Several spots offer same-day turnaround for drop-off loads.",
    },
    {
      question: "Is there a wash-and-fold service near Liberty Village?",
      answer:
        "Laundromats on King Street West offer drop-off wash-and-fold services priced by weight, typically $1.50-2 per pound. This is ideal for Liberty Village residents dealing with bulky items or those without in-suite laundry. Some services offer pickup and delivery to condo lobbies for added convenience.",
    },
    {
      question: "How much does laundry cost near Liberty Village?",
      answer:
        "Self-service washing machines at nearby laundromats cost $3-5 per load and dryers run $2-4. Drop-off wash-and-fold services charge $1.50-2 per pound with a typical minimum of 10 pounds. For Liberty Village residents without in-suite laundry, weekly drop-off service is the most popular and time-efficient option.",
    },
    {
      question: "Can I get dry cleaning and laundry at the same place near Liberty Village?",
      answer:
        "King West Dry Cleaners at 100 Lynn Williams St handles both dry cleaning and standard laundry services. They offer combined pickup and delivery to Liberty Village condos. Keeping all your garment care at one provider simplifies scheduling, especially if you set up a recurring weekly service.",
    },
  ],

  "tattoo-parlors": [
    {
      question: "Are there tattoo parlors in Liberty Village?",
      answer:
        "Liberty Village's creative neighbourhood hosts several tattoo artists working out of industrial-chic studios on Hanna Ave and Fraser Ave. The broader King West corridor has additional highly rated shops. For custom work, book consultations in advance as the best artists have multi-week wait times.",
    },
    {
      question: "How much do tattoos cost near Liberty Village?",
      answer:
        "Small tattoos near Liberty Village start around $100-200 for simple designs. Medium pieces run $300-600, and larger custom work is priced at $150-250 per hour. Most shops require a deposit at booking. The King West and Queen West corridors have some of Toronto's most acclaimed tattoo artists.",
    },
    {
      question: "Do Liberty Village tattoo shops do walk-ins?",
      answer:
        "Some shops in the King West area accept walk-ins for small, simple designs depending on artist availability. Custom pieces always require a consultation and appointment booked in advance. Friday and Saturday walk-ins face the longest waits. Weekday afternoons offer the best chance for spontaneous smaller tattoos.",
    },
    {
      question: "What tattoo styles are popular in Liberty Village?",
      answer:
        "Liberty Village's creative demographic tends toward fine-line, minimalist, and geometric styles, though all styles are represented in the area's shops. The King West corridor also has artists specializing in traditional, realism, and blackwork. Check artist portfolios on Instagram before booking to ensure style compatibility.",
    },
  ],

  spas: [
    {
      question: "Are there spas in Liberty Village?",
      answer:
        "Altea Active at 2 Western Battery Rd includes spa services with facials and body treatments available alongside their premium gym membership. Several independent aestheticians and spa services operate along Atlantic Ave and Hanna Ave. The King West corridor also has day spas within a short streetcar ride.",
    },
    {
      question: "How much do spa treatments cost in Liberty Village?",
      answer:
        "Facials near Liberty Village run $100-180 depending on treatment type and duration. Body treatments and massage packages start around $120-200. Altea Active on Western Battery Rd offers spa services that can be bundled with gym membership for better value. King West day spas offer competitive introductory pricing.",
    },
    {
      question: "Can I get a facial in Liberty Village?",
      answer:
        "Yes. Several aestheticians near Liberty Village offer facials ranging from basic cleansing treatments to advanced options like microdermabrasion and chemical peels. Altea Active on Western Battery Rd has in-house spa services. Independent practitioners on Atlantic Ave and Hanna Ave also serve the neighbourhood by appointment.",
    },
    {
      question: "Are there couples spa packages near Liberty Village?",
      answer:
        "Day spas along King Street West offer couples massage and spa packages within a short streetcar ride from Liberty Village. Altea Active's spa on Western Battery Rd also accommodates couples treatments. Book weekend appointments well in advance as couples packages are popular for anniversaries and special occasions.",
    },
  ],

  "printing-services": [
    {
      question: "Are there printing services in Liberty Village?",
      answer:
        "Liberty Village's startup and creative community supports local print shops for business cards, signage, banners, and marketing materials. Several print services on Atlantic Ave and Hanna Ave cater to the neighbourhood's agencies and small businesses. For quick-turnaround jobs, same-day printing is available at nearby King West locations.",
    },
    {
      question: "Where can I print business cards near Liberty Village?",
      answer:
        "Print shops near Liberty Village on the King West corridor offer business card printing with typical turnaround of 2-3 business days. Rush same-day printing is available at a premium. Many Liberty Village startups and freelancers use a combination of local shops and online services like Moo or Vistaprint.",
    },
    {
      question: "How much does printing cost near Liberty Village?",
      answer:
        "Business cards typically run $30-80 per 250 cards at shops near Liberty Village. Large-format posters and banners start around $50-100 depending on size. Brochures and marketing materials are priced by quantity and paper stock. Local print shops often match online pricing for repeat business clients.",
    },
    {
      question: "Are there same-day printing services near Liberty Village?",
      answer:
        "Several print shops on King Street West offer same-day turnaround for rush jobs at a premium surcharge. Standard jobs typically take 2-5 business days. For Liberty Village's creative agencies and startups, building a relationship with a local printer means faster turnaround when deadlines are tight.",
    },
  ],

  "it-support": [
    {
      question: "Is there IT support available in Liberty Village?",
      answer:
        "Liberty Village's tech startup and remote worker population drives demand for local IT support services. Several providers along Atlantic Ave handle hardware repairs, network troubleshooting, and business IT setup. The neighbourhood's many coworking spaces also connect members with vetted IT professionals for technical needs.",
    },
    {
      question: "How much does IT support cost in Liberty Village?",
      answer:
        "Hourly IT support near Liberty Village runs $75-150 per hour depending on the complexity of the issue. Monthly managed IT packages for small businesses start around $500-1,500 covering monitoring, backups, and support. One-off hardware repairs like laptop screen replacements typically cost $150-400 plus parts.",
    },
    {
      question: "Can I get same-day computer repair in Liberty Village?",
      answer:
        "Some IT providers near Liberty Village offer same-day response for urgent issues like hardware failures or network outages. Standard repair turnaround is 2-3 business days. For quick fixes, several mobile repair technicians serve the neighbourhood and can come to your condo or coworking space directly.",
    },
    {
      question: "Do Liberty Village IT services support small businesses?",
      answer:
        "Yes. IT providers in the area specialize in small business support for the startups and creative agencies that dominate Liberty Village. Services include network setup, cloud migration, cybersecurity assessments, and ongoing managed IT. The Fueling Station and Spaces coworking both have IT support vendor referral networks.",
    },
  ],

  "interior-designers": [
    {
      question: "Are there interior designers who specialize in Liberty Village condos?",
      answer:
        "Several interior designers in the King West area specialize in the unique layouts of Liberty Village condos and lofts, from 400-square-foot studios to two-storey live-work units. They understand how to maximize space in compact units and work within condo board renovation guidelines specific to the neighbourhood's buildings.",
    },
    {
      question: "How much does interior design cost for a Liberty Village condo?",
      answer:
        "Interior design consultations near Liberty Village start around $150-300 for initial sessions. Full condo design packages typically run $3,000-10,000 depending on scope and unit size. Design-and-furnish packages for investors staging rental units are also popular in the neighbourhood's active rental market.",
    },
    {
      question: "Can an interior designer help with a small Liberty Village condo?",
      answer:
        "Absolutely. Designers familiar with Liberty Village specialize in maximizing small spaces, typically 400-700 square feet. They know which furniture scales work in local floor plans, how to create storage in compact kitchens, and how to make units feel larger through smart layout and lighting choices.",
    },
    {
      question: "Do interior designers handle condo renovations in Liberty Village?",
      answer:
        "Yes. Local designers manage renovation projects within Liberty Village condo board guidelines, which vary by building. They coordinate with approved contractors, handle permits, and ensure work meets building rules around noise hours and material disposal. Their building-specific experience prevents costly renovation mistakes and delays.",
    },
  ],

  locksmith: [
    {
      question: "Is there a locksmith that serves Liberty Village?",
      answer:
        "Several locksmiths serve Liberty Village with fast response times, typically arriving within 30-60 minutes for lockout situations. They understand the fob and key systems common in neighbourhood condo buildings. For non-emergency lock changes, booking a scheduled appointment is cheaper than emergency call-out rates.",
    },
    {
      question: "How much does a locksmith cost in Liberty Village?",
      answer:
        "Emergency lockout service in Liberty Village costs $80-150 depending on time of day. After-hours and weekend calls are more expensive. Standard lock changes run $100-200 including hardware. For condo fob issues, contact your building management first as they may handle fob replacements directly and more cheaply.",
    },
    {
      question: "What should I do if I'm locked out of my Liberty Village condo?",
      answer:
        "First check with your condo concierge, as many Liberty Village buildings have security staff who can assist during business hours. If no concierge is available, call a locksmith that serves the area. Keep your property management's emergency number saved in your phone for after-hours lockout situations.",
    },
    {
      question: "Can a locksmith program condo fobs in Liberty Village?",
      answer:
        "Condo fob programming is typically handled by your building's property management company rather than an independent locksmith. Contact your condo board or management office for fob replacements. Locksmiths can handle deadbolt and key lock changes for individual unit doors and storage locker locks within the building.",
    },
  ],
};

// ============================================================
// APPLY FAQs TO SERVICES
// ============================================================

let missingFaqCount = 0;

services.forEach((service) => {
  const faqs = allFaqs[service.slug];
  if (faqs) {
    service.specificFaqs = faqs;
  } else {
    missingFaqCount++;
    console.error(`WARNING: No FAQs defined for service "${service.slug}"`);
  }
});

if (missingFaqCount > 0) {
  console.error(`\nERROR: ${missingFaqCount} services are missing FAQs. Aborting.`);
  process.exit(1);
}

// ============================================================
// VALIDATION
// ============================================================

let errors = 0;
let warnings = 0;

services.forEach((service) => {
  const faqs = service.specificFaqs;

  // Check that we have 4-5 FAQs
  if (faqs.length < 4 || faqs.length > 5) {
    console.error(
      `ERROR [${service.slug}]: Has ${faqs.length} FAQs (expected 4-5)`
    );
    errors++;
  }

  faqs.forEach((faq, i) => {
    // Check for generic "How do I find the best" questions
    if (/how do i find the best/i.test(faq.question)) {
      console.error(
        `ERROR [${service.slug}] FAQ ${i + 1}: Generic "How do I find the best" question detected: "${faq.question}"`
      );
      errors++;
    }

    // Check for generic "What should I look for" questions
    if (/what should i look for when choosing/i.test(faq.question)) {
      console.error(
        `ERROR [${service.slug}] FAQ ${i + 1}: Generic "What should I look for" question detected: "${faq.question}"`
      );
      errors++;
    }

    // Validate answer word count (30-65 words)
    const wordCount = faq.answer.split(/\s+/).length;
    if (wordCount < 30) {
      console.error(
        `ERROR [${service.slug}] FAQ ${i + 1}: Answer too short (${wordCount} words, min 30): "${faq.answer.substring(0, 60)}..."`
      );
      errors++;
    }
    if (wordCount > 65) {
      console.warn(
        `WARNING [${service.slug}] FAQ ${i + 1}: Answer slightly long (${wordCount} words, max 65): "${faq.answer.substring(0, 60)}..."`
      );
      warnings++;
    }
  });
});

// ============================================================
// WRITE OUTPUT
// ============================================================

fs.writeFileSync(servicesPath, JSON.stringify(services, null, 2) + "\n", "utf8");

// ============================================================
// SUMMARY
// ============================================================

const totalFaqs = services.reduce(
  (sum, s) => sum + (s.specificFaqs ? s.specificFaqs.length : 0),
  0
);

console.log("\n=== FAQ Generation Summary ===");
console.log(`Services processed: ${services.length}`);
console.log(`Total FAQs generated: ${totalFaqs}`);
console.log(`Errors: ${errors}`);
console.log(`Warnings: ${warnings}`);

if (errors > 0) {
  console.log("\nFAQs written but validation FAILED — review errors above.");
  process.exit(1);
} else {
  console.log("\nAll FAQs validated successfully and written to services.json.");
}
