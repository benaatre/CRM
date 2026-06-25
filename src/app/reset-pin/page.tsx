import { getSettings } from "@/lib/data/settings";
import { Brand } from "@/components/layout/brand";
import { ResetPinForm } from "./reset-pin-form";

export const dynamic = "force-dynamic";

export default async function ResetPinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  let companyName = "مشاريع السلطان";
  let logoUrl: string | null = null;
  try {
    const s = await getSettings();
    companyName = s.companyName;
    logoUrl = s.logoUrl;
  } catch {}

  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <Brand companyName={companyName} logoUrl={logoUrl} textClassName="text-3xl" imgClassName="h-14 w-auto" />
          <p className="mt-2 text-sm text-muted-foreground">تعيين رمز الدخول الخاص بك</p>
        </div>
        <div className="glass rounded-2xl p-6 shadow-xl">
          {token ? (
            <ResetPinForm token={token} />
          ) : (
            <p className="rounded-lg bg-destructive/10 px-3 py-4 text-center text-sm text-destructive">
              رابط غير صالح — تأكد من فتح الرابط الكامل من الإيميل.
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
