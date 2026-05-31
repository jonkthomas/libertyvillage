#!/usr/bin/env node

/**
 * Generate AEO (Answer Engine Optimization) fields for all topics in topics.json.
 * Adds: answerSummary, keyTakeaways, definitions
 */

const fs = require('fs');
const path = require('path');

const TOPICS_PATH = path.join(__dirname, '..', 'data', 'topics.json');

// AEO data keyed by slug
const aeoData = {
  'parking-guide': {
    answerSummary:
      'Parking in Liberty Village is limited and competitive. Street meters cost about $3 per hour via Green P, with free parking after 9 PM. Monthly underground condo spots run $150 to $250. Residential permits cost roughly $200 per year but do not guarantee a space. On TFC game days at BMO Field, towing is aggressive near Strachan Avenue, so transit is your safest bet.',
    keyTakeaways: [
      'Download the Green P app to pay meters remotely and extend time without returning to your car.',
      'Monthly underground parking in condo buildings runs $150 to $250, and apps like SpotHero list available spots.',
      'Residential parking permits cost roughly $200 per year and cover zones around Mowat Avenue and Hanna Avenue.',
      'On TFC game days, avoid parking on Hanna Avenue entirely because towing starts two hours before kickoff.',
      'Free street parking kicks in after 9 PM on most Liberty Village meters and on Sundays.'
    ],
    definitions: [
      { term: 'Green P', definition: 'Toronto\'s municipal parking authority, which operates pay-and-display meters and public parking lots throughout the city. The Green P app lets you pay and extend meter time from your phone.' },
      { term: 'BMO Field', definition: 'A 30,000-seat stadium at the south end of Liberty Village, home to Toronto FC (MLS) and the Toronto Argonauts (CFL). Game days significantly impact local parking and traffic.' },
      { term: '504 King streetcar', definition: 'The TTC streetcar route running along King Street West through Liberty Village, connecting the neighbourhood to Union Station and Roncesvalles. It is the primary transit link for the area.' }
    ]
  },

  'traffic-tips': {
    answerSummary:
      'Liberty Village traffic is worst on weekday mornings from 7:30 to 9:30 AM and evenings from 4:30 to 7 PM, especially on King Street West near the Gardiner on-ramp. Use Hanna Avenue to Wellington Street West as an eastbound bypass, and Dufferin Street south for Gardiner westbound access. On TFC game days, leave two hours early or take the 504 streetcar instead of driving.',
    keyTakeaways: [
      'Use Hanna Avenue north to Wellington Street West as your eastbound escape route to avoid King Street congestion.',
      'For Gardiner westbound access, take Dufferin Street south from Liberty Street directly to the on-ramp.',
      'Leave Liberty Village at least two hours before any BMO Field event to avoid total gridlock.',
      'Check City of Toronto road closure notices every Sunday night to plan around construction lane closures.',
      'The 504 King streetcar or cycling the Martin Goodman Trail are often faster than driving during rush hour.'
    ],
    definitions: [
      { term: 'Gardiner Expressway', definition: 'An elevated highway running along Toronto\'s waterfront that borders Liberty Village to the south. It is a main east-west commuter route but creates bottlenecks at its on-ramps near Strachan Avenue and Dufferin Street.' },
      { term: 'BMO Field', definition: 'A 30,000-seat stadium at the south end of Liberty Village, home to Toronto FC and the Toronto Argonauts. Events here cause significant traffic disruptions in the surrounding streets.' },
      { term: 'King Street Transit Priority', definition: 'A City of Toronto traffic management measure that restricts through-traffic on King Street to prioritize the 504 King streetcar, helping separate transit from car congestion.' }
    ]
  },

  'moving-guide': {
    answerSummary:
      'Moving into Liberty Village requires booking your condo freight elevator at least two weeks ahead and using a maximum 20-foot truck for tight laneways. Apply for a City of Toronto street occupation permit if your building lacks a loading dock. Set up Beanfield internet a week before move day for a smooth transition.',
    keyTakeaways: [
      'Book your condo building freight elevator at least two weeks in advance since first and last of month slots fill fast.',
      'Use a 20-foot moving truck maximum because larger vehicles cannot navigate Liberty Village condo laneways safely.',
      'Apply for a City of Toronto street occupation permit five business days ahead if your building has no loading dock.',
      'Set up Beanfield internet before move-in day because they need about a week of lead time for installation.',
      'Join the Liberty Village Residents Association and local social media groups to learn about events and get neighbour recommendations.'
    ],
    definitions: [
      { term: 'Beanfield Metroconnect', definition: 'A Toronto-based internet provider offering fibre-to-the-suite service in many Liberty Village condos. Known for low latency and competitive pricing, it is the preferred ISP for the neighbourhood.' },
      { term: 'Freight elevator', definition: 'A large service elevator in condo buildings designated for moving furniture and large items. Most Liberty Village buildings require booking it in advance with a refundable damage deposit.' },
      { term: 'Liberty Market Building', definition: 'A converted carpet factory on Liberty Street that now houses food vendors, specialty shops, and community spaces. It is a central gathering point in the neighbourhood.' }
    ]
  },

  'noise-complaints': {
    answerSummary:
      'Noise in Liberty Village comes from construction, patios, BMO Field events, and the Gardiner Expressway. Toronto\'s Noise Bylaw restricts construction to 7 AM to 7 PM weekdays and 9 AM to 7 PM Saturdays. Report violations through 311. For condo-internal noise, contact property management. Heavy curtains and white noise machines help.',
    keyTakeaways: [
      'Call 311 immediately for construction noise before 7 AM on weekdays or before 9 AM on Saturdays, as these are bylaw violations.',
      'Check your condo declaration for building-specific quiet hours, which are typically 10 PM to 8 AM.',
      'Heavy curtains and area rugs are inexpensive soundproofing upgrades for units facing the Gardiner Expressway.',
      'For persistent condo-internal noise, your building property management can issue warnings and the condo board can levy fines.',
      'Join the Liberty Village Residents Association to collectively advocate on noise policy with developers and the City.'
    ],
    definitions: [
      { term: 'Toronto Noise Bylaw (Chapter 591)', definition: 'The City of Toronto bylaw that sets legal limits on noise, including construction hours and amplified sound restrictions after 11 PM on weeknights and midnight on weekends.' },
      { term: '311 Toronto', definition: 'The City of Toronto\'s non-emergency services line for reporting issues like noise violations, parking complaints, and property standards. Available by phone and through a mobile app.' },
      { term: 'Gardiner Expressway', definition: 'An elevated highway running along Toronto\'s waterfront, south of Liberty Village. Its constant traffic hum is a primary source of ambient noise for south-facing condo units in the neighbourhood.' }
    ]
  },

  'internet-providers': {
    answerSummary:
      'The best internet provider in Liberty Village is Beanfield Metroconnect, offering fibre-to-the-suite at around $50 per month for 500 Mbps in supported buildings. Bell Fibe and Rogers Ignite are widely available alternatives ranging from $60 to $120 monthly. Budget-conscious residents can save $10 to $30 per month with resellers like TekSavvy. Always check which providers are wired into your specific building before signing a lease.',
    keyTakeaways: [
      'Check if Beanfield is available in your building before signing a lease because it offers the best speed-to-value ratio in the neighbourhood.',
      'Ask your property manager which ISPs have infrastructure wired into the building since options vary significantly.',
      'TekSavvy and Start.ca use the same Bell and Rogers infrastructure for $10 to $30 less per month.',
      'Aim for 500 Mbps or higher if multiple people work from home or stream simultaneously in your unit.',
      'Keep a mobile hotspot plan as backup since construction projects occasionally cut underground fibre lines.'
    ],
    definitions: [
      { term: 'Fibre-to-the-suite (FTTS)', definition: 'An internet connection where fibre optic cable runs directly into your individual condo unit, delivering the fastest and most reliable speeds. Beanfield offers this in many newer Liberty Village buildings.' },
      { term: 'Beanfield Metroconnect', definition: 'A Toronto-based independent internet provider offering fibre service in many Liberty Village condos. Known for low latency, symmetrical speeds, and competitive pricing starting at about $50 per month.' },
      { term: 'Internet reseller', definition: 'Companies like TekSavvy and Start.ca that purchase wholesale access to Bell and Rogers network infrastructure and sell internet service at lower monthly rates, typically with the same speeds.' }
    ]
  },

  'recycling-waste-guide': {
    answerSummary:
      'Liberty Village condos manage waste through building waste rooms with separate bins for garbage, recycling, and organics. Blue box recycling accepts paper, cardboard, metals, glass, and plastics 1 through 7. Green bin takes food scraps and compostable bags. Electronics and batteries need special disposal at city depots or retailers.',
    keyTakeaways: [
      'Rinse containers before recycling and flatten cardboard boxes to save space in shared waste rooms.',
      'Use a small kitchen compost bin with compostable bags to make green bin sorting convenient for condo living.',
      'Never put batteries in regular garbage because they are a fire hazard in waste collection trucks.',
      'Contact your property management about large item disposal procedures before leaving furniture in hallways.',
      'Review your building\'s waste rules when you move in since some condos levy fines for recycling contamination.'
    ],
    definitions: [
      { term: 'Blue box recycling', definition: 'Ontario\'s standardized residential recycling program accepting paper, cardboard, metal cans, glass, and plastics marked 1 through 7. In condos, this is sorted into designated bins in the building waste room.' },
      { term: 'Green bin', definition: 'Toronto\'s organics diversion program for food scraps, coffee grounds, food-soiled paper, and compostable bags. Condo buildings have green bin collection in their waste rooms alongside garbage and recycling.' },
      { term: 'E-waste', definition: 'Electronic waste including old phones, computers, cables, and batteries that cannot go in regular garbage or recycling. The City of Toronto holds periodic drop-off events and some retailers accept e-waste year-round.' }
    ]
  },

  'transit-guide': {
    answerSummary:
      'Exhibition GO Station is Liberty Village\'s fastest transit option, reaching Union Station in 5 minutes. The 504 King streetcar runs every 3 to 5 minutes at rush hour with stops at Strachan, Atlantic, and Dufferin. The 29 Dufferin bus connects to Line 2 subway. All vehicles accept Presto with free TTC transfers within two hours.',
    keyTakeaways: [
      'Exhibition GO Station reaches Union Station in 5 minutes, making it dramatically faster than the streetcar during rush hour.',
      'The 504 King streetcar at Atlantic Avenue gets packed from 5 to 6:30 PM so try boarding one stop earlier at Strachan.',
      'All TTC and GO vehicles accept Presto, with free TTC transfers within a two-hour window of tapping.',
      'The 304 night bus replaces the 504 streetcar after approximately 1:30 AM with service every 30 minutes.',
      'Bike Share Toronto stations let you ride to Exhibition GO in 3 minutes instead of walking 10.'
    ],
    definitions: [
      { term: 'Presto', definition: 'The reloadable smart card used to pay fares on the TTC, GO Transit, and other transit systems across the Greater Toronto Area. Load it online or at Shoppers Drug Mart locations.' },
      { term: 'TTC (Toronto Transit Commission)', definition: 'Toronto\'s public transit system operating subways, streetcars, and buses. A single Presto fare is $3.35 with free transfers within two hours.' },
      { term: 'Exhibition GO Station', definition: 'A GO Transit station at the southeast corner of Liberty Village on the Lakeshore West line. It provides a 5-minute train ride to Union Station, making it the fastest rail connection from the neighbourhood.' },
      { term: 'GO Transit', definition: 'The regional transit system serving the Greater Toronto and Hamilton Area with commuter trains and buses. The Lakeshore West line serves Liberty Village via Exhibition Station at about $3.70 per trip with Presto.' }
    ]
  },

  'bike-commuting': {
    answerSummary:
      'Liberty Village is one of Toronto\'s most bikeable neighbourhoods thanks to flat terrain and the car-free Martin Goodman Trail, which reaches downtown Harbourfront in 15 minutes. Bike Share Toronto stations cost about $100 per year. The biggest hazard is streetcar tracks on King Street West, which must be crossed perpendicularly.',
    keyTakeaways: [
      'The Martin Goodman Trail is the safest route downtown, reaching the Harbourfront in about 15 minutes with no car traffic.',
      'Cross streetcar tracks on King Street West at a sharp perpendicular angle to prevent your wheel from catching in the groove.',
      'Always use a U-lock, not a cable lock, because bike theft is a significant problem in Liberty Village.',
      'Bike Share Toronto annual membership costs about $100 and is ideal for short commutes to Exhibition GO Station.',
      'In winter, stick to the Martin Goodman Trail which gets plowed quickly, and avoid icy streetcar tracks on King Street.'
    ],
    definitions: [
      { term: 'Martin Goodman Trail', definition: 'A paved, car-free multi-use path running along Toronto\'s waterfront. Accessible from the south end of Liberty Village, it connects to downtown, the Beaches, and the Humber River.' },
      { term: 'Bike Share Toronto', definition: 'A public bicycle-sharing system with docking stations throughout Toronto, including several in Liberty Village. Annual memberships cost about $100 for unlimited 30-minute rides, with e-bikes available at a surcharge.' },
      { term: 'Walk Score', definition: 'A numerical rating from 0 to 100 that measures the walkability of a neighbourhood based on proximity to amenities. Liberty Village scores high due to its compact layout and density of shops, restaurants, and transit.' }
    ]
  },

  'nightlife-guide': {
    answerSummary:
      'Liberty Village nightlife centres on Liberty Street, where bars with sidewalk patios buzz Thursday through Saturday. King Street West offers upscale cocktail bars with DJ nights and $10 to $20 covers after 11 PM. Dive bars on Hanna Avenue provide cheap beer and pool tables. Late-night food stays open past 2 AM on weekends.',
    keyTakeaways: [
      'Thursday nights offer full energy with shorter lines compared to Friday and Saturday.',
      'The dive bars on Hanna Avenue and Atlantic Avenue are cheaper and less crowded than the Liberty Street strip.',
      'Late-night food options including pizza and shawarma on Liberty Street stay open past 2 AM on weekends.',
      'Request rideshare pickups on Mowat Avenue or Fraser Avenue instead of congested King Street West after midnight.',
      'The 504 streetcar runs until about 1:30 AM, after which the 304 night bus takes over along a similar route.'
    ],
    definitions: [
      { term: 'King Street West', definition: 'A major east-west street along the north side of Liberty Village known for its upscale bars, restaurants, and nightlife. The 504 streetcar runs along this corridor connecting it to downtown Toronto.' },
      { term: 'Last call', definition: 'In Ontario, bars must stop serving alcohol at 2 AM under provincial liquor laws. Most Liberty Village bars close between 2 AM and 2:30 AM on weekends.' },
      { term: 'Liberty Market Building', definition: 'A converted industrial building on Liberty Street housing food vendors, shops, and event spaces. Nearby venues host live music and serve as landmarks for meeting up during nights out.' }
    ]
  },

  'date-night-ideas': {
    answerSummary:
      'Liberty Village offers diverse date options in a compact, walkable area. Italian trattorias on Liberty Street and tasting-menu restaurants on East Liberty Street anchor the dinner scene. For active dates, try partner yoga on Hanna Avenue or a sunset waterfront walk. A cocktail crawl covers the neighbourhood\'s best bars without transit.',
    keyTakeaways: [
      'Book dinner reservations for Friday and Saturday by Wednesday since popular Liberty Street spots fill up fast.',
      'A cocktail crawl from the Liberty Market Building to Mowat Avenue covers the neighbourhood\'s best bars on foot.',
      'Walk to Fort York and the waterfront at sunset for one of Toronto\'s most romantic strolls.',
      'Partner yoga and boxing classes on Hanna Avenue make great active first-date options.',
      'In winter, try fondue restaurants, hot cocktail menus, and the outdoor ice rink at Canoe Landing Park.'
    ],
    definitions: [
      { term: 'Liberty Market Building', definition: 'A converted carpet factory on Liberty Street housing food vendors, artisan shops, and event spaces. Its heritage brick-and-timber architecture makes it a popular starting point for date-night outings.' },
      { term: 'Martin Goodman Trail', definition: 'A paved waterfront trail running just south of Liberty Village, ideal for sunset walks with harbour and Toronto Islands views. Access it through Fort York, about a 15-minute walk south.' },
      { term: 'Fort York', definition: 'A National Historic Site located east of Liberty Village along the waterfront. Originally a British military fort from the late 1700s, it now offers green space and guided tours surrounded by parkland.' }
    ]
  },

  'family-activities': {
    answerSummary:
      'Liberty Village is increasingly family-friendly, anchored by Lamport Stadium Park on King Street West with playgrounds, sports fields, and summer camps. Fort York is a 15-minute walk east with engaging children\'s programs and history tours. Exhibition Place hosts family events year-round, including the Canadian National Exhibition in late summer. The main challenges are long daycare waitlists and no public elementary school within the neighbourhood boundaries.',
    keyTakeaways: [
      'Register for City of Toronto children\'s programs as soon as registration opens because spots fill within hours.',
      'Lamport Stadium Park on King Street West is the best playground and green space for families in Liberty Village.',
      'Fort York offers affordable, engaging historical programs for kids and is a 15-minute walk east of the neighbourhood.',
      'Put your child on daycare waitlists before birth since Liberty Village centres fill up extremely fast.',
      'Weekend brunch with kids is best before 10 AM or after 1 PM to avoid the peak crowd rush.'
    ],
    definitions: [
      { term: 'Lamport Stadium Park', definition: 'The largest green space in Liberty Village, located on King Street West. Features a playground, running track, and sports fields, and hosts community events and children\'s summer camps.' },
      { term: 'Exhibition Place', definition: 'A large event grounds southeast of Liberty Village that hosts family-friendly festivals year-round, including the Canadian National Exhibition (CNE) in late summer. Open green space is available for recreation.' },
      { term: 'Fort York National Historic Site', definition: 'A living history museum east of Liberty Village with military demonstrations, period costumes, and family programming. Originally a British fort from the late 1700s, it offers affordable admission and picnic-friendly grounds.' },
      { term: 'CNE (Canadian National Exhibition)', definition: 'An annual 18-day fair held at Exhibition Place from mid-August to Labour Day, featuring rides, food vendors, agricultural exhibits, and concerts. It draws large crowds through Liberty Village.' }
    ]
  },

  'winter-survival': {
    answerSummary:
      'Liberty Village winters are intensified by wind tunnels near Lake Ontario and Exhibition Place, making wind chill feel 10 to 15 degrees colder. Invest in wind-resistant outerwear and crampon-style ice grippers for icy sidewalks. The 504 streetcar delays increase during snowstorms, so consider Exhibition GO Station as a reliable alternative.',
    keyTakeaways: [
      'Buy crampon-style ice grippers for about $20 to navigate icy sidewalks on Hanna and Mowat Avenues after snowfall.',
      'Build an extra 15 to 20 minutes into your commute because the 504 streetcar delays increase significantly during snowstorms.',
      'Exhibition GO Station is more weather-resistant than the streetcar since trains run on dedicated rail lines unaffected by icy wires.',
      'The outdoor rink at Canoe Landing Park on Fort York Boulevard is free and walkable from Liberty Village.',
      'Combat seasonal blues by using coffee shops as daily social outings, especially if you work from home.'
    ],
    definitions: [
      { term: 'Wind chill', definition: 'The perceived decrease in air temperature caused by wind. Liberty Village\'s position near Lake Ontario and open Exhibition Place grounds creates wind tunnel effects that make winters feel significantly colder than official readings.' },
      { term: 'Exhibition GO Station', definition: 'A GO Transit station at the southeast corner of Liberty Village. Trains to Union Station take 5 minutes and are more reliable in winter than streetcars, which can be delayed by icy overhead wires.' },
      { term: 'Canoe Landing Park', definition: 'A public park on Fort York Boulevard east of Liberty Village featuring an outdoor ice rink in winter, open green space, and public art installations. It is a short walk from the neighbourhood.' }
    ]
  },

  'summer-patio-season': {
    answerSummary:
      'Liberty Village transforms into one of Toronto\'s best patio neighbourhoods from May through October. Liberty Street has south-facing patios with afternoon sun and a festival atmosphere on weekends. King Street West terraces offer rooftop skyline views. Hidden courtyards on Hanna and Atlantic Avenues are quieter gems. Arrive before 10 AM for brunch to skip lines.',
    keyTakeaways: [
      'South-facing Liberty Street patios get the best afternoon and evening sun, making them ideal for long summer dinners.',
      'Courtyard patios on Hanna Avenue and Atlantic Avenue in converted industrial buildings are quieter hidden gems.',
      'For patio brunch without a long wait, arrive before 10 AM or after 1:30 PM on weekends.',
      'Weekday happy hours from 3 to 6 PM on side streets like Mowat and Fraser offer the best drink deals.',
      'Most patios stay open until mid-October, with heat lamps extending the season into cooler evenings.'
    ],
    definitions: [
      { term: 'East Liberty Street', definition: 'A main commercial street in Liberty Village running east-west, lined with restaurants, cafes, and shops. It hosts many of the neighbourhood\'s most popular patios and is closed to traffic during the annual Give Me Liberty festival.' },
      { term: 'BIA (Business Improvement Area)', definition: 'A defined commercial district where local businesses collectively fund neighbourhood improvements and events. The Liberty Village BIA organizes community events and seasonal markets.' },
      { term: 'Patio season', definition: 'The period from roughly May through October when Toronto restaurants and bars open their outdoor dining spaces. In Liberty Village, patios are a central part of the neighbourhood\'s social culture.' }
    ]
  },

  'fitness-guide': {
    answerSummary:
      'Liberty Village offers boutique studios for HIIT, boxing, spin, and yoga, the car-free Martin Goodman Trail for running, and a free outdoor track at Lamport Stadium. Basic gym memberships run $40 to $60 monthly while boutique studios cost $150 to $250. Most offer discounted intro packages, and condo gyms provide 24/7 backup.',
    keyTakeaways: [
      'The Martin Goodman Trail via Lynn Williams Street is the best running route, offering a flat, scenic, car-free path to downtown.',
      'Lamport Stadium\'s outdoor rubberized track is free and excellent for interval training and speed work.',
      'Most boutique studios offer discounted intro packages, so try several before committing to a membership.',
      'Inspect your condo building\'s gym before buying or renting since quality varies enormously between buildings.',
      'Join a local running group or Parkrun for free weekly timed 5K runs and built-in social connections.'
    ],
    definitions: [
      { term: 'Martin Goodman Trail', definition: 'A paved waterfront multi-use trail accessible from the south end of Liberty Village. Popular for running, cycling, and rollerblading, it stretches from the Humber River to the Beaches along Toronto\'s lakefront.' },
      { term: 'Lamport Stadium', definition: 'A public sports facility on King Street West with a free outdoor rubberized running track, sports fields, and playground. It is the primary green space and fitness hub for Liberty Village residents.' },
      { term: 'Parkrun', definition: 'A free, weekly, timed 5-kilometre community running event held in parks around the world. Local Parkrun events near Liberty Village draw regular participants from the neighbourhood.' }
    ]
  },

  'remote-work-spots': {
    answerSummary:
      'Liberty Village is ideal for remote work, with laptop-friendly cafes on East Liberty Street, coworking spaces offering hot desks for $200 to $400 monthly or day passes for $25 to $50, and condo amenity rooms free on weekday mornings. Coworking spaces beat cafes for video calls with dedicated Wi-Fi and phone booths.',
    keyTakeaways: [
      'Arrive at popular cafes before 9 AM on weekdays to claim a spot with a power outlet near East Liberty Street.',
      'Coworking day passes at $25 to $50 are worth it when you need reliable Wi-Fi and a quiet phone booth for calls.',
      'Check your condo building\'s common areas and party rooms, which are often empty and free on weekday mornings.',
      'Buy a drink every one to two hours at cafes and give up your table during the lunch rush as a courtesy.',
      'Invest in an external monitor and ergonomic chair for your condo home office to protect your posture long-term.'
    ],
    definitions: [
      { term: 'Hot desk', definition: 'A flexible coworking arrangement where you use any available desk in a shared workspace on a first-come, first-served basis, rather than having a permanently assigned desk. Monthly memberships run $200 to $400 in Liberty Village.' },
      { term: 'Beanfield Metroconnect', definition: 'A Toronto-based internet provider offering fibre-to-the-suite in many Liberty Village condos. Its symmetrical upload and download speeds make it ideal for video calls and remote work.' },
      { term: 'Liberty Market Building', definition: 'A converted industrial building on Liberty Street with food vendors, cafes, and shops. Several of its cafes are popular remote-work spots with power outlets and Wi-Fi.' }
    ]
  },

  'community-groups': {
    answerSummary:
      'Liberty Village has active community life despite its dense condo setting. The Residents Association advocates on development and transit, while the BIA organizes events like the Give Me Liberty festival. The community Facebook group is the most active online forum. Volunteering at park cleanups and festivals is the fastest way to meet neighbours.',
    keyTakeaways: [
      'Join the Liberty Village Community Facebook group for the most active neighbourhood discussions and recommendations.',
      'Follow the Liberty Village BIA on Instagram for event announcements and new business openings.',
      'Attend an LVRA meeting to learn about neighbourhood development issues and have your voice heard at City Hall.',
      'Volunteer at the Give Me Liberty festival or park cleanup events to meet neighbours through shared activity.',
      'Do not overlook your own condo building as a community by attending board meetings and joining your building\'s social groups.'
    ],
    definitions: [
      { term: 'LVRA (Liberty Village Residents Association)', definition: 'The primary resident-led advocacy organization in Liberty Village. It represents residents on traffic, development, transit, and public space issues and holds regular public meetings.' },
      { term: 'BIA (Business Improvement Area)', definition: 'A designated commercial district where local businesses fund collective neighbourhood improvements. The Liberty Village BIA organizes community events, seasonal markets, and publishes neighbourhood news.' },
      { term: 'Condo board', definition: 'The elected governing body of a condominium corporation, responsible for managing finances, maintenance, and rule enforcement. Board members are elected by unit owners at annual general meetings.' }
    ]
  },

  'history-of-liberty-village': {
    answerSummary:
      'Liberty Village was an industrial district from the mid-1800s until factories closed in the 1960s, leaving warehouses that attracted artists in the 1990s. Toronto rezoned it for mixed-use development around 2000, triggering a condo boom that grew the population to over 10,000. Heritage buildings like the Liberty Market Building preserve the industrial character.',
    keyTakeaways: [
      'Liberty Village\'s traffic problems stem from a road network originally designed for factory truck traffic, not residential density.',
      'The creative community that moved into cheap industrial spaces in the 1990s defined the neighbourhood\'s cultural identity.',
      'Heritage buildings like the Liberty Market Building, Toy Factory Lofts, and Carpet Factory Lofts preserve the industrial aesthetic.',
      'The name Liberty Village is relatively recent, derived from Liberty Street rather than any historical event.',
      'Visit Fort York to see the military reserve that predated the entire industrial district in the late 1700s.'
    ],
    definitions: [
      { term: 'Fort York', definition: 'A National Historic Site established by the British in the late 1700s on the military reserve land that later became Liberty Village. Located south of the neighbourhood along the waterfront, it is Toronto\'s oldest surviving settlement.' },
      { term: 'BIA (Business Improvement Area)', definition: 'The Liberty Village BIA was established during the redevelopment era to promote the neighbourhood. It represents commercial interests and organizes community events and public space improvements.' },
      { term: 'Mixed-use zoning', definition: 'A city planning designation that allows residential, commercial, and retail uses within the same area. Toronto rezoned Liberty Village for mixed use around 2000, enabling the condo and commercial development that transformed the district.' },
      { term: 'Toy Factory Lofts', definition: 'A converted former toy manufacturing building on Atlantic Avenue, now residential lofts. One of several heritage industrial buildings in Liberty Village preserved during the condo redevelopment era.' }
    ]
  },

  'give-me-liberty-festival': {
    answerSummary:
      'The Give Me Liberty festival is Liberty Village\'s biggest annual event, held on a Saturday in late spring or early summer. East Liberty Street becomes a pedestrian zone with live music, food trucks, artisan booths, kids\' activities, and dog events. It is free to attend. Arrive early for the best vendor selection and take the 504 streetcar.',
    keyTakeaways: [
      'Arrive early in the day to browse vendor stalls before afternoon crowds peak around the main stage.',
      'Bring cash as backup because some food and artisan vendors at the festival do not accept cards.',
      'Street parking is virtually impossible on festival day so take the 504 streetcar or walk from within the neighbourhood.',
      'Check the Liberty Village BIA website for volunteer opportunities, which are posted weeks before the event.',
      'The festival includes dedicated kids zones with face painting, bouncy castles, and craft activities.'
    ],
    definitions: [
      { term: 'Liberty Village BIA', definition: 'The Business Improvement Area organization that represents Liberty Village businesses and organizes the annual Give Me Liberty festival along with other community events, seasonal markets, and neighbourhood promotions.' },
      { term: 'East Liberty Street', definition: 'A main commercial street in Liberty Village that is closed to vehicle traffic during the Give Me Liberty festival and transformed into the event grounds with stages, vendor tents, and activity areas.' },
      { term: '504 King streetcar', definition: 'The TTC streetcar route running along King Street West through Liberty Village. The nearest stops to the festival are at King and Atlantic Avenue and King and Strachan Avenue.' }
    ]
  },

  'farmers-market': {
    answerSummary:
      'Liberty Village lacks a permanent farmers market, but Stackt Market on Bathurst Street is a 20-minute walk and hosts seasonal markets. The BIA organizes pop-up markets on East Liberty Street periodically, and the year-round Wychwood Barns market is accessible via the 29 Dufferin bus. Arrive early for the best selection and bring cash.',
    keyTakeaways: [
      'Stackt Market on Bathurst Street is the closest market option, reachable by a 20-minute walk or short 504 streetcar ride.',
      'Arrive within the first hour of opening for the best selection on pastries and specialty produce that sell out fast.',
      'Bring reusable bags and small bills since many market vendors are still cash-only.',
      'Check the Liberty Village BIA event calendar for pop-up markets on East Liberty Street throughout the season.',
      'Plan meals around what looks fresh at the market rather than following a rigid list to embrace seasonal eating.'
    ],
    definitions: [
      { term: 'Stackt Market', definition: 'A market and community space on Bathurst Street, south of Front, built from shipping containers. It hosts seasonal farmers and artisan markets, permanent food vendors, shops, and a beer garden, and is the closest market-style venue to Liberty Village.' },
      { term: 'Wychwood Barns', definition: 'A community arts and ecology centre in the Bathurst and St. Clair area that hosts one of Toronto\'s best year-round Saturday morning farmers markets. Accessible from Liberty Village via the 29 Dufferin bus.' },
      { term: 'BIA (Business Improvement Area)', definition: 'The Liberty Village BIA periodically organizes pop-up farmers and artisan markets on East Liberty Street, often coinciding with community events. Check their event calendar for upcoming dates.' }
    ]
  },

  'brunch-guide': {
    answerSummary:
      'Brunch is Liberty Village\'s signature weekend meal, with East Liberty Street and King West as the main corridors. Peak waits hit 30 to 60 minutes between 11 AM and 1 PM, so arrive before 10 AM to skip lines. A typical brunch for two with drinks runs $50 to $80. Several spots offer weekday brunch with no wait.',
    keyTakeaways: [
      'Arrive before 10 AM on weekends to avoid the 30- to 60-minute wait that builds during the peak brunch rush.',
      'Weekday brunch at the same restaurants has a fraction of the crowds and no lines, ideal for remote workers.',
      'Tables for two are seated faster, so large groups should call ahead or expect longer delays.',
      'Budget $50 to $80 for brunch for two with drinks at Liberty Village\'s quality-focused restaurants.',
      'Check if your target spot uses a waitlist app so you can queue remotely and wait from home.'
    ],
    definitions: [
      { term: 'East Liberty Street', definition: 'A main commercial street in Liberty Village and one of the two primary brunch corridors in the neighbourhood, lined with restaurants, cafes, and food vendors.' },
      { term: 'Bottomless brunch', definition: 'A restaurant promotion offering unlimited mimosas, caesars, or bellinis for a fixed price of $20 to $30 per person alongside a brunch entree. Several Liberty Village restaurants offer this on weekends.' },
      { term: 'Caesar (cocktail)', definition: 'A quintessentially Canadian brunch cocktail made with vodka, Clamato juice, hot sauce, and Worcestershire sauce, served in a celery salt-rimmed glass. It is the Canadian equivalent of a Bloody Mary and a staple on Liberty Village brunch menus.' }
    ]
  },

  'happy-hour-guide': {
    answerSummary:
      'Liberty Village happy hours run 4 to 7 PM on weekdays, with $2 to $3 off beers, $5 to $7 well drinks, and half-price appetizers. The best deals are Monday through Thursday. Combining drinks and apps works as a budget dinner for $20 to $30 per person. In summer, arrive at 4 PM to claim patio seats.',
    keyTakeaways: [
      'Most happy hours run 4 to 7 PM on weekdays, with the best discounts Monday through Thursday.',
      'Combine happy hour drinks and appetizers as a budget-friendly dinner alternative for $20 to $30 per person.',
      'In summer, arrive right at 4 PM for the best patio seats because they fill up quickly on warm days.',
      'Tuesday and Sunday often have the deepest discounts as industry nights at various Liberty Village bars.',
      'Check Liberty Village community groups for happy hour meetups, which are a great way for new residents to build a social circle.'
    ],
    definitions: [
      { term: 'Well drinks', definition: 'Cocktails made with a bar\'s house-brand spirits rather than premium or top-shelf brands. During happy hour in Liberty Village, well drinks typically cost $5 to $7.' },
      { term: 'Industry night', definition: 'A bar or restaurant promotion offering deeper discounts, typically on Tuesdays or Sundays, aimed at hospitality and service industry workers who have those nights off.' },
      { term: 'Craft beer', definition: 'Beer produced by small, independent breweries with an emphasis on quality and flavour variety. Liberty Village has access to several brewery taprooms and bars featuring Ontario craft beers on tap.' }
    ]
  },

  'new-openings': {
    answerSummary:
      'Liberty Village sees regular new business openings due to its young, affluent population and available commercial space. The Liberty Village BIA on Instagram is the fastest source for announcements. The community Facebook group provides candid resident reviews. Give new restaurants 2 to 3 weeks to settle before judging, and support them with Google reviews.',
    keyTakeaways: [
      'Follow the Liberty Village BIA on Instagram for the fastest announcements about new business openings.',
      'Give new restaurants 2 to 3 weeks after opening before judging since kitchens need time to refine their workflow.',
      'Check the Liberty Village subreddit and Facebook group for candid first impressions from actual residents.',
      'Leave Google reviews for new businesses you enjoy since early positive reviews help them enormously during the critical first year.',
      'Watch construction site signage for clues about upcoming commercial tenants months before they open.'
    ],
    definitions: [
      { term: 'Liberty Village BIA', definition: 'The Business Improvement Area organization representing neighbourhood businesses. Their social media channels, especially Instagram, are the best official source for new opening announcements, grand openings, and coming-soon businesses.' },
      { term: 'Liberty Market Building', definition: 'A central mixed-use heritage building on Liberty Street that periodically updates its tenant mix with new food vendors and specialty shops. Changes here are always noteworthy as it is the neighbourhood\'s main gathering space.' },
      { term: 'Ground-floor retail', definition: 'Commercial spaces at street level in condo buildings, designed for shops, restaurants, and service businesses. These are the most common locations for new Liberty Village businesses.' }
    ]
  },

  'safety-guide': {
    answerSummary:
      'Liberty Village is generally safe by Toronto standards, with violent crime being rare. The main concerns are property crimes: vehicle break-ins, package theft from condo lobbies, and bicycle theft. Never leave valuables visible in your car, use your building\'s parcel room for deliveries, and call 311 for non-emergency city services.',
    keyTakeaways: [
      'Never leave anything visible in your parked car since vehicle break-ins are the most common crime in the neighbourhood.',
      'Use your building\'s parcel room or request signature-required delivery to prevent package theft from condo lobbies.',
      'Avoid walking alone under the Gardiner Expressway late at night as it is poorly lit and less populated.',
      'Know your condo building\'s emergency procedures including fire exits, pull stations, and after-hours contacts.',
      'The nearest full emergency department is St. Joseph\'s Health Centre on Sunnyside Avenue, about 10 minutes by car.'
    ],
    definitions: [
      { term: '14 Division', definition: 'The Toronto Police Service division that covers Liberty Village. Crime statistics for the area are available through the TPS public safety data portal with maps and incident reports.' },
      { term: '311 Toronto', definition: 'The City of Toronto\'s non-emergency services line for reporting noise complaints, parking violations, animal control, and other city issues. Available by phone and mobile app.' },
      { term: 'Gardiner Expressway', definition: 'An elevated highway running along the waterfront south of Liberty Village. The area beneath it between Liberty Village and Exhibition Place is poorly lit at night and should be avoided when walking alone.' }
    ]
  },

  'where-to-stay': {
    answerSummary:
      'Liberty Village is an excellent Toronto base for visitors, with Airbnbs ranging from budget studios at $80 to $130 per night to townhouses at $150 to $250. The 504 King streetcar connects to Union Station in 20 minutes. BMO Field and Exhibition Place are walking distance. Book listings with parking included and reserve 2 to 3 weeks ahead in summer.',
    keyTakeaways: [
      'Book listings that include a parking spot to avoid paying $20 to $30 per day in lot fees or fighting for metered street parking.',
      'The 504 King streetcar from Atlantic Avenue reaches the Entertainment District in 10 minutes and Union Station in 20.',
      'Townhouses offer the most space and often include rooftop patios, making them ideal for families or small groups.',
      'Summer from June through September is peak season with the highest prices, so book 2 to 3 weeks ahead.',
      'The UP Express to Union Station plus a streetcar ride gets you from Pearson Airport to Liberty Village in about 45 minutes.'
    ],
    definitions: [
      { term: 'BMO Field', definition: 'A 30,000-seat stadium at the south end of Liberty Village, home to Toronto FC (MLS) and the Toronto Argonauts (CFL). It is within walking distance of most Liberty Village short-term rentals.' },
      { term: 'UP Express', definition: 'The Union Pearson Express, a dedicated train service running between Toronto Pearson International Airport and Union Station in about 25 minutes. From Union Station, the 504 streetcar reaches Liberty Village.' },
      { term: '504 King streetcar', definition: 'The TTC streetcar route running along King Street West through Liberty Village, connecting to Union Station and the downtown core. The closest stops are at King and Atlantic Avenue and King and Strachan Avenue.' },
      { term: 'Exhibition Place', definition: 'A large event venue and fairgrounds southeast of Liberty Village that hosts concerts at Budweiser Stage, the annual CNE fair, trade shows, and festivals. Within walking distance of most Liberty Village accommodations.' }
    ]
  }
};


function countWords(text) {
  return text.trim().split(/\s+/).length;
}

function validate(topics) {
  let allValid = true;

  for (const topic of topics) {
    const errors = [];
    const slug = topic.slug;

    // Check answerSummary exists and word count
    if (!topic.answerSummary) {
      errors.push('Missing answerSummary');
    } else {
      const wc = countWords(topic.answerSummary);
      if (wc < 40 || wc > 65) {
        errors.push(`answerSummary word count: ${wc} (expected 40-65)`);
      }
    }

    // Check keyTakeaways
    if (!topic.keyTakeaways || !Array.isArray(topic.keyTakeaways)) {
      errors.push('Missing keyTakeaways');
    } else {
      const len = topic.keyTakeaways.length;
      if (len < 3 || len > 5) {
        errors.push(`keyTakeaways count: ${len} (expected 3-5)`);
      }
    }

    // Check definitions
    if (!topic.definitions || !Array.isArray(topic.definitions)) {
      errors.push('Missing definitions');
    } else {
      const len = topic.definitions.length;
      if (len < 2 || len > 5) {
        errors.push(`definitions count: ${len} (expected 2-5)`);
      }
      for (const def of topic.definitions) {
        if (!def.term || !def.definition) {
          errors.push(`Invalid definition entry: missing term or definition`);
        }
      }
    }

    if (errors.length > 0) {
      console.log(`FAIL  ${slug}: ${errors.join('; ')}`);
      allValid = false;
    } else {
      const wc = countWords(topic.answerSummary);
      console.log(`PASS  ${slug} (summary: ${wc} words, takeaways: ${topic.keyTakeaways.length}, definitions: ${topic.definitions.length})`);
    }
  }

  return allValid;
}

// Main
function main() {
  console.log('Reading topics.json...');
  const topics = JSON.parse(fs.readFileSync(TOPICS_PATH, 'utf-8'));
  console.log(`Found ${topics.length} topics\n`);

  // Check we have AEO data for all topics
  const missingSlugs = topics.filter(t => !aeoData[t.slug]).map(t => t.slug);
  if (missingSlugs.length > 0) {
    console.error(`ERROR: Missing AEO data for slugs: ${missingSlugs.join(', ')}`);
    process.exit(1);
  }

  // Add AEO fields to each topic
  for (const topic of topics) {
    const data = aeoData[topic.slug];
    topic.answerSummary = data.answerSummary;
    topic.keyTakeaways = data.keyTakeaways;
    topic.definitions = data.definitions;
  }

  console.log('Validating...\n');
  const allValid = validate(topics);

  console.log('');

  if (!allValid) {
    console.error('Validation failed. Fix issues above before writing.');
    process.exit(1);
  }

  // Write back
  fs.writeFileSync(TOPICS_PATH, JSON.stringify(topics, null, 2) + '\n', 'utf-8');
  console.log(`Successfully wrote ${topics.length} topics with AEO fields to ${TOPICS_PATH}`);

  // Verify JSON is valid by re-reading
  try {
    const verify = JSON.parse(fs.readFileSync(TOPICS_PATH, 'utf-8'));
    console.log(`Verified: JSON is valid, ${verify.length} topics loaded successfully.`);
  } catch (e) {
    console.error(`ERROR: Written JSON is invalid: ${e.message}`);
    process.exit(1);
  }

  // Summary stats
  const allDefs = topics.flatMap(t => t.definitions.map(d => d.term));
  const uniqueDefs = [...new Set(allDefs)];
  console.log(`\nSummary:`);
  console.log(`  Total definitions: ${allDefs.length} across all topics`);
  console.log(`  Unique terms defined: ${uniqueDefs.length}`);
  console.log(`  Terms appearing multiple times: ${allDefs.length - uniqueDefs.length}`);

  // Show which terms appear most
  const termCounts = {};
  for (const term of allDefs) {
    termCounts[term] = (termCounts[term] || 0) + 1;
  }
  const repeated = Object.entries(termCounts).filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]);
  if (repeated.length > 0) {
    console.log(`\nRepeated terms (used where relevant):`);
    for (const [term, count] of repeated) {
      console.log(`  "${term}" appears in ${count} topics`);
    }
  }
}

main();
