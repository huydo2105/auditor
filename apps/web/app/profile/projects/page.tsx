import type { Metadata } from "next";
import { ProfileShell } from "@/components/profile/profile-shell";
import { ProjectTables } from "@/components/profile/project-tables";

export const metadata: Metadata = { title: "Projects" };
export default function ProjectsPage() { return <ProfileShell active="projects"><ProjectTables /></ProfileShell>; }
