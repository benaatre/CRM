import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guards";
import { getLeadDetail } from "@/lib/data/leads";
import { prisma } from "@/lib/prisma";
import { LeadProfile } from "@/components/leads/lead-profile";

export const dynamic = "force-dynamic";

export default async function LeadProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const detail = await getLeadDetail(id);
  if (!detail) notFound();
  const projects = await prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return <LeadProfile detail={detail} projects={projects} />;
}
