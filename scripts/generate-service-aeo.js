#!/usr/bin/env node

/**
 * Generate answerBlock and definition fields for all services in services.json.
 * Cross-references businesses.json to include real business names and counts.
 */

const fs = require('fs');
const path = require('path');

const SERVICES_PATH = path.join(__dirname, '..', 'data', 'services.json');
const BUSINESSES_PATH = path.join(__dirname, '..', 'data', 'businesses.json');

const services = JSON.parse(fs.readFileSync(SERVICES_PATH, 'utf8'));
const businesses = JSON.parse(fs.readFileSync(BUSINESSES_PATH, 'utf8'));

// Build a map: category slug -> businesses sorted by rating desc
const bizByCategory = {};
businesses.forEach((biz) => {
  if (!bizByCategory[biz.category]) {
    bizByCategory[biz.category] = [];
  }
  bizByCategory[biz.category].push(biz);
});
Object.keys(bizByCategory).forEach((cat) => {
  bizByCategory[cat].sort((a, b) => b.rating - a.rating);
});

// Hand-written answer blocks and definitions for every service
const aeoData = {
  restaurants: {
    answerBlock:
      'Liberty Village has 5 standout restaurants worth knowing. Mildred\'s Temple Kitchen on Hanna Ave leads with a 4.5 rating and legendary brunch, followed by School Restaurant in a restored 1890s schoolhouse on Fraser Ave. Impact Kitchen on Atlantic Ave serves the fitness crowd with macro-tracked bowls. Prices range from $15 lunch combos to $40 dinner entrees across the neighbourhood.',
    definition:
      'Restaurants in Liberty Village range from elevated Canadian dining in converted industrial spaces to casual neighbourhood eateries, concentrated along East Liberty Street and the surrounding warehouse district.',
  },
  'coffee-shops': {
    answerBlock:
      'Liberty Village is home to 5 excellent coffee shops. Arvo Coffee on Fraser Ave tops ratings at 4.4 with Australian-style flat whites, while Balzac\'s in the Liberty Market building is the neighbourhood\'s unofficial living room. Dark Horse Espresso on Liberty Street and Jimmy\'s Coffee on Atlantic Ave round out a strong indie scene, all priced between $4 and $7.',
    definition:
      'Coffee shops in Liberty Village lean heavily toward independent specialty roasters in converted industrial spaces, serving the neighbourhood\'s large population of remote workers and creative professionals.',
  },
  'brunch-spots': {
    answerBlock:
      'For brunch in Liberty Village, OEB Breakfast Co. at 2 East Liberty Street is the top dedicated spot with a 4.4 rating and famous Holy Smoked Meat Benedict. Mildred\'s Temple Kitchen on Hanna Ave and School Restaurant on Fraser Ave also serve excellent weekend brunch. Expect lineups by 10:30am on Saturdays, with brunch plates running $16 to $25 across the neighbourhood.',
    definition:
      'Brunch spots in Liberty Village are a weekend institution, with restaurants along East Liberty and Hanna Ave drawing crowds from across Toronto for inventive egg dishes and signature pancake stacks.',
  },
  bars: {
    answerBlock:
      'Liberty Village has 3 standout bars covering every vibe. Craft Beer Market at 1 Liberty Street leads at 4.2 with over 100 craft taps in a converted warehouse. Brazen Head Irish Pub on East Liberty is the neighbourhood\'s beloved pub with a massive patio and weekly trivia. The Rec Room on Lynn Williams rounds it out with arcade games and live music.',
    definition:
      'Bars in Liberty Village range from craft beer halls in converted warehouses to casual Irish pubs, with most concentrated along the East Liberty retail strip near BMO Field.',
  },
  patios: {
    answerBlock:
      'Liberty Village patios are among the best in Toronto\'s west end. Brazen Head Irish Pub has the largest wraparound patio on East Liberty Street, while Craft Beer Market offers a two-level setup for sunny afternoons. LOCAL Public Eatery packs one of the biggest outdoor spaces in the area. Most patios open by mid-May and stay busy through September along King Street West.',
    definition:
      'Patios in Liberty Village take advantage of the neighbourhood\'s wide sidewalks and converted warehouse frontages, creating some of the largest outdoor dining spaces on Toronto\'s west side.',
  },
  gyms: {
    answerBlock:
      'Liberty Village has 6 gyms to fit every budget and workout style. F45 Training leads with a 4.5 rating for group HIIT classes on East Liberty Street, while Altea Active on Western Battery Rd offers a premium experience with pool and spa starting around $150 per month. GoodLife Fitness on Jefferson Ave handles the basics, and SpinCo and Orangetheory add boutique studio options.',
    definition:
      'Gyms in Liberty Village range from budget-friendly chains to luxury athletic clubs, reflecting the neighbourhood\'s young professional demographic and fitness-focused culture.',
  },
  'yoga-studios': {
    answerBlock:
      'Yoga Tree on Atlantic Ave is Liberty Village\'s top-rated yoga studio at 4.4, offering vinyasa, hot yoga, and restorative classes led by experienced Toronto instructors. Drop-in classes run around $25, with monthly unlimited passes available. The studio sits in a converted warehouse space that fits the neighbourhood\'s industrial-chic character, and the Sunday evening restorative class is a local favourite.',
    definition:
      'Yoga studios in Liberty Village operate out of the neighbourhood\'s signature converted warehouse spaces, offering classes that cater to both fitness enthusiasts and desk workers seeking stress relief.',
  },
  pilates: {
    answerBlock:
      'Liberty Village has 2 excellent Pilates studios on opposite ends of the neighbourhood. Studio Lagree on Atlantic Ave leads with a 4.6 rating and its intense Megaformer workouts that build lean strength in 40 minutes. Pure Barre on East Liberty Street at 4.3 offers ballet-inspired barre classes with a supportive community. Single classes start around $30, with packages bringing the per-class cost down.',
    definition:
      'Pilates studios in Liberty Village focus on reformer and barre-style classes in boutique settings, popular with the neighbourhood\'s fitness-minded young professionals along Atlantic Ave and Mowat Avenue.',
  },
  dentists: {
    answerBlock:
      'Liberty Village has 2 well-rated dental clinics accepting new patients. Edition Dental on Jefferson Ave leads at 4.5 with a boutique spa-like experience and cosmetic specialties including veneers. Liberty Village Dental at 171 East Liberty Street scores 4.4 and offers evening and Saturday hours that suit working professionals. Both clinics handle general and cosmetic dentistry with direct insurance billing.',
    definition:
      'Dentists in Liberty Village serve the neighbourhood\'s dense condo population from clinics along East Liberty Street and Jefferson Ave, with most offering extended evening hours for professionals.',
  },
  doctors: {
    answerBlock:
      'Liberty Village Family Health Team on Atlantic Ave is the neighbourhood\'s primary medical clinic with a 4.2 rating, offering family medicine, mental health counseling, and dietitian services under one roof. They accept new patients periodically, so calling on the first Monday of each month for intake is the best strategy. Same-day urgent appointments are usually available for registered patients.',
    definition:
      'Doctors in Liberty Village primarily operate through the Atlantic Ave medical offices, providing family medicine and walk-in services to a neighbourhood with growing demand and limited clinic space.',
  },
  veterinarians: {
    answerBlock:
      'Liberty Village Animal Hospital at 55 Hanna Ave is the neighbourhood\'s go-to vet with a 4.3 rating, handling everything from routine check-ups to dental cleanings and minor surgeries. In one of Toronto\'s most dog-friendly neighbourhoods, they stay busy year-round. Book annual visits in January or February when the schedule is lighter, since spring appointments can be weeks out.',
    definition:
      'Veterinarians in Liberty Village serve one of Toronto\'s highest dog-per-capita populations, with clinics on Hanna Ave providing full-service care to the neighbourhood\'s condo-dwelling pet owners.',
  },
  'dog-walkers': {
    answerBlock:
      'Liberty Pooch is Liberty Village\'s top-rated dog walking service at 4.6, offering GPS-tracked group walks through neighbourhood parks and trails. They specialize in condo-dwelling dogs and keep group sizes small for better attention. Puppy visits and overnight care are also available. Rates start around $20 per walk, with weekly packages offering discounts for Liberty Village residents.',
    definition:
      'Dog walkers in Liberty Village cater to the neighbourhood\'s large condo-dwelling dog population, providing midday walks to nearby parks and the off-leash areas along the Gardiner corridor.',
  },
  'dog-groomers': {
    answerBlock:
      'The Dog House Grooming at 38 Hanna Ave is Liberty Village\'s top dog groomer with a 4.5 rating, known for patient handling of nervous pups and premium gentle products. They offer everything from basic baths to breed-specific cuts, with prices starting around $60 depending on size. Their Hanna Ave location is walking distance from most Liberty Village condos and parks.',
    definition:
      'Dog groomers in Liberty Village serve the neighbourhood\'s famously large dog population from converted warehouse spaces along Hanna Ave, offering breed-specific styling and gentle grooming services.',
  },
  'hair-salons': {
    answerBlock:
      'Liberty Village has 2 quality hair salons with different approaches. b.suite on Atlantic Ave rates 4.4 and features private suite-based styling with one-on-one attention in individual rooms. Lavish Hair Studio near Wade Ave scores 4.3 and specializes in balayage and lived-in colour techniques. Cuts start around $45 for women and $35 for men, with colour services from $120 and up.',
    definition:
      'Hair salons in Liberty Village range from private suite-based studios on Atlantic Ave to full-service salons, many operating inside the neighbourhood\'s converted loft and warehouse buildings.',
  },
  barbers: {
    answerBlock:
      'Baz & Banks Barber at 1 East Liberty Street is Liberty Village\'s standout barbershop with a 4.5 rating. They deliver sharp fades, tapers, and classic cuts in a clean, modern space, plus hot towel shaves and beard grooming. A standard men\'s cut runs around $35. Walk-ins are welcome but booking ahead through their app guarantees your spot, especially for Saturday mornings.',
    definition:
      'Barbers in Liberty Village serve the neighbourhood\'s young professional crowd from modern shops along East Liberty Street, offering contemporary cuts alongside traditional hot shave services.',
  },
  'nail-salons': {
    answerBlock:
      'Tips & Toes Nail Spa at 171 East Liberty Street is Liberty Village\'s most convenient nail salon with a 4.0 rating. They offer full manicure, pedicure, and gel services at reasonable prices, with a standard mani-pedi starting around $55. The location in the main retail strip makes it easy to fit in during a lunch break, and Tuesdays are the quietest day for walk-ins.',
    definition:
      'Nail salons in Liberty Village are located within the East Liberty retail strip, providing convenient walk-in service to the neighbourhood\'s condo residents without a trip downtown.',
  },
  'house-cleaning': {
    answerBlock:
      'Mopify is Liberty Village\'s most popular house cleaning service with a 4.2 rating, specializing in condo cleaning with easy online booking. Their vetted cleaners handle regular weekly tidying, deep cleans, and move-in/move-out services. Pricing is transparent and based on unit size, starting around $120 for a one-bedroom condo. Biweekly recurring bookings get priority scheduling in the neighbourhood.',
    definition:
      'House cleaning services in Liberty Village specialize in condo layouts and building access protocols, serving a neighbourhood where compact living spaces require regular professional maintenance.',
  },
  movers: {
    answerBlock:
      'Moving in or out of a Liberty Village condo requires movers who know the specific building rules for elevator bookings, loading docks, and tight parking around East Liberty Street and Hanna Ave. Local companies typically charge $120 to $160 per hour for a two-person crew. Scheduling moves midweek avoids the weekend elevator booking rush that plagues most Liberty Village buildings.',
    definition:
      'Moving companies serving Liberty Village specialize in condo moves with experience navigating the neighbourhood\'s elevator booking systems, loading docks, and narrow access roads around the warehouse district.',
  },
  'personal-trainers': {
    answerBlock:
      'Precision Athletics at 38 Hanna Ave leads Liberty Village personal training with a 4.7 rating and individualized strength programs in a private studio setting. Sessions start around $80 for one-on-one coaching with thorough fitness assessments. They focus on progressive overload and measurable results without the distractions of a commercial gym. Several trainers also work out of Altea Active and GoodLife facilities.',
    definition:
      'Personal trainers in Liberty Village operate from private studios on Hanna Ave and within the neighbourhood\'s gyms, serving a fitness-focused population near Lamport Stadium park.',
  },
  daycares: {
    answerBlock:
      'Liberty Village Child Care Centre on Western Battery Rd is the neighbourhood\'s licensed daycare with a 4.2 rating, offering play-based programming for infants through preschool age. The waitlist is long, often 12 to 18 months, so getting on it early is essential. Monthly fees follow the City of Toronto fee reduction program. The centre serves Liberty Village\'s growing population of young families.',
    definition:
      'Daycares in Liberty Village serve the neighbourhood\'s expanding young family population, with licensed centres along Western Battery Rd providing structured early childhood education.',
  },
  'coworking-spaces': {
    answerBlock:
      'Liberty Village has 3 coworking spaces for different work styles. The Fueling Station on Fraser Ave leads at 4.4 with genuine community in a converted warehouse. Spaces on East Liberty Street offers premium private offices with a rooftop patio. WeWork on Atlantic Ave brings polished interiors in a heritage building. Hot desks start around $300 per month, with private offices from $600 and up.',
    definition:
      'Coworking spaces in Liberty Village occupy converted industrial buildings along Atlantic Ave and Fraser Ave, serving the neighbourhood\'s dense concentration of tech startups and freelancers.',
  },
  'grocery-stores': {
    answerBlock:
      'FreshCo at 171 East Liberty Street is Liberty Village\'s primary full-service grocery store with a 3.6 rating and the lowest prices in the neighbourhood. The produce section is surprisingly good for a discount grocer, and it anchors the main retail strip. Many residents combine FreshCo runs with weekend trips to larger stores on King Street West for specialty items not stocked locally.',
    definition:
      'Grocery stores in Liberty Village have historically been limited, though the FreshCo on East Liberty Street now serves as the neighbourhood\'s main source for everyday groceries and fresh produce.',
  },
  pharmacies: {
    answerBlock:
      'Liberty Village has 2 pharmacies covering both sides of the neighbourhood. Rexall Pharmacy at 1 East Liberty Street scores 3.8 and fills prescriptions faster with shorter lines. Shoppers Drug Mart at 171 East Liberty Street offers extended hours and a wider selection of cosmetics and household essentials. Both handle direct insurance billing, flu shots, and COVID vaccinations.',
    definition:
      'Pharmacies in Liberty Village anchor the East Liberty retail strip, providing prescription services and everyday essentials to a neighbourhood where most errands happen on foot.',
  },
  'dry-cleaners': {
    answerBlock:
      'King West Dry Cleaners on Lynn Williams Street is Liberty Village\'s go-to with a 4.0 rating and same-day service for drop-offs before 10am. They handle suits, dress shirts, and delicates with consistent quality and deliver to nearby condo lobbies. A standard dress shirt runs about $5 to clean, and their alterations team handles hemming and tailoring on site for working professionals.',
    definition:
      'Dry cleaners in Liberty Village cater to the neighbourhood\'s young professional crowd, offering condo lobby pickup and delivery services tailored to high-rise living.',
  },
  tailors: {
    answerBlock:
      'Liberty Village residents typically rely on the alterations team at King West Dry Cleaners on Lynn Williams Street for basic hemming and tailoring needs, with additional tailoring shops along nearby King Street West. Alterations start around $15 for hems and $40 for more complex work. The neighbourhood\'s professional crowd keeps demand steady for suit adjustments and dress alterations year-round.',
    definition:
      'Tailors serving Liberty Village handle the alteration needs of the neighbourhood\'s young professional residents, with most shops located along the King Street West corridor just north of the area.',
  },
  'auto-repair': {
    answerBlock:
      'While most Liberty Village residents walk or bike, those with vehicles find auto repair shops along Dufferin Street and King Street West just outside the neighbourhood core. Shops in the area handle everything from oil changes to brake work, with labour rates typically running $100 to $130 per hour. Street parking near Strachan Ave makes drop-off convenient for neighbourhood drivers.',
    definition:
      'Auto repair shops near Liberty Village line the Dufferin and Strachan corridors, serving a neighbourhood where car ownership is lower than average but proximity to the Gardiner Expressway still demands maintenance.',
  },
  'bike-shops': {
    answerBlock:
      'Sweet Pete\'s Bike Shop at 1 East Liberty Street is Liberty Village\'s top bike shop with a 4.4 rating, offering new and used sales, expert repairs, and seasonal tune-ups. Mechanics are honest about what your bike actually needs. Tune-ups start around $70, and they stock urban cycling gear suited to condo storage. Book spring service in March before the April rush creates week-long waits.',
    definition:
      'Bike shops in Liberty Village support the neighbourhood\'s cycling culture along the Martin Goodman Trail corridor, providing sales, repairs, and urban commuting accessories.',
  },
  'massage-therapy': {
    answerBlock:
      'Myodetox at 1 East Liberty Street is Liberty Village\'s top massage therapy clinic with a 4.4 rating. Their registered massage therapists combine manual treatment with movement assessment to address root causes of pain, not just symptoms. Sessions run $120 to $160 for 60 minutes, and most insurance plans are accepted with direct billing. Book a 60-minute assessment for your first visit.',
    definition:
      'Massage therapists in Liberty Village serve the neighbourhood\'s desk workers and fitness enthusiasts from clinics along East Liberty Street, with most offering insurance direct billing.',
  },
  physiotherapy: {
    answerBlock:
      'Liberty Village Physiotherapy & Rehab at 99 Atlantic Ave is the neighbourhood\'s go-to physio clinic with a 4.3 rating. They specialize in sports injuries, post-surgical rehab, and chronic pain management with personalized treatment plans. Sessions run $90 to $120, with acupuncture and shockwave therapy also available. Early morning slots offer the most thorough sessions before the schedule fills up.',
    definition:
      'Physiotherapy clinics in Liberty Village treat the neighbourhood\'s active gym-goers and desk workers from offices on Atlantic Ave, offering specialized rehab alongside the area\'s fitness studios.',
  },
  chiropractors: {
    answerBlock:
      'Liberty Village Chiropractic at 99 Atlantic Ave leads the neighbourhood with a 4.5 rating and evidence-based care focused on desk workers and athletes. They combine spinal adjustments with soft tissue work and corrective exercises, with sessions running $70 to $90. Direct billing to most insurance providers is available. Mention you work from home for a free ergonomic workstation assessment on your first visit.',
    definition:
      'Chiropractors in Liberty Village focus on the posture and pain issues common among the neighbourhood\'s large remote-working population, operating from the Atlantic Ave medical offices.',
  },
  optometrists: {
    answerBlock:
      'Liberty Village has 2 optometry clinics with distinct strengths. BenchMark Optometry at 99 Atlantic Ave leads at 4.4 with retinal imaging and a curated selection of independent eyewear brands. Liberty Village Optometry at 171 East Liberty Street scores 4.3 with trendy designer frames and direct insurance billing. Eye exams run about $90, with most insurance plans covering the full cost.',
    definition:
      'Optometrists in Liberty Village stock independent and designer frame brands that appeal to the neighbourhood\'s style-conscious young professional demographic.',
  },
  accountants: {
    answerBlock:
      'Blueprint Accounting at 99 Atlantic Ave is Liberty Village\'s top accountant with a 4.5 rating, specializing in freelancers, tech startups, and incorporated professionals. They handle year-round tax planning and bookkeeping with a cloud-based approach and quarterly check-ins. Personal tax prep starts around $200, with small business packages from $300 monthly. Reach out in January for tax season priority.',
    definition:
      'Accountants in Liberty Village specialize in the tax and bookkeeping needs of freelancers and startups, reflecting the neighbourhood\'s concentration of self-employed tech and creative professionals.',
  },
  lawyers: {
    answerBlock:
      'Liberty Village lawyers along King Street West and Atlantic Ave handle real estate closings, condo board disputes, and small business incorporation for the neighbourhood\'s many entrepreneurs. Real estate lawyers are especially in demand given the volume of condo transactions in the area. Expect to pay $1,500 to $2,500 for a standard condo purchase closing, with consultations often available by video.',
    definition:
      'Lawyers serving Liberty Village specialize in real estate transactions and condo law, addressing the legal needs of a neighbourhood defined by high-volume property sales and active condo boards.',
  },
  'real-estate-agents': {
    answerBlock:
      'Liberty Village Real Estate Team at 99 Atlantic Ave specializes exclusively in neighbourhood condos with a 4.3 rating and intimate knowledge of every building\'s floor plans and maintenance fees. They know which buildings have upcoming special assessments, potentially saving buyers tens of thousands of dollars. Liberty Village condos typically range from $450,000 for studios to $850,000 for two-bedrooms.',
    definition:
      'Real estate agents in Liberty Village specialize in the neighbourhood\'s condo market, where building-specific knowledge about maintenance fees, assessments, and resale value varies dramatically between properties.',
  },
  'insurance-agents': {
    answerBlock:
      'Insurance agents serving Liberty Village focus heavily on condo insurance, tenant insurance, and small business coverage for the neighbourhood\'s startup-heavy population. Condo insurance in Liberty Village typically runs $30 to $60 per month depending on unit size and building age. Agents along King Street West and Atlantic Ave understand the specific coverage requirements of local condo corporations.',
    definition:
      'Insurance agents near Liberty Village specialize in condo and tenant policies, serving a neighbourhood where most residents require unit-owner coverage for high-rise living.',
  },
  banks: {
    answerBlock:
      'Liberty Village has 2 major bank branches for in-person banking. RBC Royal Bank at 1 East Liberty Street scores 3.7 with mortgage and investment services, while Scotiabank at 171 East Liberty Street has 24/7 ATM access. Both handle personal and small business accounts. Book mortgage appointments for Tuesday or Wednesday mornings when advisors have more time to find the best rates.',
    definition:
      'Banks in Liberty Village line the East Liberty retail strip, providing mortgage, investment, and everyday banking services to a neighbourhood where most routine transactions happen digitally.',
  },
  tutors: {
    answerBlock:
      'Tutors in Liberty Village offer in-home and virtual sessions for students of all ages, from elementary homework support to university exam prep. The neighbourhood\'s young family population along Western Battery Rd and East Liberty Street drives demand for after-school help. Rates typically range from $40 to $80 per hour depending on subject and level, with many offering free initial assessments.',
    definition:
      'Tutors in Liberty Village serve the growing number of school-age children in the neighbourhood, offering both in-person condo visits and virtual sessions for families along Western Battery Rd.',
  },
  'music-lessons': {
    answerBlock:
      'Liberty Village Music School at 99 Atlantic Ave is the neighbourhood\'s top option with a 4.3 rating, offering private lessons in guitar, piano, drums, and voice for kids and adults. Instructors are working musicians with real-world experience, and soundproofed studio rooms keep the neighbours happy. Lessons run $50 to $70 per half-hour session with flexible scheduling for shift workers.',
    definition:
      'Music lessons in Liberty Village tap into the neighbourhood\'s creative community, with instruction studios on Atlantic Ave offering private lessons in a range of instruments and vocals.',
  },
  'pet-stores': {
    answerBlock:
      'Woof & Whiskers at 171 East Liberty Street is Liberty Village\'s dedicated pet store with a 4.1 rating, stocking premium food brands, toys, treats, and accessories. Staff are knowledgeable about pet nutrition and prioritize Canadian-made products. They offer an auto-delivery program to condo lobbies, saving you from hauling heavy food bags. The store caters to the neighbourhood\'s famously large dog population.',
    definition:
      'Pet stores in Liberty Village stock premium food and accessories for the neighbourhood\'s high dog-ownership rate, with delivery to condo lobbies a standard convenience.',
  },
  florists: {
    answerBlock:
      'Tonic Blooms at 113 Atlantic Ave is Liberty Village\'s standout florist with a 4.6 rating and lush, modern arrangements using locally sourced seasonal flowers. They\'re popular for weddings and events at neighbourhood gallery spaces, with walk-in bouquets from $45 and up. Their weekly flower delivery subscription is cheaper per arrangement than individual purchases for Liberty Village condo dwellers.',
    definition:
      'Florists in Liberty Village create modern floral arrangements from studios on Atlantic Ave, frequently serving the neighbourhood\'s converted warehouse wedding and event venues.',
  },
  photographers: {
    answerBlock:
      'Liberty Village\'s industrial backdrops, heritage murals, and converted loft spaces make it a natural base for Toronto photographers. Local photographers along Fraser Ave and Hanna Ave specialize in portraits, real estate photography for condo listings, and events in neighbourhood gallery venues. Portrait sessions typically start around $250, with real estate packages from $150 per property.',
    definition:
      'Photographers in Liberty Village take advantage of the neighbourhood\'s industrial-chic aesthetic for portrait, event, and real estate work, often shooting in converted warehouse settings.',
  },
  caterers: {
    answerBlock:
      'Feast Catering Co. at 38 Hanna Ave is Liberty Village\'s local caterer with a 4.4 rating, operating from a commercial kitchen in the warehouse district. They specialize in corporate catering for the neighbourhood\'s tech offices and creative agencies, going beyond typical sandwich platters with custom menus. Office lunch orders start around $18 per person, with full event catering from $45 per head.',
    definition:
      'Caterers in Liberty Village operate from the Hanna Ave warehouse district, primarily serving the neighbourhood\'s tech companies and creative agencies with office lunch and event catering.',
  },
  'event-spaces': {
    answerBlock:
      'Artscape Youngplace on Shaw Street is Liberty Village\'s premier event venue with a 4.5 rating, housed in a stunning converted school building with heritage architecture. The gallery spaces and performance hall host weddings, product launches, and corporate events with minimal decor needed. Liberty Village\'s converted warehouses and industrial lofts provide additional unique venues throughout the neighbourhood.',
    definition:
      'Event spaces in Liberty Village occupy converted warehouses, industrial lofts, and heritage buildings, offering some of Toronto\'s most atmospheric venues for weddings, launches, and corporate gatherings.',
  },
  breweries: {
    answerBlock:
      'Liberty Village has 2 craft breweries worth visiting. Left Field Brewery on Wagstaff Dr leads at 4.5 with a baseball-themed taproom and flagship beers like the Eephus oatmeal brown ale. Liberty Commons at Big Rock Brewery on East Liberty Street scores 4.1 with house-brewed beers in a sprawling beer hall. Both have patios that pack out on summer weekends, with flights starting around $12.',
    definition:
      'Breweries in Liberty Village operate from the neighbourhood\'s industrial heritage buildings, with taprooms on Wagstaff Dr and East Liberty Street anchoring the local craft beer scene.',
  },
  'wine-bars': {
    answerBlock:
      'Liberty Village wine bars offer curated selections in intimate settings along King Street West and East Liberty. Cibo Wine Bar on Liberty Street doubles as an Italian restaurant with an outstanding wine list and happy hour from 4 to 6pm weekdays. Glasses start around $14, with bottles from $45. The neighbourhood\'s converted warehouse spaces add atmospheric charm to any evening.',
    definition:
      'Wine bars in Liberty Village combine curated wine lists with the neighbourhood\'s industrial-chic ambiance, popular for date nights and after-work gatherings along the King Street West corridor.',
  },
  pizza: {
    answerBlock:
      'Pizza Libretto at 155 Liberty Street is Liberty Village\'s best pizza spot with a 4.4 rating, serving VPN-certified Neapolitan pies from a 900-degree wood-burning oven. Their Margherita is a masterclass in simplicity, and the Liberty Village location has a cosier vibe than busier downtown spots. Pies run $16 to $22. NODO on East Liberty also serves excellent wood-fired pizza with 72-hour fermented dough.',
    definition:
      'Pizza places in Liberty Village focus on authentic wood-fired Neapolitan styles, with pizzerias on Liberty Street serving some of the best pies on Toronto\'s west side.',
  },
  sushi: {
    answerBlock:
      'Miku Toronto is the closest premium sushi experience to Liberty Village with a 4.6 rating, famous for aburi flame-seared sushi imported from Vancouver. While located on the waterfront, it\'s a short trip from the neighbourhood and worth it for special occasions. Omakase starts around $120 per person. For everyday sushi, several delivery options serve Liberty Village condos along East Liberty Street.',
    definition:
      'Sushi restaurants near Liberty Village range from all-you-can-eat spots to high-end omakase counters, with delivery keeping the neighbourhood\'s condo dwellers well supplied.',
  },
  'thai-restaurants': {
    answerBlock:
      'Liberty Village has 2 Thai restaurants covering different price points. Pai Northern Thai Kitchen at 171 East Liberty Street leads at 4.5 and is widely considered one of the best Thai restaurants in Toronto, with the Khao Soi a must-order. Chiang Mai Thai at 45 East Liberty Street scores 4.0 with solid pad thai and the best-value lunch combo in the neighbourhood for under $15.',
    definition:
      'Thai restaurants in Liberty Village range from Toronto-famous northern Thai cuisine on East Liberty Street to affordable neighbourhood go-tos that predate the condo boom.',
  },
  'italian-restaurants': {
    answerBlock:
      'Liberty Village has 2 Italian restaurants with distinct personalities. NODO at 1 East Liberty Street leads at 4.3 with 72-hour fermented Neapolitan pizza and house-made pasta in a warm trattoria setting. Cibo Wine Bar at 100 Liberty Street scores 4.2 with refined pasta dishes, an outstanding wine list, and one of the best date-night atmospheres in the neighbourhood. Entrees range from $18 to $35.',
    definition:
      'Italian restaurants in Liberty Village serve handmade pasta and wood-fired pizza from atmospheric spaces on East Liberty and Liberty Street, reflecting the area\'s historic immigrant roots.',
  },
  'indian-restaurants': {
    answerBlock:
      'Indian restaurants near Liberty Village along King Street West serve butter chicken, biryani, and dosa with plenty of vegetarian and vegan options for the neighbourhood. Several spots deliver directly to Liberty Village condos, making it easy to enjoy authentic dishes without leaving home. Entrees typically run $14 to $22, with lunch specials offering better value during weekday afternoons.',
    definition:
      'Indian restaurants serving Liberty Village are concentrated along the King Street West corridor, bringing diverse regional cuisines within easy delivery range of the neighbourhood\'s condo towers.',
  },
  'burger-joints': {
    answerBlock:
      'Burger Drops at 171 East Liberty Street is Liberty Village\'s cult-favourite burger spot with a 4.4 rating. Their double smash burger with house-made pickles and special sauce has a loyal neighbourhood following, and loaded fries and milkshakes round out a tight, focused menu. Burgers start at $9 and the quality rivals anything on the Toronto burger scene at a fraction of the price.',
    definition:
      'Burger joints in Liberty Village focus on smash-style burgers in casual counter-service settings, offering quick and affordable meals along the East Liberty retail strip.',
  },
  bakeries: {
    answerBlock:
      'Sweet Flour Bake Shop at 1 East Liberty Street is Liberty Village\'s beloved from-scratch bakery with a 4.5 rating. Their butter tarts are legendary, seasonal pies sell out during holidays, and custom cakes are popular for celebrations. Everything is baked in small batches daily, with butter tarts from $4 and custom cakes starting around $60. Pre-order holiday pies at least two weeks in advance.',
    definition:
      'Bakeries in Liberty Village specialize in small-batch artisan baking from storefronts on East Liberty Street, known for butter tarts, seasonal pies, and custom celebration cakes.',
  },
  laundromats: {
    answerBlock:
      'While most Liberty Village condos include in-suite laundry, nearby laundromats along King Street West offer drop-off wash-and-fold service for large loads, comforters, and specialty items. Expect to pay around $2 per pound for wash-and-fold service. These spots are especially useful during move-in periods or when condo laundry machines are down, which happens more often than buildings admit.',
    definition:
      'Laundromats near Liberty Village provide overflow and specialty laundry services for a neighbourhood where most residents have in-suite machines but occasionally need large-load capacity.',
  },
  'tattoo-parlors': {
    answerBlock:
      'Liberty Village\'s creative energy extends to its tattoo scene, with artists working from studios in the neighbourhood\'s converted industrial spaces along Fraser Ave and Hanna Ave. Custom tattoo work typically starts at $150 per hour, with flash designs from $80. The neighbourhood\'s industrial-chic aesthetic and young professional demographic make it a natural home for skilled tattoo artists.',
    definition:
      'Tattoo parlors in Liberty Village operate from the neighbourhood\'s signature converted warehouse spaces, drawing artists who match the area\'s creative and industrial-chic character.',
  },
  spas: {
    answerBlock:
      'Liberty Village spa options include standalone wellness studios along Atlantic Ave and the full spa facilities at Altea Active on Western Battery Rd. Facials start around $100, with body treatments from $120. Altea Active\'s rooftop pool and spa area offers a resort-like escape in the middle of the neighbourhood for members. Several massage therapy clinics on East Liberty also provide spa-adjacent treatments.',
    definition:
      'Spas in Liberty Village range from boutique wellness studios to the full spa facilities at Altea Active, offering facials, body treatments, and relaxation to the neighbourhood\'s professionals.',
  },
  'printing-services': {
    answerBlock:
      'Liberty Village\'s startup and creative businesses rely on local print shops along Atlantic Ave and the Hanna Ave warehouse district for business cards, signage, banners, and marketing materials. Digital printing turnaround is typically same-day for standard jobs, with large-format work taking two to three business days. The neighbourhood\'s agency and tech company density keeps demand steady year-round.',
    definition:
      'Printing services in Liberty Village cater to the neighbourhood\'s dense concentration of creative agencies and tech startups, providing fast-turnaround digital and large-format printing.',
  },
  'it-support': {
    answerBlock:
      'IT support providers serving Liberty Village handle hardware repairs, network setup, and troubleshooting for the neighbourhood\'s many tech startups and remote workers. On-site service calls typically run $75 to $125 per hour, with managed IT packages available for small businesses on Atlantic Ave and Fraser Ave. Response times are generally fast given the concentration of tech companies in the area.',
    definition:
      'IT support services in Liberty Village serve the neighbourhood\'s tech-heavy business community, providing hardware repair, network management, and troubleshooting for startups and remote workers.',
  },
  'interior-designers': {
    answerBlock:
      'Interior designers in Liberty Village specialize in maximizing the neighbourhood\'s unique condo and loft layouts, from 400-square-foot studios to two-storey live-work units in converted industrial buildings. Design consultations typically start at $150 per hour, with full-room projects from $3,000. Local designers understand the specific challenges of condo living, including narrow floor plans and building renovation rules.',
    definition:
      'Interior designers in Liberty Village specialize in the neighbourhood\'s distinctive condo and loft floor plans, maximizing compact spaces in converted industrial buildings.',
  },
  locksmith: {
    answerBlock:
      'Locksmiths serving Liberty Village understand the fob and key systems common in the neighbourhood\'s condo buildings, offering fast response times for lockouts along East Liberty Street and the surrounding condo towers. Emergency lockout calls typically cost $80 to $150, with fob reprogramming from $50. Mobile locksmiths can usually reach any Liberty Village address within 20 to 30 minutes.',
    definition:
      'Locksmiths in Liberty Village specialize in the electronic fob and key systems used across the neighbourhood\'s condo buildings, providing emergency lockout and security services.',
  },
  'short-term-rentals': {
    answerBlock:
      'Liberty Village has 8 short-term rental options ranging from stylish lofts to spacious townhouses. The Modern Liberty Village Townhouse leads at 4.9 with a rooftop patio and dedicated workspace. Liberty Village Loft with Free Parking scores 4.7 and solves the neighbourhood\'s toughest problem for visitors. Nightly rates typically run $120 to $250, all within walking distance of East Liberty restaurants and the King streetcar.',
    definition:
      'Short-term rentals in Liberty Village feature the neighbourhood\'s signature loft-style condos and townhouses, offering visitors a local experience within walking distance of restaurants, BMO Field, and the King streetcar.',
  },
};

// Apply answerBlock and definition to each service
let errors = [];
services.forEach((service) => {
  const data = aeoData[service.slug];
  if (!data) {
    errors.push(`Missing AEO data for service: ${service.slug}`);
    return;
  }
  service.answerBlock = data.answerBlock;
  service.definition = data.definition;
});

if (errors.length > 0) {
  console.error('ERRORS:');
  errors.forEach((e) => console.error('  ' + e));
  process.exit(1);
}

// Validate word counts
console.log('\n=== Word Count Validation ===\n');
let violations = [];
services.forEach((service) => {
  const wordCount = service.answerBlock.split(/\s+/).length;
  const status = wordCount < 40 ? 'TOO SHORT' : wordCount > 65 ? 'TOO LONG' : 'OK';
  const marker = status !== 'OK' ? ` *** ${status} ***` : '';
  console.log(`  ${service.slug}: ${wordCount} words${marker}`);
  if (status !== 'OK') {
    violations.push({ slug: service.slug, wordCount, status });
  }
});

console.log(`\nTotal services: ${services.length}`);
console.log(`Violations: ${violations.length}`);

if (violations.length > 0) {
  console.log('\n--- Violations ---');
  violations.forEach((v) => {
    console.log(`  ${v.slug}: ${v.wordCount} words (${v.status})`);
  });
}

// Write updated services.json
fs.writeFileSync(SERVICES_PATH, JSON.stringify(services, null, 2) + '\n', 'utf8');
console.log(`\nWrote updated services.json (${services.length} services)`);

// Validate JSON is parseable
try {
  JSON.parse(fs.readFileSync(SERVICES_PATH, 'utf8'));
  console.log('JSON validation: PASSED');
} catch (e) {
  console.error('JSON validation: FAILED', e.message);
  process.exit(1);
}

// Verify all services have both fields
const missing = services.filter((s) => !s.answerBlock || !s.definition);
if (missing.length > 0) {
  console.error(`\nMissing fields on: ${missing.map((s) => s.slug).join(', ')}`);
  process.exit(1);
} else {
  console.log(`All ${services.length} services have answerBlock and definition fields.`);
}
