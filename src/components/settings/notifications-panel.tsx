"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Bell, Volume2, VolumeX, Play, Upload, Trash2, Loader2 } from "lucide-react";
import { updateNotifyConfig } from "@/lib/actions/settings";
import {
  fetchNotificationConfig, updateNotificationEvent, updateMasterAudio, deleteSound,
} from "@/lib/actions/notifications";
import type { NotificationConfig, NotifEvent, NotifSound } from "@/lib/data/notifications-config";

// خيارات الجمهور (معرّفة هنا — لا تُستورد من وحدة server-only).
const AUDIENCE_OPTIONS = [
  { code: "OWNER", label: "المالك فقط" },
  { code: "MANAGERS", label: "المالك + المدير" },
  { code: "ASSIGNED", label: "الموظف المعني" },
  { code: "MANAGERS_AND_ASSIGNED", label: "المالك + المدير + الموظف المعني" },
  { code: "ALL", label: "الكل" },
];

export function NotificationsPanel({ notify }: { notify: { followupBeforeHours: number; staleHours: number } }) {
  const [cfg, setCfg] = useState<NotificationConfig | null>(null);
  const [vol, setVol] = useState(80);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    fetchNotificationConfig().then((c) => { setCfg(c); setVol(c.masterVolume); }).catch(() => {});
  }, []);

  // مستوى الحدث (٠–١٠٠) يُضرب في مستوى الصوت الرئيسي.
  function play(fileUrl: string | undefined, eventVolume = 100) {
    if (!fileUrl) return;
    if (audioRef.current) audioRef.current.pause();
    const a = new Audio(fileUrl);
    a.volume = Math.min(1, Math.max(0, (eventVolume / 100) * (vol / 100)));
    audioRef.current = a;
    a.play().catch(() => {});
  }

  function soundUrl(soundId: string | null): string | undefined {
    if (!cfg) return undefined;
    const s = cfg.sounds.find((x) => x.id === soundId) ?? cfg.sounds[0];
    return s?.fileUrl;
  }

  if (!cfg) {
    return (
      <div className="glass max-w-xl rounded-2xl p-6 text-center text-sm text-muted-foreground">
        <Loader2 className="mx-auto size-5 animate-spin text-gold" /> جارٍ تحميل إعدادات الإشعارات…
      </div>
    );
  }

  return (
    <div className="glass max-w-3xl space-y-6 rounded-2xl p-6">
      <div className="flex items-center gap-2"><Bell className="size-5 text-gold" /><h2 className="font-semibold text-foreground">الإشعارات والتنبيهات</h2></div>

      <MasterControls cfg={cfg} vol={vol} setVol={setVol} onChange={(p) => setCfg((c) => c && { ...c, ...p })} />

      <EventsTable cfg={cfg} setCfg={setCfg} play={play} soundUrl={soundUrl} />

      <SoundLibrary cfg={cfg} setCfg={setCfg} play={play} />

      <TimingsForm notify={notify} />
    </div>
  );
}

// ===== التحكم العام =====
function MasterControls({ cfg, vol, setVol, onChange }: {
  cfg: NotificationConfig; vol: number; setVol: (v: number) => void;
  onChange: (p: Partial<NotificationConfig>) => void;
}) {
  const [pending, startTransition] = useTransition();
  const commitVol = (v: number) => startTransition(async () => { await updateMasterAudio({ masterVolume: v }); onChange({ masterVolume: v }); });
  const toggleMute = () => startTransition(async () => { const m = !cfg.globalMute; await updateMasterAudio({ globalMute: m }); onChange({ globalMute: m }); });

  return (
    <section className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium text-foreground">
          {cfg.globalMute ? <VolumeX className="size-4 text-destructive" /> : <Volume2 className="size-4 text-gold" />}
          مستوى الصوت الرئيسي
        </span>
        <span className="text-xs text-muted-foreground">{vol}٪</span>
      </div>
      <input
        type="range" min={0} max={100} step={5} value={vol} disabled={cfg.globalMute || pending}
        onChange={(e) => setVol(Number(e.target.value))}
        onPointerUp={(e) => commitVol(Number((e.target as HTMLInputElement).value))}
        onKeyUp={(e) => commitVol(Number((e.target as HTMLInputElement).value))}
        className="w-full accent-[var(--gold)] disabled:opacity-50"
      />
      <button onClick={toggleMute} disabled={pending} className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${cfg.globalMute ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border text-muted-foreground hover:text-foreground"}`}>
        {cfg.globalMute ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
        {cfg.globalMute ? "الصوت مكتوم — اضغط للتفعيل" : "كتم الكل"}
      </button>
    </section>
  );
}

// ===== جدول الأحداث =====
function EventsTable({ cfg, setCfg, play, soundUrl }: {
  cfg: NotificationConfig;
  setCfg: React.Dispatch<React.SetStateAction<NotificationConfig | null>>;
  play: (url: string | undefined, eventVolume?: number) => void;
  soundUrl: (id: string | null) => string | undefined;
}) {
  const [, startTransition] = useTransition();

  // تحديث محلي فقط (للسحب الفوري بدون حفظ كل خطوة).
  function localPatch(eventKey: string, patch: Partial<NotifEvent>) {
    setCfg((c) => c && { ...c, events: c.events.map((e) => e.eventKey === eventKey ? { ...e, ...patch } : e) });
  }
  // تحديث محلي + حفظ على الخادم.
  function patchEvent(eventKey: string, patch: Partial<NotifEvent>) {
    localPatch(eventKey, patch);
    startTransition(async () => { await updateNotificationEvent(eventKey, patch); });
  }

  return (
    <section className="space-y-3">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><span className="h-4 w-1 rounded-full bg-gold" /> الأحداث</h3>
      <div className="space-y-2">
        {cfg.events.map((e) => (
          <div key={e.eventKey} className="space-y-3 rounded-xl border border-border p-3">
            <div className="font-medium text-foreground">{e.label}</div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {/* الصوت + النغمة + تجربة */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={e.soundEnabled} onChange={(ev) => patchEvent(e.eventKey, { soundEnabled: ev.target.checked })} className="size-4 accent-[var(--gold)]" />
                  صوت
                </label>
                <select
                  value={e.soundId ?? ""} disabled={!e.soundEnabled}
                  onChange={(ev) => patchEvent(e.eventKey, { soundId: ev.target.value || null })}
                  className="select-base flex-1 text-xs disabled:opacity-50"
                >
                  {cfg.sounds.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <button type="button" onClick={() => play(soundUrl(e.soundId), e.volume)} title="تجربة" className="rounded-lg border border-gold/40 p-2 text-gold hover:bg-gold/10">
                  <Play className="size-4" />
                </button>
              </div>
              {/* التوست + الجمهور */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input type="checkbox" checked={e.toastEnabled} onChange={(ev) => patchEvent(e.eventKey, { toastEnabled: ev.target.checked })} className="size-4 accent-[var(--gold)]" />
                  إشعار
                </label>
                <select value={e.audience} onChange={(ev) => patchEvent(e.eventKey, { audience: ev.target.value })} className="select-base flex-1 text-xs">
                  {AUDIENCE_OPTIONS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
                </select>
              </div>
            </div>
            {/* الصف الثاني: سلايدر مستوى صوت الحدث */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>مستوى صوت الحدث</span>
                <span>{e.volume}٪</span>
              </div>
              <input
                type="range" min={0} max={100} step={5} value={e.volume} disabled={!e.soundEnabled}
                onChange={(ev) => localPatch(e.eventKey, { volume: Number(ev.target.value) })}
                onPointerUp={(ev) => patchEvent(e.eventKey, { volume: Number((ev.target as HTMLInputElement).value) })}
                onKeyUp={(ev) => patchEvent(e.eventKey, { volume: Number((ev.target as HTMLInputElement).value) })}
                className="w-full accent-[var(--gold)] disabled:opacity-50"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ===== مكتبة النغمات =====
function SoundLibrary({ cfg, setCfg, play }: {
  cfg: NotificationConfig;
  setCfg: React.Dispatch<React.SetStateAction<NotificationConfig | null>>;
  play: (url: string | undefined) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  function upload(file: File) {
    setError(null);
    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("name", file.name.replace(/\.[^.]+$/, ""));
    fetch("/api/sounds/upload", { method: "POST", body: fd })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) { setError(data.error ?? "تعذّر الرفع"); return; }
        // أعد التحميل لإظهار النغمة الجديدة.
        const cfg2 = await fetchNotificationConfig();
        setCfg(cfg2);
      })
      .catch(() => setError("تعذّر الرفع"))
      .finally(() => { setUploading(false); if (fileRef.current) fileRef.current.value = ""; });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteSound(id);
      if (res.ok) setCfg((c) => c && { ...c, sounds: c.sounds.filter((s) => s.id !== id) });
      else setError(res.error ?? "تعذّر الحذف");
    });
  }

  return (
    <section className="space-y-3 border-t border-border/60 pt-5">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><Volume2 className="size-4 text-gold" /> مكتبة النغمات</h3>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-gold/40 px-3 py-1.5 text-xs font-medium text-gold hover:bg-gold/10">
          {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} رفع نغمة جديدة
          <input ref={fileRef} type="file" accept=".mp3,.wav,audio/*" className="hidden" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
        </label>
      </div>
      {error && <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {cfg.sounds.map((s: NotifSound) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
            <button type="button" onClick={() => play(s.fileUrl)} title="معاينة" className="rounded-lg p-1.5 text-gold hover:bg-gold/10"><Play className="size-4" /></button>
            <span className="flex-1 text-sm text-foreground">{s.name}</span>
            {s.isBuiltIn ? (
              <span className="rounded-full bg-secondary px-1.5 py-0.5 text-[0.65rem] text-muted-foreground">مدمجة</span>
            ) : (
              <button type="button" onClick={() => remove(s.id)} disabled={pending} title="حذف" className="rounded-lg p-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"><Trash2 className="size-4" /></button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

// ===== توقيتات التنبيهات (موجودة سابقًا) =====
function TimingsForm({ notify }: { notify: { followupBeforeHours: number; staleHours: number } }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMsg(null);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const res = await updateNotifyConfig(fd);
      setMsg(res.ok ? "تم الحفظ" : res.error ?? "صار خطأ");
    });
  }

  return (
    <form onSubmit={save} className="space-y-3 border-t border-border/60 pt-5">
      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground"><span className="h-4 w-1 rounded-full bg-gold" /> توقيتات التنبيهات</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">تنبيه قبل موعد المتابعة (ساعات)</span>
          <input name="followupBeforeHours" inputMode="numeric" dir="ltr" defaultValue={notify.followupBeforeHours} className="select-base" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs text-muted-foreground">تنبيه ركود الموظف بعد (ساعات)</span>
          <input name="staleHours" inputMode="numeric" dir="ltr" defaultValue={notify.staleHours} className="select-base" />
        </label>
      </div>
      <p className="text-xs text-muted-foreground/70">التنبيهات الزمنية (المتابعة/الركود) تُشغّل عبر cron — راجع التوثيق.</p>
      {msg && <p className="rounded-lg bg-success/10 px-3 py-2 text-sm text-success">{msg}</p>}
      <button type="submit" disabled={pending} className="rounded-xl border border-gold/40 px-5 py-2.5 text-sm font-semibold text-gold hover:bg-gold/10 disabled:opacity-50">{pending ? "جارٍ…" : "حفظ التوقيتات"}</button>
    </form>
  );
}
