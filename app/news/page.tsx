import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { getNewsPosts } from "@/lib/data";
import {
  generateCollectionPageSchema,
  generateBreadcrumbSchema,
} from "@/lib/schema";
import Breadcrumbs from "@/components/Breadcrumbs";

export const metadata: Metadata = {
  title: "Liberty Village News — Local Updates | libertyvillage.co",
  description:
    "Latest local news from Liberty Village: development, transit, civic updates, and neighbourhood stories.",
  openGraph: {
    title: "Liberty Village News",
    description:
      "Local news and neighbourhood updates from Liberty Village, Toronto.",
    type: "website",
    url: "https://libertyvillage.co/news",
    siteName: "LibertyVillage.co",
    locale: "en_CA",
  },
  alternates: {
    canonical: "https://libertyvillage.co/news",
    languages: { "en-CA": "https://libertyvillage.co/news" },
  },
};

export default function NewsIndexPage() {
  const posts = getNewsPosts(50);

  const collectionSchema = generateCollectionPageSchema(
    "Liberty Village News",
    "Local news and neighbourhood updates from Liberty Village, Toronto.",
    "/news",
    posts.map((p) => ({ name: p.title, url: `/blog/${p.slug}` })),
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <Breadcrumbs
        items={[
          { label: "Home", href: "/" },
          { label: "News", href: "/news" },
        ]}
      />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Liberty Village News
      </h1>
      <p className="mt-2 text-warm-500">
        Local development, transit, and civic updates from the neighbourhood.
      </p>

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
                  <span>News</span>
                  <span>&middot;</span>
                  <time dateTime={post.publishedAt}>
                    {new Date(post.publishedAt).toLocaleDateString("en-CA", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </time>
                </div>
                <h2 className="mt-2 font-semibold text-warm-900 transition-colors group-hover:text-amber-600">
                  {post.title}
                </h2>
                <p className="mt-1 line-clamp-2 text-sm text-warm-500">
                  {post.description}
                </p>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <p className="mt-12 text-center text-warm-400">
          No news posts yet. Check back soon, or browse the{" "}
          <Link
            href="/blog"
            className="font-medium text-amber-700 hover:text-amber-600"
          >
            full blog
          </Link>
          .
        </p>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            generateBreadcrumbSchema([
              { label: "Home", href: "/" },
              { label: "News", href: "/news" },
            ]),
          ),
        }}
      />
    </div>
  );
}
