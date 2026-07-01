import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

const MAX_SIZE = 1024 * 1024; // ١ ميجابايت
const ALLOWED_EXT = ["mp3", "wav"];

// POST /api/sounds/upload — رفع نغمة (mp3/wav) وتخزينها كـ data URL في قاعدة البيانات.
// صلاحية المالك/المدير فقط.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "غير مصرّح" }, { status: 401 });
  if (session.user.role !== "OWNER" && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "الرفع للمالك أو المدير فقط" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "طلب غير صالح" }, { status: 400 });
  }

  const file = form.get("file");
  const nameRaw = String(form.get("name") ?? "").trim();
  if (!file || typeof file === "string" || !("arrayBuffer" in file)) {
    return NextResponse.json({ error: "ما فيه ملف" }, { status: 400 });
  }
  const f = file as File;

  const ext = (f.name.split(".").pop() ?? "").toLowerCase();
  const isAudio = f.type.startsWith("audio/") || ALLOWED_EXT.includes(ext);
  if (!isAudio || !ALLOWED_EXT.includes(ext)) {
    return NextResponse.json({ error: "الصيغة لازم MP3 أو WAV" }, { status: 400 });
  }
  if (f.size === 0) return NextResponse.json({ error: "الملف فاضي" }, { status: 400 });
  if (f.size > MAX_SIZE) return NextResponse.json({ error: "حجم الملف لازم أقل من ١ ميجابايت" }, { status: 400 });

  const mime = ext === "mp3" ? "audio/mpeg" : "audio/wav";
  const b64 = Buffer.from(await f.arrayBuffer()).toString("base64");
  const dataUrl = `data:${mime};base64,${b64}`;
  const name = nameRaw || f.name.replace(/\.[^.]+$/, "") || "نغمة مرفوعة";

  const sound = await prisma.soundAsset.create({
    data: { name, fileUrl: dataUrl, isBuiltIn: false },
    select: { id: true, name: true, isBuiltIn: true },
  });

  revalidatePath("/settings");
  return NextResponse.json({ ok: true, sound });
}
