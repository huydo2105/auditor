import type { Metadata } from "next";
import { TeamInbox } from "@/components/inbox/team-inbox";

export const metadata: Metadata = {
  title: "Inbox · Auditor",
  description: "Private program inbox for security findings, advisory agent notes, manual team triage, and patch retests.",
};

export default function InboxPage() {
  return <TeamInbox />;
}
