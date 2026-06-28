import { requireUser, isManager } from "@/lib/auth-guards";
import { getProjectsOverview } from "@/lib/data/projects";
import { ProjectsView } from "@/components/projects/projects-view";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await requireUser();
  const data = await getProjectsOverview();
  return <ProjectsView data={data} canManage={isManager(user.role)} />;
}
