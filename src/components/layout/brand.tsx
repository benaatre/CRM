/**
 * شعار الشركة — صورة اللوجو إن وُجدت، وإلا الاسم النصّي (Reem Kufi).
 * مكوّن تقديمي بدون hooks → يصلح للخادم والعميل.
 */
export function Brand({
  companyName,
  logoUrl,
  textClassName = "text-lg",
  imgClassName = "h-8 w-auto",
}: {
  companyName: string;
  logoUrl?: string | null;
  textClassName?: string;
  imgClassName?: string;
}) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={companyName} className={`${imgClassName} object-contain`} />;
  }
  return <span className={`font-logo font-bold text-gold ${textClassName}`}>{companyName}</span>;
}
