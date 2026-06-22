"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { ProjectStatus } from "@prisma/client";
import { projectStatusLabels } from "@/lib/labels";
import { createProject, updateProject } from "@/lib/actions/projects";
import type { ProjectCard } from "@/lib/data/projects";

export function ProjectForm({ open, onClose, project }: { open: boolean; onClose: () => void; project?: ProjectCard }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!project;

  if (!open) return null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = isEdit ? await updateProject(project!.id, fd) : await createProject(fd);
      if (res.ok) { router.refresh(); onClose(); }
      else setError(res.error ?? "صار خطأ");
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="glass relative z-10 max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground">{isEdit ? "تعديل المشروع" : "مشروع جديد"}</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground hover:bg-secondary"><X className="size-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="اسم المشروع *"><input name="name" required defaultValue={project?.name ?? ""} className="select-base" /></Field>
            <Field label="الحي"><input name="district" defaultValue={project?.district ?? ""} className="select-base" /></Field>
            <Field label="الحالة">
              <select name="status" defaultValue={project?.status ?? "AVAILABLE"} className="select-base">
                {(Object.keys(projectStatusLabels) as ProjectStatus[]).map((s) => <option key={s} value={s}>{projectStatusLabels[s]}</option>)}
              </select>
            </Field>
            <Field label="موعد التسليم"><input name="deliveryDate" type="date" defaultValue={project?.deliveryDate ? new Date(project.deliveryDate).toISOString().slice(0, 10) : ""} className="select-base" /></Field>
            <Field label="السعر من"><input name="priceMin" inputMode="numeric" dir="ltr" defaultValue={project?.priceMin ?? ""} className="select-base" /></Field>
            <Field label="السعر إلى"><input name="priceMax" inputMode="numeric" dir="ltr" defaultValue={project?.priceMax ?? ""} className="select-base" /></Field>
            <Field label="رقم فال REGA"><input name="falLicense" dir="ltr" defaultValue={project?.falLicense ?? ""} className="select-base" /></Field>
          </div>
          <Field label="الوصف"><textarea name="description" rows={2} defaultValue={project?.description ?? ""} className="select-base" /></Field>

          {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2 text-sm text-muted-foreground">إلغاء</button>
            <button type="submit" disabled={pending} className="rounded-xl bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">{pending ? "جارٍ…" : isEdit ? "حفظ" : "أضف المشروع"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}
