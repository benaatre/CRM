// عميل Google Sheets API (قراءة فقط) عبر حساب خدمة. خادمي فقط — يُستدعى من نقاط المزامنة.
import { google, type sheets_v4 } from "googleapis";

let cached: sheets_v4.Sheets | null = null;

/** يحمّل بيانات حساب الخدمة من GOOGLE_SERVICE_ACCOUNT_KEY (base64 أو JSON خام). */
function loadCredentials(): { client_email: string; private_key: string } {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY غير مضبوط في البيئة");
  let json = raw.trim();
  if (!json.startsWith("{")) json = Buffer.from(json, "base64").toString("utf8"); // فكّ base64
  let c: { client_email?: string; private_key?: string };
  try {
    c = JSON.parse(json);
  } catch {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY غير صالح (لا JSON ولا base64 سليم)");
  }
  if (!c.client_email || !c.private_key) throw new Error("مفتاح حساب الخدمة ناقص client_email/private_key");
  return { client_email: c.client_email, private_key: c.private_key };
}

function client(): sheets_v4.Sheets {
  if (cached) return cached;
  const { client_email, private_key } = loadCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials: { client_email, private_key },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  cached = google.sheets({ version: "v4", auth });
  return cached;
}

export type SheetTab = { title: string; gid: number; rowCount: number };

/** يسرد تبويبات الشيت (العنوان + gid + عدد الصفوف) — لاختيار التبويب الصحيح. */
export async function listSheetTabs(spreadsheetId: string): Promise<SheetTab[]> {
  const sheets = client();
  const res = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets(properties(sheetId,title,gridProperties(rowCount)))",
  });
  return (res.data.sheets ?? []).map((s) => ({
    title: s.properties?.title ?? "",
    gid: s.properties?.sheetId ?? 0,
    rowCount: s.properties?.gridProperties?.rowCount ?? 0,
  }));
}

/**
 * يقرأ قيم تبويب من الشيت (خام، نصوص). بدون tab يقرأ التبويب الأول.
 * يرمي خطأً واضحًا لو الشيت غير مشارك مع حساب الخدمة أو غير موجود.
 */
export async function readSheetValues(sheetId: string, opts?: { tab?: string; gid?: number; endRow?: number }): Promise<string[][]> {
  const sheets = client();
  let tabTitle = opts?.tab;
  // لو أُعطي gid فقط، حوّله لعنوان التبويب.
  if (!tabTitle && opts?.gid != null) {
    const tabs = await listSheetTabs(sheetId);
    tabTitle = tabs.find((t) => t.gid === opts.gid)?.title;
  }
  const endRow = opts?.endRow && opts.endRow > 0 ? opts.endRow : 10000; // حدّ أعلى للصفوف (يقرأ من الأعلى دائمًا)
  const a1 = `A1:Z${endRow}`;
  const range = tabTitle ? `'${tabTitle.replace(/'/g, "''")}'!${a1}` : a1;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range });
  return (res.data.values ?? []).map((r) => r.map((cell) => (cell == null ? "" : String(cell))));
}
