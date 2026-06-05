// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.3.4"),
        .package(name: "CapacitorCamera", path: "../../../../../node_modules/.pnpm/@capacitor+camera@8.2.0_@capacitor+core@8.3.4/node_modules/@capacitor/camera"),
        .package(name: "CapacitorNetwork", path: "../../../../../node_modules/.pnpm/@capacitor+network@8.0.1_@capacitor+core@8.3.4/node_modules/@capacitor/network"),
        .package(name: "SentryCapacitor", path: "../../../../../node_modules/.pnpm/@sentry+capacitor@4.0.0_@capacitor+core@8.3.4_@sentry+react@10.43.0_react@19.1.0_/node_modules/@sentry/capacitor"),
        .package(name: "CapacitorApp", path: "../../../../../node_modules/.pnpm/@capacitor+app@8.1.0_@capacitor+core@8.3.4/node_modules/@capacitor/app"),
        .package(name: "CapacitorGeolocation", path: "../../../../../node_modules/.pnpm/@capacitor+geolocation@8.2.0_@capacitor+core@8.3.4/node_modules/@capacitor/geolocation"),
        .package(name: "CapacitorKeyboard", path: "../../../../../node_modules/.pnpm/@capacitor+keyboard@8.0.3_@capacitor+core@8.3.4/node_modules/@capacitor/keyboard"),
        .package(name: "CapacitorPushNotifications", path: "../../../../../node_modules/.pnpm/@capacitor+push-notifications@8.1.0_@capacitor+core@8.3.4/node_modules/@capacitor/push-notifications"),
        .package(name: "CapacitorSplashScreen", path: "../../../../../node_modules/.pnpm/@capacitor+splash-screen@8.0.1_@capacitor+core@8.3.4/node_modules/@capacitor/splash-screen"),
        .package(name: "CapacitorStatusBar", path: "../../../../../node_modules/.pnpm/@capacitor+status-bar@8.0.2_@capacitor+core@8.3.4/node_modules/@capacitor/status-bar"),
        .package(name: "CapacitorCommunityCameraPreview", path: "../../../../../node_modules/.pnpm/@capacitor-community+camera-preview@8.0.1_@capacitor+core@8.3.4/node_modules/@capacitor-community/camera-preview")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "CapacitorCamera", package: "CapacitorCamera"),
                .product(name: "CapacitorNetwork", package: "CapacitorNetwork"),
                .product(name: "SentryCapacitor", package: "SentryCapacitor"),
                .product(name: "CapacitorApp", package: "CapacitorApp"),
                .product(name: "CapacitorGeolocation", package: "CapacitorGeolocation"),
                .product(name: "CapacitorKeyboard", package: "CapacitorKeyboard"),
                .product(name: "CapacitorPushNotifications", package: "CapacitorPushNotifications"),
                .product(name: "CapacitorSplashScreen", package: "CapacitorSplashScreen"),
                .product(name: "CapacitorStatusBar", package: "CapacitorStatusBar"),
                .product(name: "CapacitorCommunityCameraPreview", package: "CapacitorCommunityCameraPreview")
            ]
        )
    ]
)
