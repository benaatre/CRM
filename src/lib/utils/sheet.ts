// أدوات جوجل شيت — آمنة للاستيراد في الخادم والعميل (بدون "use server").

/** يستخرج معرّف الشيت من رابط جوجل شيت — null لو الرابط غير صالح. */
export function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

/**
 * يستخرج رقم الورقة (gid) من الرابط — يدعم ‎#gid=‎ و‎&gid=‎ و‎?gid=‎.
 * null = الرابط لا يحدد ورقة (⚠️ حادثة 2026-07-25: القراءة بلا gid تسقط على
 * الورقة الأولى/المستند كله — لذلك صار الـgid إلزاميًا في المزامنة).
 */
export function extractGid(url: string): number | null {
  const m = url.match(/[#?&]gid=(\d+)/);
  return m ? Number(m[1]) : null;
}

/** يثبّت gid على الرابط (يزيل أي gid قديم ويضيف ‎#gid=N‎) — لتخزين رابط محدد الورقة دائمًا. */
export function withGid(url: string, gid: number): string {
  const base = url.replace(/[#?&]gid=\d+/g, "").replace(/#$/, "");
  return `${base}#gid=${gid}`;
}
