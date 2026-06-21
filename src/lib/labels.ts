import { Role } from "@prisma/client";

// تسميات عربية للأدوار وغيرها — مكان واحد للنصوص المتكررة.
export const roleLabels: Record<Role, string> = {
  OWNER: "المالك",
  ADMIN: "مدير",
  EMPLOYEE: "موظف مبيعات",
};

export function roleLabel(role: Role): string {
  return roleLabels[role] ?? role;
}
