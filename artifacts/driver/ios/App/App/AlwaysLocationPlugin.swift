// ============================================================
// MCC Driver — AlwaysLocation Capacitor plugin (iOS)
// ============================================================
// The official @capacitor/geolocation plugin only requests
// "while in use" authorization on iOS. App Review (and the
// product spec) requires that we explicitly request "Always"
// at ride-accept time so background location can keep flowing
// when the screen is locked.
//
// This in-app Capacitor plugin exposes a single JS-callable
// method, `requestAlways()`, which wraps
// CLLocationManager.requestAlwaysAuthorization(). The system
// will surface the "Always Allow" upgrade dialog if the user
// has previously granted whenInUse, or the initial prompt
// otherwise. A no-op if already authorizedAlways.
// ============================================================

import Foundation
import Capacitor
import CoreLocation

@objc(AlwaysLocationPlugin)
public class AlwaysLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "AlwaysLocationPlugin"
    public let jsName = "AlwaysLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "requestAlways", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getAuthorizationStatus", returnType: CAPPluginReturnPromise),
    ]

    private let manager = CLLocationManager()

    @objc func requestAlways(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.manager.delegate = self
            // requestAlwaysAuthorization is a no-op if status is already
            // .authorizedAlways. If it's .authorizedWhenInUse, iOS will
            // surface the "Change to Always Allow?" upgrade dialog.
            self.manager.requestAlwaysAuthorization()
            call.resolve([
                "status": Self.statusString(CLLocationManager.authorizationStatus())
            ])
        }
    }

    @objc func getAuthorizationStatus(_ call: CAPPluginCall) {
        call.resolve([
            "status": Self.statusString(CLLocationManager.authorizationStatus())
        ])
    }

    private static func statusString(_ s: CLAuthorizationStatus) -> String {
        switch s {
        case .notDetermined: return "notDetermined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedAlways: return "always"
        case .authorizedWhenInUse: return "whenInUse"
        @unknown default: return "unknown"
        }
    }
}
