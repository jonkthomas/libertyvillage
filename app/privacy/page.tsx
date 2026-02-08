import { generatePrivacyPageMeta } from "@/lib/meta";
import { getBreadcrumbs } from "@/lib/links";
import Breadcrumbs from "@/components/Breadcrumbs";

export const metadata = generatePrivacyPageMeta();

export default function PrivacyPolicyPage() {
  const breadcrumbs = getBreadcrumbs("privacy", "Privacy Policy");

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Breadcrumbs items={breadcrumbs} />

      <h1 className="text-3xl font-bold text-warm-900 sm:text-4xl">
        Privacy Policy
      </h1>
      <p className="mt-3 text-sm text-warm-400">Last updated: February 7, 2026</p>

      <article className="mt-10 prose-warm">
        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          1. Introduction
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          LibertyVillage.co (the &ldquo;Site&rdquo;) is committed to protecting
          your privacy. This Privacy Policy explains what information we collect,
          how we use it, and your rights regarding your data when you visit our
          Site. LibertyVillage.co is a local directory and neighborhood guide for
          Liberty Village, Toronto, Canada.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          2. Information We Collect
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          The Site does not collect personal information directly. We do not
          require account creation, we do not offer login functionality, we do
          not have contact forms, and we do not operate a newsletter or mailing
          list. The only data collected is through third-party analytics
          services, as described below.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          3. Google Analytics
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          We use Google Analytics, a web analytics service provided by Google
          LLC, to help us understand how visitors interact with the Site. Google
          Analytics collects information such as:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-warm-700 mb-4">
          <li>Pages you visit and time spent on each page.</li>
          <li>Your approximate geographic location (city or region level).</li>
          <li>The website or search engine that referred you to the Site.</li>
          <li>Your browser type, device type, and operating system.</li>
          <li>Your screen resolution and language preferences.</li>
        </ul>
        <p className="text-warm-700 leading-relaxed mb-4">
          This information is aggregated and anonymized. Google Analytics does
          not collect your name, email address, or other personally identifiable
          information through our implementation. For more information on how
          Google processes this data, please review{" "}
          <a
            href="https://policies.google.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-600 hover:underline"
          >
            Google&rsquo;s Privacy Policy
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          4. Use of Cookies
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          The Site uses cookies placed by Google Analytics to distinguish unique
          visitors and track sessions. These cookies do not contain personally
          identifiable information. You can control or disable cookies through
          your browser settings. You may also opt out of Google Analytics
          tracking by installing the{" "}
          <a
            href="https://tools.google.com/dlpage/gaoptout"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-600 hover:underline"
          >
            Google Analytics Opt-out Browser Add-on
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          5. No Personal Data Collection
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          To be clear, the Site does not:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-warm-700 mb-4">
          <li>Collect your name, email address, or phone number.</li>
          <li>Require you to create an account or log in.</li>
          <li>Operate a newsletter, mailing list, or email subscription service.</li>
          <li>Include contact forms, comment sections, or user-generated content features.</li>
          <li>Process payments or store financial information.</li>
          <li>Sell, rent, or share personal information with third parties.</li>
        </ul>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          6. Third-Party Services
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          In addition to Google Analytics, the Site may embed content from or
          link to third-party services, such as Google Maps, business websites,
          and social media platforms. These third parties have their own privacy
          policies, and we encourage you to review them. We are not responsible
          for the privacy practices of any third-party services.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          7. Data Retention
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          Google Analytics data retention is set to the default period of 14
          months, after which data is automatically deleted. Since we do not
          collect personal information directly, there is no other user data
          stored on our servers.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          8. Children&rsquo;s Privacy
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          The Site is not directed at children under the age of 13. We do not
          knowingly collect personal information from children. Since the Site
          does not collect personal information from any users, this applies
          equally to visitors of all ages.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          9. PIPEDA Compliance
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          As a Canadian website, we are committed to compliance with the Personal
          Information Protection and Electronic Documents Act (PIPEDA) and
          applicable provincial privacy legislation. Since we do not collect,
          use, or disclose personal information directly, our obligations under
          PIPEDA are limited. However, we ensure that our use of third-party
          analytics services is consistent with Canadian privacy principles,
          including accountability, transparency, and consent.
        </p>
        <p className="text-warm-700 leading-relaxed mb-4">
          You have the right to access, correct, or request deletion of any
          personal information that may be associated with your use of the Site.
          If you have concerns about your privacy related to Google Analytics
          data, you may opt out using the tools described in Section 4 above.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          10. Changes to This Policy
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          We may update this Privacy Policy from time to time to reflect changes
          in our practices or for other operational, legal, or regulatory
          reasons. Any changes will be posted on this page with an updated
          &ldquo;Last updated&rdquo; date. We encourage you to review this page
          periodically.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          11. Contact Information
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          If you have any questions or concerns about this Privacy Policy, please
          contact us at{" "}
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
