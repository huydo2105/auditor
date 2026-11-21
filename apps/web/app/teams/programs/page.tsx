import type { Metadata } from "next";
import { SavedPrograms } from "@/components/journeys/saved-programs";

export const metadata: Metadata = { title: "My programs" };
export default function TeamProgramsPage() { return <SavedPrograms />; }
