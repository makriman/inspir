import type { Metadata } from "next";
import { ChessResult } from "../../_components/chess-result";

export const metadata: Metadata = {
  title: "Chess result",
  description: "Inspect the exact terminal result and move replay for a Chess game.",
  robots: { index: false, follow: false },
};

export default async function ChessResultPage({
  params,
}: Readonly<{ params: Promise<{ resultId: string }> }>) {
  const { resultId } = await params;
  return <ChessResult resultId={resultId} />;
}
