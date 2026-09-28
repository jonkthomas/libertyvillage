export type FaqEntry = { question: string; answer: string };

type BusinessCategoryType =
  | "food-drink"
  | "events"
  | "fitness"
  | "medical"
  | "beauty"
  | "pets"
  | "professional"
  | "workspace"
  | "rentals"
  | "home-services";

// Map a business category slug to a broad type so FAQs stay relevant — e.g. the
// "good for groups?" question only appears for food/drink and event categories,
// never for dentists, lawyers, locksmiths, and similar.
function getBusinessCategoryType(slug: string): BusinessCategoryType {
  const groups: Record<BusinessCategoryType, string[]> = {
    "food-drink": [
      "restaurants", "coffee-shops", "brunch-spots", "bars", "patios",
      "breweries", "wine-bars", "pizza", "sushi", "thai-restaurants",
      "italian-restaurants", "indian-restaurants", "burger-joints", "bakeries",
    ],
    events: ["caterers", "event-spaces"],
    fitness: ["gyms", "yoga-studios", "pilates", "personal-trainers"],
    medical: [
      "dentists", "doctors", "veterinarians", "optometrists", "physiotherapy",
      "chiropractors", "massage-therapy", "pharmacies",
    ],
    beauty: ["hair-salons", "barbers", "nail-salons", "spas", "tattoo-parlors"],
    pets: ["dog-walkers", "dog-groomers", "pet-stores"],
    professional: [
      "lawyers", "accountants", "real-estate-agents", "insurance-agents",
      "banks", "it-support", "interior-designers", "tutors", "music-lessons",
    ],
    workspace: ["coworking-spaces"],
    rentals: ["short-term-rentals"],
    "home-services": [
      "house-cleaning", "movers", "dry-cleaners", "tailors", "laundromats",
      "auto-repair", "bike-shops", "locksmith", "printing-services", "florists",
      "grocery-stores", "photographers", "daycares",
    ],
  };
  for (const [type, slugs] of Object.entries(groups)) {
    if (slugs.includes(slug)) return type as BusinessCategoryType;
  }
  return "home-services";
}

export function getBusinessFAQs(business: { name: string; category: string; hours: string; priceRange?: string }): FaqEntry[] {
  const { name, hours, priceRange } = business;
  const type = getBusinessCategoryType(business.category);

  const hoursQ: FaqEntry = hours.trim()
    ? {
        question: `What are the hours for ${name}?`,
        answer: `${name} is open ${hours}. Hours can change on holidays and seasonally, so it's best to call ahead or check the website to confirm before visiting.`,
      }
    : {
        question: `Are opening hours listed for ${name}?`,
        answer: `Current opening hours are not verified for ${name}. Check the business website or call ahead before visiting.`,
      };
  const priceQ: FaqEntry = {
    question: `How much does ${name} cost?`,
    answer: priceRange
      ? `${name} is rated ${priceRange} for pricing, in line with comparable options in the Liberty Village and Toronto west-end area. Ask for current prices, as rates can vary.`
      : `A verified price range is not listed for ${name}. Check the website or contact the business for current prices.`,
  };

  const sets: Record<BusinessCategoryType, FaqEntry[]> = {
    "food-drink": [
      hoursQ,
      {
        question: `Does ${name} take reservations or walk-ins?`,
        answer: `${name} welcomes Liberty Village locals and visitors alike. Walk-ins are usually fine at quieter times, but for busy evenings and weekends it's worth booking ahead or calling to check the current wait.`,
      },
      {
        question: `Is ${name} good for groups?`,
        answer: `${name} can be a good option for groups, though Liberty Village rooms are often compact. For parties of six or more, call ahead to confirm seating and ask about any group menu or minimum.`,
      },
      priceQ,
    ],
    events: [
      hoursQ,
      {
        question: `How far in advance should you book ${name}?`,
        answer: `For weekend and peak-season dates, reserve ${name} several weeks ahead; popular slots go early. Smaller weekday bookings need less lead time. Confirm deposit and cancellation terms when you enquire.`,
      },
      {
        question: `What size events can ${name} accommodate?`,
        answer: `${name} can host a range of group sizes — discuss your headcount, layout, and any catering or A/V needs directly so they can confirm capacity and pricing for your Liberty Village event.`,
      },
      priceQ,
    ],
    fitness: [
      hoursQ,
      {
        question: `Does ${name} offer a free trial or drop-in pass?`,
        answer: `Many Liberty Village fitness spots offer an intro trial or single drop-in. Contact ${name} to ask about trial classes, day passes, and whether a tour is available before you commit to a membership.`,
      },
      {
        question: `How much does membership at ${name} cost?`,
        answer: priceRange
          ? `${name} is rated ${priceRange} for pricing. Ask about current membership fees, joining fees, and contract length when you sign up.`
          : `A verified membership price range is not listed for ${name}. Contact the business for current fees, joining fees, and contract terms.`,
      },
    ],
    medical: [
      hoursQ,
      {
        question: `Is ${name} accepting new patients?`,
        answer: `Availability changes regularly, so call ${name} or check their website before visiting. Ask about wait times and what to bring for a first appointment to avoid a wasted trip.`,
      },
      {
        question: `Does ${name} direct-bill insurance?`,
        answer: `Many Liberty Village clinics direct-bill major insurers, but practices differ. Confirm with ${name} and have your policy details ready, since OHIP-covered and extended-health services are handled differently.`,
      },
    ],
    beauty: [
      hoursQ,
      {
        question: `Does ${name} take walk-ins or require an appointment?`,
        answer: `${name} mostly works by appointment, especially for longer services, with limited walk-in availability at quieter times. Weekend and after-work slots book up fastest, so reserve ahead.`,
      },
      priceQ,
    ],
    pets: [
      hoursQ,
      {
        question: `What services does ${name} offer?`,
        answer: `${name} serves Liberty Village pet owners — contact them for the full list of services, availability, and whether they offer neighbourhood pickup, drop-in visits, or appointment-based care.`,
      },
      priceQ,
    ],
    professional: [
      hoursQ,
      {
        question: `Does ${name} offer a free initial consultation?`,
        answer: `Many Liberty Village professionals offer a brief no-cost consultation to scope your needs before quoting. Contact ${name} to confirm whether an initial consultation is free and how long it runs.`,
      },
      {
        question: `How much does ${name} charge?`,
        answer: priceRange
          ? `${name} is rated ${priceRange} for pricing. Request a written estimate before engaging.`
          : `A verified fee range is not listed for ${name}. Request a written estimate before engaging.`,
      },
    ],
    workspace: [
      hoursQ,
      {
        question: `Does ${name} offer day passes or monthly memberships?`,
        answer: `${name} typically offers flexible options — from day passes to dedicated desks and private offices. Contact them to confirm current plans, pricing tiers, and whether a tour or trial day is available.`,
      },
      {
        question: `What amenities does ${name} offer?`,
        answer: `Expect essentials like Wi-Fi, meeting rooms, printing, and coffee, with some spaces adding phone booths or events. ${name} sits within Liberty Village's TTC- and GO-connected core, making it an easy commute. Confirm specific amenities directly.`,
      },
    ],
    rentals: [
      hoursQ,
      {
        question: `What is the minimum stay at ${name}?`,
        answer: `Minimum stays vary by host and season — some require a few nights while others suit longer corporate or relocation stays. Confirm directly with ${name}, as Toronto's short-term-rental rules can affect availability.`,
      },
      {
        question: `What amenities does ${name} include?`,
        answer: `${name} offers Liberty Village's walkable access to King West dining and TTC/GO transit. Confirm in-suite laundry, Wi-Fi, building gym, parking, and pet policies directly, along with check-in details.`,
      },
    ],
    "home-services": [
      hoursQ,
      {
        question: `Does ${name} require an appointment or offer same-day service?`,
        answer: `${name} generally works by appointment, though same-day or urgent requests may be possible for an added fee. Booking ahead secures a preferred time — contact them to confirm availability and any service-call charge.`,
      },
      priceQ,
    ],
  };

  return sets[type];
}
