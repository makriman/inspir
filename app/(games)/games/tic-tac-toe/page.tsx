import type { Metadata } from "next";
import { TicTacToeGame } from "./_components/tic-tac-toe-game";

export const metadata: Metadata = {
  title: "Play Tic-Tac-Toe",
  description: "Play Tic-Tac-Toe against a deterministic local strategy engine.",
};

export default function TicTacToePage() {
  return <TicTacToeGame />;
}
