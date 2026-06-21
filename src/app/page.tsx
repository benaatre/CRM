import { redirect } from "next/navigation";

// الجذر يحوّل للوحة — والـ middleware يتكفّل بالتحقق من الدخول.
export default function RootPage() {
  redirect("/dashboard");
}
