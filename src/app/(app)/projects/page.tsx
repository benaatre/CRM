import { requireUser } from "@/lib/auth-guards";
import { getProjectsOverview } from "@/lib/data/projects";
import { ProjectsView } from "@/components/projects/projects-view";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  await requireUser();
  const data = await getProjectsOverview();
  return <ProjectsView data={data} />;
}
