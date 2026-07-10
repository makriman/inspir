import type { Metadata } from "next";
import { ConnectFourGame } from "./_components/connect-four-game";

export const metadata: Metadata = {
  title: "Play Connect Four",
  description: "Play Connect Four against a deterministic local strategy engine.",
};

export default function ConnectFourPage() {
  return <ConnectFourGame />;
}
