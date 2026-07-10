import type { Metadata } from "next";
import { ConnectFourResult } from "../../_components/connect-four-result";

export const metadata: Metadata = {
  title: "Connect Four result",
  description: "Inspect the exact terminal result and move replay for a Connect Four game.",
  robots: { index: false, follow: false },
};

export default async function ConnectFourResultPage({
  params,
}: Readonly<{ params: Promise<{ resultId: string }> }>) {
  const { resultId } = await params;
  return <ConnectFourResult resultId={resultId} />;
}
