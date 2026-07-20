import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth-guards";
import { getLeadDetail, getLeadTransferHistory } from "@/lib/data/leads";
import { prisma } from "@/lib/prisma";
import { LeadProfile } from "@/components/leads/lead-profile";

export const dynamic = "force-dynamic";

export default async function LeadProfilePage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const detail = await getLeadDetail(id);
  if (!detail) notFound();
  // سجل التحويلات: يرجّع null لغير المالك (الصلاحية على الخادم داخل الدالة).
  const [projects, transferHistory] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    getLeadTransferHistory(id),
  ]);
  return <LeadProfile detail={detail} projects={projects} transferHistory={transferHistory} />;
}
