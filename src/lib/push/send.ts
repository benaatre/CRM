import "server-only";

import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { categoryFor, FALLBACK_CHANNEL, type PushCategory } from "@/lib/push/channels";
import { getChannelConfigCached, type ChannelConfig } from "@/lib/data/push-channels";

/**
 * إرسال إشعارات Push النيتف عبر FCM HTTP v1.
 *
 * لماذا HTTP v1 وليس legacy: واجهة legacy (fcm/send بمفتاح خادم) أُوقفت من جوجل،
 * وv1 توقّع كل طلب بـOAuth من حساب خدمة — نفس آلية google-sheets.ts في هذا الريبو.
 *
 * الاعتماد كله من البيئة: FCM_SERVICE_ACCOUNT_KEY (لا قيمة سرّية في الكود ولا في
 * الريبو). غياب المفتاح = الميزة مطفأة بصمت — لا يكسر أي مسار قائم.
 */

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

type ServiceAccount = { client_email: string; private_key: string; project_id?: string };

/** يحمّل حساب الخدمة من FCM_SERVICE_ACCOUNT_KEY (base64 أو JSON خام) — نفس نمط google-sheets.ts. */
function loadCredentials(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_KEY;
  if (!raw) return null;
  let json = raw.trim();
  if (!json.startsWith("{")) json = Buffer.from(json, "base64").toString("utf8");
  try {
    const c = JSON.parse(json) as ServiceAccount;
    if (!c.client_email || !c.private_key) return null;
    return c;
  } catch {
    return null;
  }
}

/** الميزة مفعّلة؟ (مفتاح صريح + اعتماد موجود). PUSH_ENABLED=off يطفئها حتى لو الاعتماد موجود. */
function pushConfig(): { projectId: string; creds: ServiceAccount } | null {
  if ((process.env.PUSH_ENABLED ?? "on").toLowerCase() === "off") return null;
  const creds = loadCredentials();
  if (!creds) return null;
  const projectId = process.env.FCM_PROJECT_ID || creds.project_id;
  if (!projectId) return null;
  return { projectId, creds };
}

// توكن OAuth مُخبّأ — صالح ساعة، نجدّده قبل انتهائه بدقيقة.
let tokenCache: { value: string; expiresAt: number } | null = null;

async function accessToken(creds: ServiceAccount): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  const jwt = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [FCM_SCOPE],
  });
  const res = await jwt.authorize();
  if (!res.access_token) throw new Error("FCM: تعذّر الحصول على access_token");
  tokenCache = {
    value: res.access_token,
    expiresAt: (res.expiry_date ?? Date.now() + 3_600_000) - 60_000,
  };
  return res.access_token;
}

export type PushPayload = {
  eventKey: string;
  title: string;
  body?: string | null;
  link?: string | null;
  /**
   * تجاوز فئة الحدث. لازم لـfollowup_due: يُطلق بمفتاح واحد لحالتين
   * (مستحقة = عادي، فات موعدها = عاجل) فلا يميّزهما المفتاح وحده.
   */
  category?: PushCategory | null;
};

/**
 * يرسل لتوكن واحد. يرجّع "ok" | "drop" (توكن ميت يُحذف) | "retry" (عطل مؤقت).
 *
 * نستخدم حمولة notification (لا data-only): مع data-only لا يظهر شي والتطبيق
 * مقفول/مقتول — النظام نفسه هو من يعرض إشعار notification، وهذا شرط وصوله
 * لشاشة القفل. priority=high + PRIORITY_MAX يخترقان وضع Doze.
 */
async function sendOne(
  projectId: string,
  token: string,
  bearer: string,
  p: PushPayload,
  channel: ChannelConfig,
): Promise<"ok" | "drop" | "retry"> {
  const urgent = channel.category === "urgent";
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: p.title, ...(p.body ? { body: p.body } : {}) },
        android: {
          // «معلومات» لا تستحق إيقاظ الجهاز من Doze — normal يوفّر البطارية.
          priority: channel.category === "info" ? "normal" : "high",
          notification: {
            channel_id: channel.channelId,
            notification_priority: urgent ? "PRIORITY_MAX" : "PRIORITY_DEFAULT",
            // اسم المورد بلا امتداد — لأجهزة ما قبل أندرويد ٨ حيث لا قنوات
            // أصلًا فالصوت يجي من الحمولة. على ٨ فما فوق صوت القناة هو الحاكم.
            sound: channel.sound.replace(/\.wav$/, ""),
            default_vibrate_timings: channel.vibration,
          },
        },
        // قيم data لازم تكون نصوصًا — يقرأها العميل ليفتح الرابط عند الضغط.
        data: {
          eventKey: p.eventKey,
          category: channel.category,
          ...(p.link ? { link: p.link } : {}),
        },
      },
    }),
  });

  if (res.ok) return "ok";

  // 404 UNREGISTERED / NOT_FOUND = التطبيق أُزيل أو التوكن تجدّد → احذفه.
  // 400 INVALID_ARGUMENT على حقل التوكن = توكن تالف → احذفه كذلك.
  const text = await res.text().catch(() => "");
  if (res.status === 404) return "drop";
  if (res.status === 400 && /UNREGISTERED|NOT_FOUND|INVALID_ARGUMENT/i.test(text)) return "drop";
  if (res.status === 403) {
    console.error("[push] FCM رفض الوصول (403) — تأكد أن حساب الخدمة يملك دور Firebase Messaging API Admin");
    return "retry";
  }
  console.error(`[push] FCM ${res.status}: ${text.slice(0, 300)}`);
  return "retry";
}

/**
 * يرسل إشعارًا نيتف لكل أجهزة المستخدمين المذكورين.
 *
 * صامت تمامًا عند غياب الإعداد أو فشل الإرسال — الاستدعاء من notify() بنمط
 * best-effort، فما يصح أن يُفشِل إنشاء الإشعار في القاعدة ولا العملية الأصلية.
 * يرجّع عدد الرسائل التي سُلّمت لـFCM (للتسجيل/الاختبار).
 */
export async function sendPush(userIds: string[], p: PushPayload): Promise<number> {
  const cfg = pushConfig();
  if (!cfg || userIds.length === 0) return 0;

  // نقرأ التوكنات بالعميل الأساسي لا بعميل المعاملة: الإرسال يقع خارج أي transaction.
  const rows = await prisma.deviceToken.findMany({
    where: { userId: { in: userIds } },
    select: { token: true },
  });
  if (rows.length === 0) return 0;

  // فئة الحدث → قناتها الحالية (بنغمة المالك). لو تعذّر الإعداد لأي سبب،
  // نرسل على قناة الاحتياط الدائمة بدل إسقاط الإشعار.
  const category = categoryFor(p.eventKey, p.category);
  const channels = await getChannelConfigCached().catch(() => []);
  const channel: ChannelConfig = channels.find((c) => c.category === category) ?? {
    category, channelId: FALLBACK_CHANNEL, label: "", description: "",
    importance: 5, vibration: true, sound: "notif_soft.wav", soundId: null,
    soundUrl: "/sounds/soft.wav",
  };

  const bearer = await accessToken(cfg.creds);
  const dead: string[] = [];
  let sent = 0;

  // فرق صغيرة (٨ بالتوازي) — الفريق أجهزته بالعشرات لا الآلاف، وFCM v1 بلا multicast.
  const BATCH = 8;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const results = await Promise.all(
      slice.map((r) =>
        sendOne(cfg.projectId, r.token, bearer, p, channel)
          .then((out) => ({ token: r.token, out }))
          .catch(() => ({ token: r.token, out: "retry" as const })),
      ),
    );
    for (const { token, out } of results) {
      if (out === "ok") sent++;
      else if (out === "drop") dead.push(token);
    }
  }

  // تنظيف تلقائي — التوكنات الميتة تُحذف فورًا فلا تتراكم.
  if (dead.length > 0) {
    await prisma.deviceToken
      .deleteMany({ where: { token: { in: dead } } })
      .catch((e) => console.error("[push] فشل تنظيف التوكنات الميتة", e));
  }

  return sent;
}
