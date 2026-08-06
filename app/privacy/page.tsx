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
      <p className="mt-3 text-sm text-warm-400">Last updated: August 6, 2026</p>

      <article className="mt-10 prose-warm">
        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          1. Introduction
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          LibertyVillage.co (the &ldquo;Site&rdquo;) is committed to protecting
          your privacy. This Privacy Policy explains what information we collect,
          how we use it, and your rights regarding your data when you visit our
          Site. LibertyVillage.co is a local directory and neighbourhood guide for
          Liberty Village, Toronto, Canada.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          2. Information We Collect
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          We do not require account creation or offer login functionality. We
          collect limited usage information through the analytics services
          described below. If you choose to use an email subscription form, the
          email address and the page that offered the form are sent to the
          configured subscription provider so it can process your request.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          3. Analytics Services
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
          We do not send names, email addresses, phone numbers, form values, or
          business-link destinations to Google Analytics through our
          implementation. For more information on how Google processes data,
          please review{" "}
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
        <p className="text-warm-700 leading-relaxed mb-4">
          We also use PostHog Cloud US to measure page visits, how visitors
          arrived at the Site, and aggregate interactions such as business phone
          or website clicks and subscription outcomes. Our PostHog setup disables
          automatic element capture, session recording, and person profiles. It
          does not send submitted email addresses, phone numbers, full outbound
          URLs, query strings, or element text. PostHog receives the network IP
          address needed to accept each request, but every event disables GeoIP
          enrichment so our implementation does not add IP-derived city or region
          fields. Events are tagged with the Site hostname and deployment
          environment so preview traffic can be excluded from production reporting.
        </p>
        <p className="text-warm-700 leading-relaxed mb-4">
          For more information, review{" "}
          <a
            href="https://posthog.com/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-600 hover:underline"
          >
            PostHog&rsquo;s Privacy Policy
          </a>
          .
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          4. Use of Cookies
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          Google Analytics may place cookies to distinguish visitors and track
          sessions. PostHog is configured to use in-memory analytics state rather
          than persistent browser identifiers; the Site uses session storage only
          to avoid counting the same landing more than once in one browser tab.
          You can control cookies and site storage through your browser settings.
          You may also opt out of Google Analytics tracking by installing the{" "}
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
          5. Information We Do Not Request
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          Except for an email address you voluntarily submit through a configured
          subscription form, the Site does not ask you to provide contact or
          account information. The Site does not:
        </p>
        <ul className="list-disc pl-6 space-y-2 text-warm-700 mb-4">
          <li>Require you to create an account or log in.</li>
          <li>Ask analytics providers to capture form values or contact details.</li>
          <li>Include comment sections or user-generated content features.</li>
          <li>Process payments or store financial information.</li>
          <li>Sell or rent submitted email addresses.</li>
        </ul>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          6. Third-Party Services
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          The Site uses Google Analytics and PostHog as described above and may
          use an email subscription provider when a subscription form is
          configured. It may also embed content from or link to third-party
          services, such as Google Maps, business websites, and social media
          platforms. These third parties have their own privacy policies, and we
          encourage you to review them. We are not responsible for their privacy
          practices.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          7. Data Retention
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          Analytics and subscription providers retain information according to
          their configured retention settings and privacy policies. You may
          contact us using the address below with a question about retention or a
          request concerning an email address you submitted.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          8. Children&rsquo;s Privacy
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          The Site is not directed at children under the age of 13. We do not
          knowingly solicit personal information from children. Subscription
          forms are intended for adults who want neighbourhood updates.
        </p>

        <h2 className="text-xl font-semibold text-warm-900 mt-10 mb-3">
          9. PIPEDA Compliance
        </h2>
        <p className="text-warm-700 leading-relaxed mb-4">
          We aim to handle information consistently with applicable Canadian
          privacy requirements and principles, including transparency and data
          minimization. Depending on the circumstances and applicable law, you
          may have rights to ask about, correct, or request deletion of personal
          information associated with a subscription request. Contact us using
          the address below to make an inquiry. For analytics controls, you can
          also use the browser and Google opt-out options in Section 4.
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
