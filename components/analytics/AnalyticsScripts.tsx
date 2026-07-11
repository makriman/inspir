import Script from "next/script";

const googleAnalyticsId = "G-S3E1FV3RK8";
const clarityProjectId = "xi5vqkce95";

export function AnalyticsScripts({ nonce }: { nonce?: string }) {
  return (
    <>
      <Script
        id="google-analytics-loader"
        src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`}
        strategy="afterInteractive"
        nonce={nonce}
      />
      <Script id="google-analytics-config" strategy="afterInteractive" nonce={nonce}>
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){window.dataLayer.push(arguments);}
          window.gtag = window.gtag || gtag;
          gtag('js', new Date());
          gtag('config', '${googleAnalyticsId}', { send_page_view: false });
        `}
      </Script>
      <Script id="microsoft-clarity" strategy="afterInteractive" nonce={nonce}>
        {`
          (function(c,l,a,r,i,t,y){
            c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
            t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
            y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
          })(window, document, "clarity", "script", "${clarityProjectId}");
        `}
      </Script>
    </>
  );
}
