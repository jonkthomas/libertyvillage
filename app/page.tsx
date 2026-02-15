import Link from "next/link";
import Image from "next/image";
import { getAllServices, getAllTopics, getBusinessesByCategory, getRecentPosts } from "@/lib/data";
import { generateHomePageMeta } from "@/lib/meta";
import { generateBreadcrumbSchema, generateWebsiteSchema } from "@/lib/schema";
import ServiceCard from "@/components/ServiceCard";
import StatBar from "@/components/StatBar";

export const metadata = generateHomePageMeta();

const stats = [
  { value: "9,000+", label: "Residents" },
  { value: "600+", label: "Businesses" },
  { value: "70%", label: "Young Professionals" },
  { value: "$99K", label: "Median Income" },
];

const topCategoryOrder = [
  "restaurants",
  "coffee-shops",
  "gyms",
  "bars",
  "brunch-spots",
  "dentists",
  "hair-salons",
  "coworking-spaces",
];

export default function Home() {
  const services = getAllServices();
  let topics: { slug: string; title: string; description: string; image?: string }[] = [];
  try {
    topics = getAllTopics().slice(0, 6);
  } catch {
    // topics.json may not exist yet during build
  }

  let recentPosts: { slug: string; title: string; description: string; category: string; image?: string }[] = [];
  try {
    recentPosts = getRecentPosts(3);
  } catch {
    // posts.json may not exist yet during build
  }

  const accommodations = getBusinessesByCategory("short-term-rentals").slice(0, 3);

  const topServices = topCategoryOrder
    .map((slug) => services.find((s) => s.slug === slug))
    .filter((s): s is NonNullable<typeof s> => s !== undefined)
    .slice(0, 8);

  const popularServices = services
    .filter((s) => s.searchVolume === "high")
    .slice(0, 15);

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden px-4 py-16 sm:py-24">
        {/* Background image */}
        <div className="absolute inset-0">
          <Image
            src="/images/neighborhood/brick-loft-streetscape.jpg"
            alt="Liberty Village streetscape"
            fill
            className="object-cover object-bottom"
            priority
            sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-white/90" />
        </div>
        <div className="relative mx-auto max-w-4xl text-center">
          <h1 className="text-4xl font-bold text-white sm:text-5xl drop-shadow-sm">
            Liberty Village, Toronto — Your Neighborhood Guide
          </h1>
          <p className="answer-block mx-auto mt-4 max-w-2xl text-lg text-white/90 drop-shadow-sm">
            Liberty Village is a walkable Toronto neighborhood of 9,000+ residents
            with 600+ businesses, known for its converted industrial lofts,
            dog-friendly culture, and thriving food scene along King Street West.
            Find the best local businesses, read guides, and compare neighborhoods.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/directory" className="rounded-full bg-amber-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-amber-600">
              Browse Directory
            </Link>
            <Link href="/guide/moving-guide" className="rounded-full border border-white/60 bg-white/20 backdrop-blur-sm px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/30">
              New to LV? Start Here
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4">
        {/* Stats */}
        <section className="-mt-6 mb-12">
          <StatBar stats={stats} />
        </section>

        {/* Quick Links Grid */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-warm-900">
            Explore Liberty Village
          </h2>
          <p className="mt-1 text-warm-500">
            Find the best of what the neighborhood has to offer.
          </p>
          <div className="mt-6 grid gap-4 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {topServices.map((service) => (
              <ServiceCard key={service.slug} service={service} />
            ))}
          </div>
        </section>

        {/* Latest Guides */}
        {topics.length > 0 && (
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-warm-900">
              Neighborhood Guides
            </h2>
            <p className="mt-1 text-warm-500">
              Local tips and advice from people who actually live here.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {topics.map((topic) => (
                <Link key={topic.slug} href={`/guide/${topic.slug}`} className="group overflow-hidden rounded-xl border border-warm-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                  {topic.image && (
                    <div className="relative aspect-video overflow-hidden">
                      <Image src={topic.image} alt={topic.title} fill className="object-cover transition-transform group-hover:scale-105" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                    </div>
                  )}
                  <div className="p-5">
                    <h3 className="font-semibold text-warm-900">{topic.title}</h3>
                    <p className="mt-1 text-sm text-warm-500 line-clamp-2">{topic.description}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Latest from the Blog */}
        {recentPosts.length > 0 && (
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-warm-900">
              Latest from the Blog
            </h2>
            <p className="mt-1 text-warm-500">
              News, tips, and stories from the neighborhood.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {recentPosts.map((post) => (
                <Link key={post.slug} href={`/blog/${post.slug}`} className="group overflow-hidden rounded-xl border border-warm-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                  {post.image && (
                    <div className="relative aspect-video overflow-hidden">
                      <Image src={post.image} alt={post.title} fill className="object-cover transition-transform group-hover:scale-105" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                    </div>
                  )}
                  <div className="p-5">
                    <span className="text-xs font-medium uppercase text-amber-600">{post.category.replace(/-/g, " ")}</span>
                    <h3 className="mt-1 font-semibold text-warm-900 group-hover:text-amber-600 transition-colors">{post.title}</h3>
                    <p className="mt-1 text-sm text-warm-500 line-clamp-2">{post.description}</p>
                  </div>
                </Link>
              ))}
            </div>
            <div className="mt-4">
              <Link
                href="/blog"
                className="text-sm font-medium text-amber-600 hover:underline"
              >
                Read more on the blog &rarr;
              </Link>
            </div>
          </section>
        )}

        {/* Where to Stay */}
        {accommodations.length > 0 && (
          <section className="mb-16">
            <h2 className="text-2xl font-bold text-warm-900">
              Where to Stay
            </h2>
            <p className="mt-1 text-warm-500">
              Visiting Liberty Village? Top-rated short-term rentals and Airbnbs in the neighborhood.
            </p>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {accommodations.map((rental) => (
                <Link key={rental.slug} href={`/directory/${rental.slug}`} className="group overflow-hidden rounded-xl border border-warm-200 bg-white shadow-sm transition-shadow hover:shadow-md">
                  {rental.image && (
                    <div className="relative aspect-video overflow-hidden">
                      <Image src={rental.image} alt={rental.name} fill className="object-cover transition-transform group-hover:scale-105" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" />
                    </div>
                  )}
                  <div className="p-5">
                    <h3 className="font-semibold text-warm-900">{rental.name}</h3>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-amber-500">{"★".repeat(Math.floor(rental.rating))}</span>
                      <span className="text-sm text-warm-500">{rental.rating}</span>
                      <span className="text-sm text-warm-400">{rental.priceRange}</span>
                    </div>
                    <p className="mt-2 text-sm text-warm-500 line-clamp-2">{rental.description}</p>
                  </div>
                </Link>
              ))}
            </div>
            <div className="mt-4 flex gap-4">
              <Link
                href="/best/short-term-rentals"
                className="text-sm font-medium text-amber-600 hover:underline"
              >
                See all rentals &rarr;
              </Link>
              <Link
                href="/guide/where-to-stay"
                className="text-sm font-medium text-amber-600 hover:underline"
              >
                Read the stay guide &rarr;
              </Link>
            </div>
          </section>
        )}

        {/* Popular Services */}
        <section className="mb-16">
          <h2 className="text-2xl font-bold text-warm-900">
            Popular Services
          </h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {popularServices.map((service) => (
              <Link
                key={service.slug}
                href={`/best/${service.slug}`}
                className="rounded-full border border-warm-200 bg-white px-4 py-2 text-sm text-warm-700 transition-colors hover:border-amber-300 hover:text-amber-600"
              >
                {service.icon} {service.pluralName}
              </Link>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mb-16 rounded-2xl bg-sage-50 p-8 text-center sm:p-12">
          <h2 className="text-2xl font-bold text-warm-900">
            New to Liberty Village?
          </h2>
          <p className="mx-auto mt-2 max-w-lg text-warm-600">
            Moving to the neighborhood? Our comprehensive guide covers everything
            from parking to the best brunch spots.
          </p>
          <Link
            href="/guide/moving-guide"
            className="mt-6 inline-block rounded-full bg-sage-500 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-sage-600"
          >
            Read the Moving Guide
          </Link>
        </section>
      </div>

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateBreadcrumbSchema([
            { label: "Home", href: "/" },
          ])),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateWebsiteSchema()),
        }}
      />
    </div>
  );
}
