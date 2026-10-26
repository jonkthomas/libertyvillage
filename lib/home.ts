// Homepage copy that targets the head term "liberty village". Kept out of app/page.tsx so
// tests can check it without rendering the page.
// TODO verify against City of Toronto Open Data: canonical neighbourhood facts — population
// "about 9,000" and area "28 hectares (0.28 km²)" — must stay identical here, /about, and public/llms.txt.

export const HOME_TITLE = "Liberty Village, Toronto: Restaurants, Things to Do & Guide";

export const HOME_DESCRIPTION =
  "Liberty Village, Toronto: the best restaurants, bars and things to do, parking and transit tips, and a directory of 200+ local businesses. Updated for 2026.";

/** Self-contained "What is Liberty Village?" answer (134–167 words) shown near the top of the homepage. */
export const HOME_ANSWER =
  "Liberty Village is a 28-hectare (0.28 km²) neighbourhood in west-downtown Toronto, bounded by King Street West to the north, Dufferin Street to the west, and the GO rail corridor to the south. It sits between Parkdale and CityPlace, with Exhibition Place and BMO Field directly to the south. The area is known for its converted industrial brick lofts, newer condo towers, and a dense restaurant and bar scene along East Liberty Street and King West. About 9,000 people live here, mostly young professionals aged 25 to 40. It has a Walk Score of 88 and a Transit Score of 96, with the 504 King streetcar on its northern edge. Median 1-bedroom rent is $2,608 a month, and the median condo price was $610,000 in December 2025. LibertyVillage.co is an independent guide to the neighbourhood: a directory of 200+ local businesses, best-of lists, and guides to parking, transit, condo buildings, and things to do.";

export const HOME_FAQS = [
  {
    question: "What is Liberty Village?",
    answer:
      "Liberty Village is a 28-hectare (0.28 km²) neighbourhood in west-downtown Toronto, bounded by King Street West, Dufferin Street, and the GO rail corridor. About 9,000 residents live there, mostly young professionals aged 25 to 40. The area has a Walk Score of 88 and Transit Score of 96, and sits next to Exhibition Place and BMO Field.",
  },
  {
    question: "Where is Liberty Village in Toronto?",
    answer:
      "Liberty Village is in west-downtown Toronto, bounded by King Street West to the north, Dufferin Street to the west, and the GO rail corridor to the south. It sits between Parkdale and CityPlace, with Exhibition Place and BMO Field directly to the south.",
  },
  {
    question: "How much is rent in Liberty Village?",
    answer:
      "Median 1-bedroom rent in Liberty Village is $2,608 per month as of early 2026. The median condo price is $610,000 (December 2025). Rents vary by building, with newer towers like Reina commanding premiums and older loft conversions like Toy Factory Lofts trading at slightly lower price points.",
  },
  {
    question: "What is Liberty Village known for?",
    answer:
      "Liberty Village is known for its converted industrial brick lofts, dense restaurant and bar scene along East Liberty Street and King West, proximity to BMO Field and Exhibition Place, the 504 King streetcar, and being one of Toronto's most walkable young-professional neighbourhoods.",
  },
];
