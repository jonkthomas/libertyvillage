import { notFound } from "next/navigation";
import { getAllTopics, getTopicBySlug } from "@/lib/data";
import { generateGuidePageMeta } from "@/lib/meta";
import { generateArticleSchema } from "@/lib/schema";
import { getRelatedGuides, getRelatedServices, getBreadcrumbs } from "@/lib/links";
import Breadcrumbs from "@/components/Breadcrumbs";
import FAQSection from "@/components/FAQSection";
import RelatedLinks from "@/components/RelatedLinks";

interface Props {
  params: Promise<{ topic: string }>;
}

export async function generateStaticParams() {
  const topics = getAllTopics();
  return topics.map((t) => ({ topic: t.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { topic: slug } = await params;
  const topic = getTopicBySlug(slug);
  if (!topic) return {};
  return generateGuidePageMeta(topic);
}

function renderMarkdownContent(content: string) {
  // Simple markdown to HTML: handle ## headings, ### headings, **bold**, paragraphs
  const lines = content.split("\n");
  const html: string[] = [];
  let inParagraph = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("### ")) {
      if (inParagraph) { html.push("</p>"); inParagraph = false; }
      html.push(`<h3 class="text-lg font-semibold text-warm-900 mt-6 mb-2">${trimmed.slice(4)}</h3>`);
    } else if (trimmed.startsWith("## ")) {
      if (inParagraph) { html.push("</p>"); inParagraph = false; }
      html.push(`<h2 class="text-xl font-semibold text-warm-900 mt-8 mb-3">${trimmed.slice(3)}</h2>`);
    } else if (trimmed === "") {
      if (inParagraph) { html.push("</p>"); inParagraph = false; }
    } else {
      if (!inParagraph) {
        html.push(`<p class="text-warm-600 leading-relaxed mb-4">`);
        inParagraph = true;
      }
      // Handle **bold**
      const processed = trimmed.replace(
        /\*\*(.+?)\*\*/g,
        '<strong class="text-warm-800">$1</strong>'
      );
      html.push(processed + " ");
    }
  }
  if (inParagraph) html.push("</p>");

  return html.join("\n");
}

// Helper to build related service links from slugs
function getServiceLinksFromSlugs(slugs: string[]) {
  return slugs.map((slug) => ({
    title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    href: `/best/${slug}`,
    description: `Find the best ${slug.replace(/-/g, " ")} in Liberty Village.`,
  }));
}

export default async function GuidePage({ params }: Props) {
  const { topic: slug } = await params;
  const topic = getTopicBySlug(slug);
  if (!topic) notFound();

  const relatedGuideLinks = getRelatedGuides(slug);
  const relatedServiceLinks = getServiceLinksFromSlugs(topic.relatedServices);
  const breadcrumbs = getBreadcrumbs("guide", topic.title);

  const articleSchema = generateArticleSchema(
    `Liberty Village ${topic.title}`,
    topic.description,
    "2026-01-15"
  );

  const contentHtml = renderMarkdownContent(topic.content);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Liberty Village {topic.title}
      </h1>
      <p className="mt-3 text-lg text-warm-500">{topic.description}</p>

      {/* Quick Tips */}
      {topic.quickTips.length > 0 && (
        <div className="mt-8 rounded-xl bg-sage-500 p-6 text-white">
          <h2 className="text-lg font-semibold">Quick Tips</h2>
          <ul className="mt-3 space-y-2">
            {topic.quickTips.map((tip) => (
              <li key={tip} className="flex items-start gap-2 text-sm text-white/90">
                <span className="mt-0.5">✓</span>
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Main Content */}
      <article
        className="mt-10 prose-warm"
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />

      <FAQSection faqs={topic.faqs} />

      <RelatedLinks heading="Related Guides" links={relatedGuideLinks} />
      <RelatedLinks heading="Related Services" links={relatedServiceLinks} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleSchema) }}
      />
    </div>
  );
}
