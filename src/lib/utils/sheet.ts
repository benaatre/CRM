// أدوات جوجل شيت — آمنة للاستيراد في الخادم والعميل (بدون "use server").

/** يستخرج معرّف الشيت من رابط جوجل شيت — null لو الرابط غير صالح. */
export function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}

/**
 * يستخرج رقم الورقة (gid) من الرابط — يدعم ‎#gid=‎ و‎&gid=‎ و‎?gid=‎.
 * ‏#gid= له الأولوية: الرابط الملصوق من المتصفح كثيرًا يحمل ‎?gid=‎ قديمًا (الورقة
 * السابقة/الافتراضية) بينما ‎#gid=‎ هو الورقة المفتوحة فعلًا — الالتقاط بأول تطابق
 * كان يعتمد القديم ويطيح على الورقة الغلط.
 * null = الرابط لا يحدد ورقة (⚠️ حادثة 2026-07-25: القراءة بلا gid تسقط على
 * الورقة الأولى/المستند كله — لذلك صار الـgid إلزاميًا في المزامنة).
 */
export function extractGid(url: string): number | null {
  const frag = url.match(/#gid=(\d+)/);
  if (frag) return Number(frag[1]);
  const query = url.match(/[?&]gid=(\d+)/);
  return query ? Number(query[1]) : null;
}

/** يثبّت gid على الرابط (يزيل أي gid قديم ويضيف ‎#gid=N‎) — لتخزين رابط محدد الورقة دائمًا. */
export function withGid(url: string, gid: number): string {
  const base = url.replace(/[#?&]gid=\d+/g, "").replace(/#$/, "");
  return `${base}#gid=${gid}`;
}
