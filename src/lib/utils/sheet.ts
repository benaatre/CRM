// أدوات جوجل شيت — آمنة للاستيراد في الخادم والعميل (بدون "use server").

/** يستخرج معرّف الشيت من رابط جوجل شيت — null لو الرابط غير صالح. */
export function extractSheetId(url: string): string | null {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/) || url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : null;
}
