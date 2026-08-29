/** أنواع حزمة ملف الموظف — نقية (بلا أي استيراد خادمي) ليشاركها الخادم والعميل. */

export type EFStripSeg = { a: number; b: number; cls: "conf" | "unc" };
export type EFStripMark = { pct: number; color: string; label: string };
export type EFEvent = { t: string; c: string; b: string; s: string };

export type EFDayCard = {
  key: string;
  bigHM: string;
  metaTop: string; // «من ٩:٠٠ س · مقفول ٤:٢٥ م»
  state: { cls: "" | "ok" | "bad" | "leave"; text: string; lock: boolean };
  window: { a: number; b: number } | null;
  segs: EFStripSeg[];
  marks: EFStripMark[];
  events: EFEvent[];
};

export type EFLogDay = {
  key: string;
  dayNum: string; // «١٧ أغسطس»
  dayName: string;
  status: "full" | "part" | "abs" | "wk" | "fut" | "leave" | "open" | "off";
  io: string | null; // «١٢:١١ م → ٤:٢٥ م»
  hoursHM: string | null;
  confPct: number; // عرض شريط المؤكد ٪ من الهدف
  uncPct: number;
  locked: boolean;
  leaveTag: boolean;
};

export type EFLeaveReq = {
  id: string;
  typeLabel: string;
  fromKey: string;
  toKey: string;
  days: number;
  rangeText: string; // «٢٣–٢٥ أغسطس»
  createdText: string;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | string;
};

export type EFInsight = { tag: "g" | "a" | "b"; title: string; sub: string };

export type EFRepairSession = {
  id: string;
  dayKey: string;
  startedText: string;
  startedLocal: string;
  endedText: string | null;
  endedLocal: string | null;
  workedMinutes: number | null;
  open: boolean;
  autoClosed: boolean;
  closedBy: string | null;
  voided: boolean;
  lastAliveLocal: string | null;
  lastAliveText: string | null;
};

export type EFBundle = {
  user: { id: string; name: string; role: string; active: boolean; online: boolean };
  period: "w" | "m" | "q";
  view: "week" | "month" | "range";
  month: string;
  rangeFrom: string | null;
  rangeTo: string | null;
  monthOptions: { value: string; label: string; current: boolean }[];
  schedule: { startMinutes: number; shiftMinutes: number; startWindowEndMinutes: number | null; isDefault: boolean };
  /** الإعدادات الفعلية المدموجة (ملف الموظف الحي) — كلها قابلة للحفظ الحقيقي. */
  config: {
    mode: "STRICT" | "WATCH_ONLY" | "EXEMPT";
    exemptUntilKey: string | null;
    exemptReason: string | null;
    verificationPerDay: number;
    weekendDays: string;
    outZoneCallEnabled: boolean;
    dayLockEnabled: boolean;
    notifyMissedCall: boolean;
    watchFromMinutes: number;
    watchToMinutes: number;
    watchAlertFirstSeen: boolean;
    lateThresholdMinutes: number;
    gapCallEnabled: boolean;
    punchReminderEnabled: boolean;
    quietMode: boolean;
    custom: {
      verificationPerDay: boolean;
      weekendDays: boolean;
      outZoneCallEnabled: boolean;
      dayLockEnabled: boolean;
      notifyMissedCall: boolean;
      lateThresholdMinutes: boolean;
      gapCallEnabled: boolean;
      punchReminderEnabled: boolean;
    };
  };
  globalView: {
    verificationPerDay: number;
    verificationEnabled: boolean;
    weekendDays: string;
    maxOutOfZoneMinutes: number;
    lateThresholdMinutes: number;
    heartbeatSeconds: number;
  };
  todayLocked: boolean;
  radar: { state: "present" | "out" | "weak" | "gap" | "off"; locationName: string | null };
  deviceLine: string;
  today: EFDayCard | null;
  yesterday: EFDayCard | null;
  todayEvents: EFEvent[];
  attKpis: {
    workDays: number;
    confirmedHM: string;
    unconfHM: string;
    leaveDays: number;
    absentDays: number;
    compliancePct: number | null;
    confirmPct: number | null;
  };
  histogram: number[]; // ٧ سلال ٨ص→٢م
  histPeakLabel: string | null;
  crm: {
    followups: number;
    activeLeads: number;
    visits: number;
    bookings: number;
    apptPct: number | null;
    firstRespHM: string | null;
  };
  fus14: { key: string; dayNum: string; count: number; off: boolean }[];
  stages: { key: string; label: string; count: number }[];
  merge: {
    perHour: string | null;
    teamPerHour: string | null;
    above: boolean | null;
    diffPct: number | null;
    avgFull: number | null;
    avgPartial: number | null;
    avgAbsent: number | null;
    insights: EFInsight[];
  };
  logDays: EFLogDay[];
  logLabel: string;
  openSession: { id: string; lastProofText: string | null; lastProofLocal: string | null } | null;
  repairSessions: EFRepairSession[];
  leaves: {
    pending: EFLeaveReq[];
    decided: EFLeaveReq[];
    balance: { entitledDays: number; usedDays: number; remainingDays: number };
  };
  zones: { id: string; name: string; active: boolean }[];
  /** تنقّل جانبي بين ملفات الفريق (الجزء ٣) — بالترتيب الأبجدي. */
  teamNav: { id: string; name: string }[];
};
