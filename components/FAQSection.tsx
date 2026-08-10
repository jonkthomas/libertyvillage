import type { FAQ } from "@/lib/types";
import { generateFAQSchema, serializeJsonLd } from "@/lib/schema";
import { linkifyText, type LinkEntry } from "@/lib/linkify";

export default function FAQSection({
  faqs,
  heading = "Frequently Asked Questions",
  linkLookups = [],
}: {
  faqs: FAQ[];
  heading?: string;
  // When provided, entity-name mentions in answers are linked to their pages
  // (e.g. a business name -> its /directory page). Schema still uses raw text.
  linkLookups?: LinkEntry[];
}) {
  if (faqs.length === 0) return null;

  const schema = generateFAQSchema(faqs);

  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold text-warm-900">{heading}</h2>
      <div className="mt-4 space-y-2">
        {faqs.map((faq) => (
          <details
            key={faq.question}
            className="group rounded-lg border border-warm-200 bg-white"
          >
            <summary className="cursor-pointer px-5 py-4 text-sm font-medium text-warm-800 hover:text-amber-600 transition-colors list-none flex items-center justify-between">
              {faq.question}
              <span className="ml-2 text-warm-400 group-open:rotate-180 transition-transform">
                ▼
              </span>
            </summary>
            <div className="px-5 pb-4 text-sm text-warm-600 leading-relaxed">
              {linkLookups.length > 0
                ? linkifyText(faq.answer, linkLookups)
                : faq.answer}
            </div>
          </details>
        ))}
      </div>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(schema) }}
      />
    </section>
  );
}
