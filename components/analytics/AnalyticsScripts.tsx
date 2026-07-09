import Script from "next/script";

export const googleAnalyticsId = "G-S3E1FV3RK8";
const clarityProjectId = "xi5vqkce95";
const analyticsDelayMs = 8_000;

const deferredAnalyticsScript = `
(() => {
  if (window.__inspirAnalyticsScheduled) return;
  window.__inspirAnalyticsScheduled = true;

  const googleAnalyticsId = ${JSON.stringify(googleAnalyticsId)};
  const clarityProjectId = ${JSON.stringify(clarityProjectId)};
  const delayMs = ${analyticsDelayMs};

  function loadScript(src) {
    const script = document.createElement("script");
    script.async = true;
    script.src = src;
    document.head.appendChild(script);
  }

  function loadAnalytics() {
    if (window.__inspirAnalyticsLoaded) return;
    window.__inspirAnalyticsLoaded = true;

    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };
    window.gtag("js", new Date());
    window.gtag("config", googleAnalyticsId, { send_page_view: false });
    window.gtag("event", "page_view", {
      send_to: googleAnalyticsId,
      page_path: window.location.pathname,
      page_location: window.location.href
    });
    loadScript("https://www.googletagmanager.com/gtag/js?id=" + googleAnalyticsId);

    window.clarity = window.clarity || function clarity(){ (window.clarity.q = window.clarity.q || []).push(arguments); };
    loadScript("https://www.clarity.ms/tag/" + clarityProjectId);
  }

  function scheduleAnalytics() {
    window.setTimeout(loadAnalytics, delayMs);
  }

  if (document.readyState === "complete") {
    scheduleAnalytics();
  } else {
    window.addEventListener("load", scheduleAnalytics, { once: true });
  }
})();
`;

export function AnalyticsScripts({ nonce }: { nonce?: string }) {
  return (
    <Script id="deferred-product-analytics" strategy="lazyOnload" nonce={nonce}>
      {deferredAnalyticsScript}
    </Script>
  );
}
