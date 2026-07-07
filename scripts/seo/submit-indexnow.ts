import { absoluteUrl, siteUrl } from "@/lib/seo/config";
import { indexNowKey, indexNowKeyLocation, indexNowReleaseUrls } from "@/lib/seo/indexnow";

type Args = {
  endpoint: string;
  urls: string[];
};

const defaultEndpoint = "https://www.bing.com/indexnow";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const urlList = args.urls.map((url) => absoluteUrl(url));
  if (!urlList.length) throw new Error("No URLs supplied for IndexNow submission.");

  const response = await fetch(args.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      host: new URL(siteUrl).hostname,
      key: indexNowKey,
      keyLocation: indexNowKeyLocation,
      urlList,
    }),
  });

  const text = await response.text();
  console.log(
    JSON.stringify(
      {
        endpoint: args.endpoint,
        status: response.status,
        ok: response.ok || response.status === 202,
        submitted: urlList.length,
        keyLocation: indexNowKeyLocation,
        response: text.slice(0, 500),
      },
      null,
      2,
    ),
  );

  if (!response.ok && response.status !== 202) process.exitCode = 1;
}

function parseArgs(rawArgs: string[]): Args {
  const urls: string[] = [];
  let endpoint = process.env.INDEXNOW_ENDPOINT?.trim() || defaultEndpoint;

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];
    if (arg === "--endpoint") {
      endpoint = rawArgs[index + 1] ?? endpoint;
      index += 1;
    } else if (arg.startsWith("--endpoint=")) {
      endpoint = arg.slice("--endpoint=".length);
    } else if (arg === "--url") {
      urls.push(rawArgs[index + 1] ?? "");
      index += 1;
    } else if (arg.startsWith("--url=")) {
      urls.push(arg.slice("--url=".length));
    }
  }

  return {
    endpoint,
    urls: urls.map((url) => url.trim()).filter(Boolean).length
      ? urls.map((url) => url.trim()).filter(Boolean)
      : [...indexNowReleaseUrls],
  };
}
