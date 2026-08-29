import Foundation
import CoreLocation
import Capacitor

/**
 * SultanGeo — بلجن الموقع المحلي (Build 5).
 *
 * لماذا بلجن خاص بدل @capacitor/geolocation: علّة البلجن الرسمي موثّقة
 * (Issue #2023) — يستدعي CLLocationManager من خيط خلفي، وفي حالة
 * `notDetermined` يحفظ النداء ثم يسقط على `default: break` بلا حسم ولا رفض،
 * فيبقى الوعد معلّقًا للأبد (الصمت المطلق T20).
 *
 * قواعد هذا البلجن الثلاث، بلا استثناء:
 * ١. `CLLocationManager` يُنشأ ويُستدعى على **الخيط الرئيسي** حصرًا — كل مدخل
 *    عام يقفز عبر `onMain` قبل أن يلمس المدير أو حالته، فلا سباق ولا قفل.
 * ٢. **الحسم إلزامي بكل مسار**: كل نداء إما يُردّ فورًا (حالة محسومة)، أو
 *    يُحفظ ويُحسم في مفوّض CoreLocation، أو ترفضه مهلة الأمان. لا مخرج صامت.
 * ٣. مهلة أمان ٢٠ث مسلّحة على كل نداء مؤجَّل — تنتزع النداء من طابوره وترفضه.
 *
 * الرد بنفس شكل @capacitor/geolocation حرفيًا (coords.latitude/longitude/
 * accuracy + timestamp) فطبقة JS تستهلكه بلا أي تفريع.
 */
@objc(SultanGeoPlugin)
public class SultanGeoPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "SultanGeoPlugin"
    public let jsName = "SultanGeo"
    public let pluginMethods: [CAPPluginMethod] = [
        .init(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        .init(name: "requestPermissions", returnType: CAPPluginReturnPromise),
        .init(name: "getCurrentPosition", returnType: CAPPluginReturnPromise)
    ]

    /// مهلة الأمان لكل نداء مؤجَّل — بعدها رفض صريح، لا تعليق.
    private static let callTimeout: TimeInterval = 20

    // كل ما تحت هذا السطر يُقرأ ويُكتب على الخيط الرئيسي حصرًا.
    private var manager: CLLocationManager?
    private var permissionCalls: [CAPPluginCall] = []
    private var locationCalls: [CAPPluginCall] = []

    // MARK: - الخيط الرئيسي

    /// كل مدخل عام يمرّ من هنا — القاعدة ١ بلا استثناء.
    private func onMain(_ work: @escaping () -> Void) {
        DispatchQueue.main.async(execute: work)
    }

    /// المدير يُنشأ كسولًا وعلى الرئيسي فقط — إنشاؤه على خيط بلا run loop
    /// يمنع وصول رسائل المفوّض أصلًا (جذر العلّة في البلجن الرسمي).
    private func mainManager() -> CLLocationManager {
        if let existing = manager { return existing }
        let created = CLLocationManager()
        created.delegate = self
        created.desiredAccuracy = kCLLocationAccuracyBest
        manager = created
        return created
    }

    // MARK: - الدوال المكشوفة للجسر

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self else { return call.reject("البلجن غير محمّل", "UNAVAILABLE") }
            call.resolve(Self.permissionResult(self.mainManager().authorizationStatus))
        }
    }

    @objc override public func requestPermissions(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self else { return call.reject("البلجن غير محمّل", "UNAVAILABLE") }
            let manager = self.mainManager()
            let status = manager.authorizationStatus
            guard status == .notDetermined else {
                // حالة محسومة سلفًا — رد فوري بلا حوار ولا انتظار.
                return call.resolve(Self.permissionResult(status))
            }
            self.permissionCalls.append(call)
            self.arm(call, kind: .permission)
            // الحوار الرسمي — يُحسم في locationManagerDidChangeAuthorization بكل الحالات.
            manager.requestWhenInUseAuthorization()
        }
    }

    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        onMain { [weak self] in
            guard let self else { return call.reject("البلجن غير محمّل", "UNAVAILABLE") }
            let manager = self.mainManager()
            manager.desiredAccuracy = call.getBool("enableHighAccuracy", true)
                ? kCLLocationAccuracyBest
                : kCLLocationAccuracyHundredMeters

            switch manager.authorizationStatus {
            case .denied, .restricted:
                // رفض قائم — نصنّف السبب (إذن مرفوض أم خدمات معطّلة) ثم نرفض.
                Self.classifyDenied { code, message in call.reject(message, code) }

            case .notDetermined:
                // لا نطلب موقعًا قبل حسم الإذن — نطلب الإذن، ووصول الحكم يُطلق القراءة.
                self.locationCalls.append(call)
                self.arm(call, kind: .location)
                manager.requestWhenInUseAuthorization()

            case .authorizedAlways, .authorizedWhenInUse:
                self.locationCalls.append(call)
                self.arm(call, kind: .location)
                manager.requestLocation()

            @unknown default:
                self.locationCalls.append(call)
                self.arm(call, kind: .location)
                manager.requestLocation()
            }
        }
    }

    // MARK: - مفوّض CoreLocation (يصل على الرئيسي — المدير أُنشئ عليه)

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        // ما زال معلّقًا: الحوار معروض ولم يُلمس — مهلة الأمان هي الحارس.
        guard status != .notDetermined else { return }

        settlePermissionCalls(status)
        guard !locationCalls.isEmpty else { return }

        switch status {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.requestLocation()
        case .denied, .restricted:
            Self.classifyDenied { [weak self] code, message in
                self?.failLocationCalls(message: message, code: code)
            }
        default:
            break
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        let calls = locationCalls
        locationCalls = []
        let payload = Self.positionPayload(location)
        for call in calls {
            call.resolve(payload)
            bridge?.releaseCall(call)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // التصنيف: رفض إذن · خدمات معطّلة · فشل قراءة.
        if let clError = error as? CLError, clError.code == .denied {
            Self.classifyDenied { [weak self] code, message in
                self?.failLocationCalls(message: message, code: code)
            }
            return
        }
        failLocationCalls(message: "تعذّر تحديد الموقع: \(error.localizedDescription)", code: "POSITION_UNAVAILABLE")
    }

    // MARK: - حسم النداءات

    private enum CallKind {
        case permission
        case location
    }

    /// يحفظ النداء ويسلّح مهلته — القاعدة ٣.
    private func arm(_ call: CAPPluginCall, kind: CallKind) {
        bridge?.saveCall(call)
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.callTimeout) { [weak self] in
            guard let self, self.take(call, kind: kind) else { return }
            call.reject("انتهت مهلة الموقع (٢٠ث) بلا رد من النظام", "TIMEOUT")
            self.bridge?.releaseCall(call)
        }
    }

    /// ينتزع النداء من طابوره — `true` إن كان ما زال معلّقًا (فالحسم لنا).
    private func take(_ call: CAPPluginCall, kind: CallKind) -> Bool {
        switch kind {
        case .permission:
            guard let index = permissionCalls.firstIndex(where: { $0.callbackId == call.callbackId }) else { return false }
            permissionCalls.remove(at: index)
        case .location:
            guard let index = locationCalls.firstIndex(where: { $0.callbackId == call.callbackId }) else { return false }
            locationCalls.remove(at: index)
        }
        return true
    }

    private func settlePermissionCalls(_ status: CLAuthorizationStatus) {
        let calls = permissionCalls
        permissionCalls = []
        let result = Self.permissionResult(status)
        for call in calls {
            call.resolve(result)
            bridge?.releaseCall(call)
        }
    }

    private func failLocationCalls(message: String, code: String) {
        let calls = locationCalls
        locationCalls = []
        for call in calls {
            call.reject(message, code)
            bridge?.releaseCall(call)
        }
    }

    // MARK: - أدوات

    private static func permissionResult(_ status: CLAuthorizationStatus) -> PluginCallResultData {
        let value: String
        switch status {
        case .authorizedAlways, .authorizedWhenInUse: value = "granted"
        case .denied, .restricted: value = "denied"
        default: value = "prompt"
        }
        return ["location": value, "coarseLocation": value]
    }

    /**
     * يفرّق «الإذن مرفوض» عن «خدمات الموقع معطّلة».
     * `locationServicesEnabled()` تُستدعى خارج الرئيسي عمدًا (توصية Apple —
     * قد تحجب الواجهة)، والرد يعود للرئيسي قبل لمس أي حالة.
     */
    private static func classifyDenied(_ completion: @escaping (String, String) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            let servicesEnabled = CLLocationManager.locationServicesEnabled()
            DispatchQueue.main.async {
                if servicesEnabled {
                    completion("PERMISSION_DENIED", "إذن الموقع مرفوض للتطبيق — فعّله من الإعدادات")
                } else {
                    completion("SERVICES_DISABLED", "خدمات الموقع معطّلة على الجهاز")
                }
            }
        }
    }

    /// نفس شكل @capacitor/geolocation — الحقول الغائبة تُحذف لا تُصفَّر.
    private static func positionPayload(_ location: CLLocation) -> PluginCallResultData {
        var coords: [String: Any] = [
            "latitude": location.coordinate.latitude,
            "longitude": location.coordinate.longitude,
            "accuracy": location.horizontalAccuracy
        ]
        if location.verticalAccuracy >= 0 {
            coords["altitude"] = location.altitude
            coords["altitudeAccuracy"] = location.verticalAccuracy
        }
        if location.course >= 0 { coords["heading"] = location.course }
        if location.speed >= 0 { coords["speed"] = location.speed }
        return [
            "coords": coords,
            "timestamp": location.timestamp.timeIntervalSince1970 * 1000
        ]
    }
}

/**
 * تسجيل البلجن المحلي — أسلوب Capacitor 8 مع SPM (بلا Podfile).
 *
 * لماذا لا `packageClassList`: يعيد `npx cap sync` كتابته من حزم npm حصرًا
 * (`@capacitor/cli/dist/util/iosplugin.js`) فأي إضافة يدوية تُمحى كل مزامنة.
 * `capacitorDidLoad()` هو الخطّاف الرسمي (CAPBridgeViewController.swift:164)
 * ويُستدعى بعد إنشاء الجسر وقبل تحميل الويب‑فيو، فيدخل SultanGeo في
 * `Capacitor.PluginHeaders` ويصير `window.Capacitor.Plugins.SultanGeo` جاهزًا
 * قبل أول سطر من كودنا.
 */
public class SultanBridgeViewController: CAPBridgeViewController {
    override public func capacitorDidLoad() {
        bridge?.registerPluginInstance(SultanGeoPlugin())
    }
}
