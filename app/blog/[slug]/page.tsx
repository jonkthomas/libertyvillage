import { notFound } from "next/navigation";
import { getAllPosts, getPostBySlug } from "@/lib/data";
import { generateBlogPostPageMeta } from "@/lib/meta";
import { generateBlogPostSchema, generateSpeakableSchema } from "@/lib/schema";
import { getRelatedPosts, getRelatedGuidesForPost, getRelatedServicesForPost, getBreadcrumbs } from "@/lib/links";
import { renderMarkdownContent } from "@/lib/markdown";
import Breadcrumbs from "@/components/Breadcrumbs";
import HeroImage from "@/components/HeroImage";
import FAQSection from "@/components/FAQSection";
import RelatedLinks from "@/components/RelatedLinks";
import AnswerBlock from "@/components/AnswerBlock";
import KeyTakeaways from "@/components/KeyTakeaways";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return {};
  return generateBlogPostPageMeta(post);
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const relatedPostLinks = getRelatedPosts(slug);
  const relatedGuideLinks = getRelatedGuidesForPost(post.relatedTopics);
  const relatedServiceLinks = getRelatedServicesForPost(post.relatedServices);
  const breadcrumbs = getBreadcrumbs("blog", post.title);

  const blogPostSchema = generateBlogPostSchema(post);
  const speakableSchema = generateSpeakableSchema(`/blog/${post.slug}`);
  const contentHtml = renderMarkdownContent(post.content);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      {post.image && <HeroImage src={post.image} alt={post.title} />}

      <div className="flex items-center gap-2 text-sm text-warm-400 mb-2">
        <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-medium text-amber-700">
          {post.category.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())}
        </span>
        <time>{new Date(post.publishedAt).toLocaleDateString("en-CA", { month: "long", day: "numeric", year: "numeric" })}</time>
      </div>

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">{post.title}</h1>
      <p className="mt-3 text-lg text-warm-500">{post.description}</p>

      <AnswerBlock>{post.answerBlock}</AnswerBlock>

      {post.keyTakeaways.length > 0 && <KeyTakeaways items={post.keyTakeaways} />}

      {post.tags.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {post.tags.map((tag) => (
            <span key={tag} className="rounded-full border border-warm-200 px-3 py-1 text-xs text-warm-500">#{tag}</span>
          ))}
        </div>
      )}

      <article
        className="mt-10 prose-warm"
        dangerouslySetInnerHTML={{ __html: contentHtml }}
      />

      <FAQSection faqs={post.faqs} />

      <RelatedLinks heading="Related Posts" links={relatedPostLinks} />
      <RelatedLinks heading="Related Guides" links={relatedGuideLinks} />
      <RelatedLinks heading="Related Services" links={relatedServiceLinks} />

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(blogPostSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(speakableSchema) }}
      />
    </div>
  );
}
