import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getRecentPosts } from "@/lib/data";
import { generateCollectionPageSchema, generateBreadcrumbSchema } from "@/lib/schema";
import Breadcrumbs from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: "Liberty Village Blog — Local News & Updates | libertyvillage.co",
  description: "Stay updated on Liberty Village with local news, development updates, restaurant openings, transit changes, and community stories.",
  openGraph: {
    title: "Liberty Village Blog",
    description: "Local news and updates from Liberty Village, Toronto.",
    type: "website",
    url: "https://libertyvillage.co/blog",
    siteName: "LibertyVillage.co",
    locale: "en_CA",
  },
  alternates: {
    canonical: "https://libertyvillage.co/blog",
    languages: { "en-CA": "https://libertyvillage.co/blog" },
  },
};

export default function BlogIndexPage() {
  const posts = getRecentPosts(50);
  const categories = [...new Set(posts.map((p) => p.category))];

  const collectionSchema = generateCollectionPageSchema(
    "Liberty Village Blog",
    "Local news, updates, and stories from Liberty Village, Toronto.",
    "/blog",
    posts.map((p) => ({ name: p.title, url: `/blog/${p.slug}` }))
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumbs items={[
        { label: "Home", href: "/" },
        { label: "Blog", href: "/blog" },
      ]} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Liberty Village Blog
      </h1>
      <p className="mt-2 text-warm-500">
        Local news, development updates, and community stories from the neighbourhood.
      </p>

      {categories.length > 0 && (
        <div className="mt-6 flex flex-wrap gap-2">
          {categories.map((cat) => (
            <span key={cat} className="rounded-full border border-warm-200 bg-white px-4 py-2 text-sm text-warm-700">
              {cat.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
          ))}
        </div>
      )}

      {posts.length > 0 ? (
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <Link
              key={post.slug}
              href={`/blog/${post.slug}`}
              className="group overflow-hidden rounded-xl border border-warm-200 bg-white shadow-sm transition-shadow hover:shadow-md"
            >
              {post.image && (
                <div className="relative aspect-video overflow-hidden">
                  <Image
                    src={post.image}
                    alt={post.title}
                    fill
                    className="object-cover transition-transform group-hover:scale-105"
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  />
                </div>
              )}
              <div className="p-5">
                <div className="flex items-center gap-2 text-xs text-warm-400">
                  <span>{post.category.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                  <span>&middot;</span>
                  <time>{new Date(post.publishedAt).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" })}</time>
                </div>
                <h2 className="mt-2 font-semibold text-warm-900 group-hover:text-amber-600 transition-colors">
                  {post.title}
                </h2>
                <p className="mt-1 text-sm text-warm-500 line-clamp-2">{post.description}</p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-12 text-center text-warm-400">No posts yet. Check back soon.</p>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(generateBreadcrumbSchema([
            { label: "Home", href: "/" },
            { label: "Blog", href: "/blog" },
          ])),
        }}
      />
    </div>
  );
}
