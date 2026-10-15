// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "QuotaPill",
    platforms: [.macOS(.v15)],
    targets: [
        .executableTarget(name: "QuotaPill", path: "Sources/QuotaPill"),
    ]
)
