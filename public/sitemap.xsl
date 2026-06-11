<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:sitemap="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"
  xmlns:xhtml="http://www.w3.org/1999/xhtml"
  exclude-result-prefixes="sitemap image video xhtml">
  <xsl:output method="html" encoding="UTF-8" indent="yes" />

  <xsl:template match="/">
    <html lang="en">
      <head>
        <title>inspir sitemap</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          :root {
            color-scheme: light;
            --ink: #171719;
            --muted: #686868;
            --line: rgba(23, 23, 25, 0.12);
            --paper: #fffdf8;
            --soft: #f6f7f9;
            --red: #ff385c;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            background: linear-gradient(180deg, #ffffff 0%, var(--soft) 100%);
            color: var(--ink);
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          }

          main {
            width: min(1120px, calc(100% - 40px));
            margin: 0 auto;
            padding: 64px 0 80px;
          }

          header {
            display: grid;
            gap: 14px;
            margin-bottom: 34px;
          }

          .eyebrow {
            color: var(--red);
            font-size: 12px;
            font-weight: 900;
            text-transform: uppercase;
          }

          h1 {
            max-width: 760px;
            margin: 0;
            font-size: clamp(42px, 7vw, 82px);
            line-height: 0.96;
            letter-spacing: 0;
          }

          p {
            max-width: 760px;
            margin: 0;
            color: var(--muted);
            font-size: 18px;
            line-height: 1.6;
          }

          .stats {
            display: grid;
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
            margin: 34px 0;
          }

          .stat {
            border: 1px solid var(--line);
            border-radius: 8px;
            background: rgba(255, 255, 255, 0.74);
            padding: 18px;
          }

          .stat strong,
          .stat span {
            display: block;
          }

          .stat strong {
            font-size: 28px;
            line-height: 1;
          }

          .stat span {
            margin-top: 6px;
            color: var(--muted);
            font-size: 13px;
            font-weight: 760;
            text-transform: uppercase;
          }

          table {
            width: 100%;
            overflow: hidden;
            border-collapse: separate;
            border-spacing: 0;
            border: 1px solid var(--line);
            border-radius: 8px;
            background: var(--paper);
            box-shadow: 0 22px 70px rgba(23, 23, 25, 0.08);
          }

          th,
          td {
            border-bottom: 1px solid var(--line);
            padding: 14px 16px;
            text-align: left;
            vertical-align: top;
          }

          th {
            background: #ffffff;
            color: var(--muted);
            font-size: 12px;
            font-weight: 900;
            text-transform: uppercase;
          }

          tr:last-child td {
            border-bottom: 0;
          }

          a {
            color: var(--ink);
            font-weight: 760;
            overflow-wrap: anywhere;
            text-decoration-color: rgba(255, 56, 92, 0.42);
            text-decoration-thickness: 2px;
            text-underline-offset: 4px;
          }

          .meta {
            color: var(--muted);
            font-size: 13px;
            line-height: 1.45;
            white-space: nowrap;
          }

          @media (max-width: 760px) {
            main {
              width: min(100% - 28px, 1120px);
              padding: 42px 0 64px;
            }

            .stats {
              grid-template-columns: 1fr;
            }

            table,
            tbody,
            tr,
            td {
              display: block;
            }

            thead {
              display: none;
            }

            tr {
              border-bottom: 1px solid var(--line);
            }

            tr:last-child {
              border-bottom: 0;
            }

            td {
              border-bottom: 0;
              padding: 12px 14px;
            }

            .meta {
              white-space: normal;
            }
          }
        </style>
      </head>
      <body>
        <main>
          <header>
            <span class="eyebrow">XML sitemap</span>
            <h1>
              <xsl:choose>
                <xsl:when test="sitemap:sitemapindex">inspir language sitemap index</xsl:when>
                <xsl:otherwise>inspir public index</xsl:otherwise>
              </xsl:choose>
            </h1>
            <p>
              <xsl:choose>
                <xsl:when test="sitemap:sitemapindex">This is the crawlable sitemap index for every supported inspir language. Each linked sitemap contains localized public SEO URLs with complete hreflang alternates.</xsl:when>
                <xsl:otherwise>This is the crawlable sitemap for the public inspir learning site. Private chats, admin routes, and account surfaces are intentionally excluded.</xsl:otherwise>
              </xsl:choose>
            </p>
          </header>

          <section class="stats" aria-label="Sitemap summary">
            <div class="stat">
              <strong>
                <xsl:value-of select="count(sitemap:urlset/sitemap:url) + count(sitemap:sitemapindex/sitemap:sitemap)" />
              </strong>
              <span>
                <xsl:choose>
                  <xsl:when test="sitemap:sitemapindex">language sitemaps</xsl:when>
                  <xsl:otherwise>public URLs</xsl:otherwise>
                </xsl:choose>
              </span>
            </div>
            <div class="stat">
              <strong><xsl:value-of select="count(sitemap:urlset/sitemap:url[image:image])" /></strong>
              <span>image entries</span>
            </div>
            <div class="stat">
              <strong><xsl:value-of select="count(sitemap:urlset/sitemap:url[video:video])" /></strong>
              <span>video entries</span>
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th>
                  <xsl:choose>
                    <xsl:when test="sitemap:sitemapindex">Sitemap</xsl:when>
                    <xsl:otherwise>URL</xsl:otherwise>
                  </xsl:choose>
                </th>
                <th>Last modified</th>
                <th>Change</th>
                <th>Priority</th>
              </tr>
            </thead>
            <tbody>
              <xsl:choose>
                <xsl:when test="sitemap:sitemapindex">
                  <xsl:for-each select="sitemap:sitemapindex/sitemap:sitemap">
                    <tr>
                      <td>
                        <a href="{sitemap:loc}">
                          <xsl:value-of select="sitemap:loc" />
                        </a>
                      </td>
                      <td class="meta"><xsl:value-of select="sitemap:lastmod" /></td>
                      <td class="meta">language file</td>
                      <td class="meta">localized</td>
                    </tr>
                  </xsl:for-each>
                </xsl:when>
                <xsl:otherwise>
                  <xsl:for-each select="sitemap:urlset/sitemap:url">
                    <tr>
                      <td>
                        <a href="{sitemap:loc}">
                          <xsl:value-of select="sitemap:loc" />
                        </a>
                      </td>
                      <td class="meta"><xsl:value-of select="sitemap:lastmod" /></td>
                      <td class="meta"><xsl:value-of select="sitemap:changefreq" /></td>
                      <td class="meta"><xsl:value-of select="sitemap:priority" /></td>
                    </tr>
                  </xsl:for-each>
                </xsl:otherwise>
              </xsl:choose>
            </tbody>
          </table>
        </main>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
