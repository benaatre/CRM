"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { ProjectCard } from "@/lib/data/projects";
import { ProjectForm } from "./project-form";

export function ProjectEditButton({ project }: { project: ProjectCard }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground">
        <Pencil className="size-4" /> تعديل المشروع
      </button>
      <ProjectForm open={open} onClose={() => setOpen(false)} project={project} />
    </>
  );
}
