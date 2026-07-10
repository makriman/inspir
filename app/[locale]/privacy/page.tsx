import { generateLocalizedStaticParams } from "../locale-utils";
export { default, generateMetadata } from "@/app/(marketing)/privacy/page";

export const dynamic = "force-static";
export const revalidate = false;

export function generateStaticParams() {
  return generateLocalizedStaticParams("/privacy");
}
