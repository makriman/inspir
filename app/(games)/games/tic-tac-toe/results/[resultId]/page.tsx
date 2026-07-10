import type { Metadata } from "next";
import { TicTacToeResult } from "../../_components/tic-tac-toe-result";

export const metadata: Metadata = {
  title: "Tic-Tac-Toe result",
  description: "Inspect the exact terminal result and move replay for a Tic-Tac-Toe game.",
  robots: { index: false, follow: false },
};

export default async function TicTacToeResultPage({
  params,
}: Readonly<{ params: Promise<{ resultId: string }> }>) {
  const { resultId } = await params;
  return <TicTacToeResult resultId={resultId} />;
}
