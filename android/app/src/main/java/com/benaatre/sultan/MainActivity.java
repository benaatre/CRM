package com.benaatre.sultan;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * قناة الاحتياط الدائمة — شبكة أمان لا أكثر.
     *
     * قنوات الفئات الثلاث (عاجل/عادي/معلومات) تُنشأ من الويب عند إقلاع التطبيق
     * (components/mobile/push-registrar.tsx) لأن نغمة كل فئة يختارها المالك من
     * الخادم، ولا يعرفها كود نيتف مبنيّ مسبقًا.
     *
     * فائدة هذه القناة: أندرويد ٨ فما فوق يُسقط بصمت أي إشعار يصل بمعرّف قناة
     * غير موجودة. لو غيّر المالك النغمة ووصل إشعار قبل أن يفتح الموظف التطبيق
     * (فتُنشأ القناة الجديدة)، يعرضه أندرويد على هذه بدل أن يضيع — لأنها
     * مسجّلة في المانيفست كـdefault_notification_channel_id.
     *
     * معرّفها ثابت ولا يحمل نغمة مخصّصة، فلا يلزمها إعادة إنشاء أبدًا.
     */
    private static final String FALLBACK_CHANNEL = "sultan_fallback";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createFallbackChannel();
    }

    private void createFallbackChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return; // ما قبل أندرويد ٨: لا قنوات أصلًا

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel fallback = new NotificationChannel(
            FALLBACK_CHANNEL,
            "تنبيهات مشاريع السلطان",
            NotificationManager.IMPORTANCE_HIGH
        );
        fallback.setDescription("تنبيهات النظام — تُستخدم لحين تحديث نغمات التنبيهات");
        fallback.enableVibration(true);
        fallback.setShowBadge(true);
        // PRIVATE: العنوان يظهر على شاشة القفل والتفاصيل تُخفى لو الجهاز مقفل
        // بنمط آمن — أسماء العملاء ما تنكشف لمن يمسك الجوال.
        fallback.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);

        manager.createNotificationChannel(fallback);
    }
}
