package com.benaatre.sultan;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * قنوات الإشعارات — لازم تُنشأ هنا بنفس المعرّفات المستخدمة في الخادم
     * (src/lib/push/send.ts). على أندرويد ٨ (API 26) فما فوق، أي إشعار يصل
     * بمعرّف قناة غير موجودة يُسقَط بصمت ولا يظهر إطلاقًا.
     *
     * IMPORTANCE_HIGH = تنبيه منبثق + صوت + ظهور على شاشة القفل، وهو المطلوب
     * لتنبيه الموظف والتطبيق مقفول.
     *
     * ملاحظة: خصائص القناة (الصوت/الاهتزاز/الأهمية) تُثبَّت عند أول إنشاء ولا
     * يمكن تعديلها بالكود بعدها — تغييرها لاحقًا يحتاج معرّف قناة جديدًا.
     */
    private static final String CHANNEL_DEFAULT = "sultan_alerts";
    private static final String CHANNEL_URGENT = "sultan_urgent";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannels();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return; // ما قبل أندرويد ٨: لا قنوات أصلًا

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel alerts = new NotificationChannel(
            CHANNEL_DEFAULT,
            "تنبيهات النظام",
            NotificationManager.IMPORTANCE_HIGH
        );
        alerts.setDescription("عملاء جدد، متابعات مستحقة، مواعيد زيارات، وحجوزات");
        alerts.enableVibration(true);
        alerts.setShowBadge(true);
        // PRIVATE: العنوان يظهر على شاشة القفل والتفاصيل تُخفى لو الجهاز مقفل بنمط آمن
        // — أسماء العملاء ما تنكشف لمن يمسك الجوال.
        alerts.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);

        NotificationChannel urgent = new NotificationChannel(
            CHANNEL_URGENT,
            "تنبيهات عاجلة",
            NotificationManager.IMPORTANCE_HIGH
        );
        urgent.setDescription("إنذار قبل سحب عميل، وانتقال عميل منك");
        urgent.enableVibration(true);
        urgent.setVibrationPattern(new long[] { 0, 400, 200, 400 }); // نبض مزدوج يميّزها
        urgent.setShowBadge(true);
        urgent.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);

        manager.createNotificationChannel(alerts);
        manager.createNotificationChannel(urgent);
    }
}
