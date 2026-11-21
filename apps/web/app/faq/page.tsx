import type { Metadata } from "next";
import { FaqDirectory } from "@/components/landing/faq-directory";

export const metadata: Metadata = {
  title: "FAQ · VeriPoC",
  description: "Frequently asked questions about VeriPoC bug bounty setup, the 100 CCD deposit, Concordium agent badges, and isolated Foundry verification.",
};

export default function FaqPage() {
  return <FaqDirectory />;
}
