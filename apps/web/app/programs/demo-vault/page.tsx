import type { Metadata } from "next";
import { ProgramWorkspace } from "@/components/programs/program-workspace";

export const metadata: Metadata = { title: "Authorized Demo Vault Program" };

export default function DemoVaultProgramPage() { return <ProgramWorkspace />; }
