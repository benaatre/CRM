import { notFound } from "next/navigation";
import { requireClientAccess, requireUser, isManager } from "@/lib/auth-guards";
import { getLeadDetail, getLeadTransferHistory } from "@/lib/data/leads";
import { prisma } from "@/lib/prisma";
import { LeadProfile } from "@/components/leads/lead-profile";

export const dynamic = "force-dynamic";

export default async function LeadProfilePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fu?: string }> }) {
  const user = await requireClientAccess();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const detail = await getLeadDetail(id);
  if (!detail) notFound();
  // سجل التحويلات: يرجّع null لغير المالك (الصلاحية على الخادم داخل الدالة).
  const [projects, transferHistory] = await Promise.all([
    prisma.project.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
    getLeadTransferHistory(id),
  ]);
  // ?fu=interested يفتح تبويب المتابعة بالاختيار المبدئي (سؤال الواتساب من شاشات أخرى).
  const initialFu = sp.fu === "interested" ? "interested" : null;
  return <LeadProfile detail={detail} projects={projects} transferHistory={transferHistory} isManager={isManager(user.role)} initialFu={initialFu} />;
}
