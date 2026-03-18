import { generateTermsPageMeta } from "@/lib/meta";
import { getBreadcrumbs } from "@/lib/links";
import Breadcrumbs from "@/components/Breadcrumbs";

export const metadata = generateTermsPageMeta();

export default function TermsOfServicePage() {
  const breadcrumbs = getBreadcrumbs("terms", "Terms of Service");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Terms of Service
      </h1>
      <p className="mt-3 text-sm text-warm-400">Last updated: February 7, 2026</p>

      <article className="mt-10 prose-warm">
        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          1. Acceptance of Terms
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          By accessing and using libertyvillage.co (the &ldquo;Site&rdquo;), you
          accept and agree to be bound by these Terms of Service. If you do not
          agree to these terms, please do not use the Site. Your continued use of
          the Site following any changes to these terms constitutes acceptance of
          those changes.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          2. Description of Service
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          LibertyVillage.co is a local directory and neighbourhood guide for
          Liberty Village, Toronto, Canada. The Site provides information about
          local businesses, services, neighbourhood guides, community resources,
          and neighbourhood comparisons. The content is intended to help residents,
          visitors, and prospective residents learn about the Liberty Village
          neighbourhood.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          3. User Conduct
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          When using the Site, you agree not to:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-warm-700 mb-4">
          <li>Use the Site for any unlawful purpose or in violation of any applicable laws.</li>
          <li>Attempt to gain unauthorized access to any part of the Site, its servers, or any connected systems.</li>
          <li>Interfere with or disrupt the Site or its infrastructure.</li>
          <li>Scrape, crawl, or use automated means to access the Site in a manner that places undue burden on the servers, without prior written consent.</li>
          <li>Reproduce, duplicate, or exploit any portion of the Site for commercial purposes without express written permission.</li>
        </ul>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          4. Intellectual Property
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          All content on the Site, including but not limited to text, graphics,
          logos, images, and software, is the property of LibertyVillage.co or
          its content providers and is protected by Canadian and international
          copyright, trademark, and other intellectual property laws. You may not
          reproduce, distribute, modify, or create derivative works from any
          content on the Site without prior written consent.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          5. Disclaimer of Information
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          The information provided on the Site, including business listings,
          hours of operation, prices, ratings, and descriptions, is provided on
          an &ldquo;as-is&rdquo; and &ldquo;as-available&rdquo; basis. Business
          details, including operating hours, menus, pricing, and availability,
          may change without notice. We make reasonable efforts to keep
          information accurate and up to date, but we do not warrant the
          completeness, reliability, or accuracy of any information on the Site.
        </p>
        <p className="text-warm-700 leading-relaxed mb-4">
          We recommend contacting businesses directly to confirm details before
          visiting, especially regarding hours of operation, availability, and
          pricing.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          6. Limitation of Liability
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          To the fullest extent permitted by applicable law, LibertyVillage.co,
          its owners, operators, and contributors shall not be liable for any
          direct, indirect, incidental, special, consequential, or punitive
          damages arising out of or related to your use of, or inability to use,
          the Site or its content. This includes, without limitation, damages for
          loss of profits, data, goodwill, or other intangible losses.
        </p>
        <p className="text-warm-700 leading-relaxed mb-4">
          LibertyVillage.co does not endorse, guarantee, or assume
          responsibility for any business, product, or service listed or
          advertised on the Site.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          7. Third-Party Links
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          The Site may contain links to third-party websites, including business
          websites, Google Maps, social media profiles, and other external
          resources. These links are provided for your convenience only.
          LibertyVillage.co does not control and is not responsible for the
          content, privacy policies, or practices of any third-party websites. We
          encourage you to review the terms and privacy policies of any
          third-party sites you visit.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          8. Changes to Terms
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          We reserve the right to update or modify these Terms of Service at any
          time without prior notice. Changes will be effective immediately upon
          posting to the Site. The &ldquo;Last updated&rdquo; date at the top of
          this page will be revised accordingly. Your continued use of the Site
          after any changes constitutes acceptance of the updated terms.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          9. Governing Law
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          These Terms of Service shall be governed by and construed in accordance
          with the laws of the Province of Ontario and the federal laws of Canada
          applicable therein, without regard to conflict of law principles. Any
          disputes arising from these terms or your use of the Site shall be
          subject to the exclusive jurisdiction of the courts of Ontario, Canada.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          10. Contact Information
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          If you have any questions about these Terms of Service, please contact
          us at{" "}
          <a
            href="mailto:hello@libertyvillage.co"
            className="text-amber-600 hover:underline"
          >
            hello@libertyvillage.co
          </a>
          .
        </p>
      </article>
    </div>
  );
}
