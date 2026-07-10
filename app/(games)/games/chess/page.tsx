import type { Metadata } from "next";
import { ChessGame } from "./_components/chess-game";

export const metadata: Metadata = {
  title: "Play Chess",
  description: "Play a full legal game of Chess against a deterministic local strategy engine.",
};

export default function ChessPage() {
  return <ChessGame />;
}
