import AppKit
import SwiftUI

enum ReportStatus: String, Decodable {
    case ok, unavailable, error
}

struct QuotaWindow: Decodable, Identifiable, Equatable {
    let id: String
    let label: String
    let usedPct: Double
    let resetsAt: Date?
    let detail: String?
}

struct HarnessReport: Decodable, Identifiable, Equatable {
    let harness: String
    let name: String
    let short: String
    let status: ReportStatus
    let plan: String?
    let windows: [QuotaWindow]
    let message: String?
    let dataAsOf: Date?

    var id: String { harness }

    var worstPct: Double? {
        guard status == .ok else { return nil }
        return windows.map(\.usedPct).max()
    }
}

/// Mirrors the thresholds in src/render.ts so both surfaces agree.
enum Level {
    case normal, warn, critical

    init(_ pct: Double) {
        self = pct >= 95 ? .critical : pct >= 80 ? .warn : .normal
    }

    var color: Color {
        switch self {
        case .normal: Palette.accent
        case .warn: Palette.warn
        case .critical: Palette.critical
        }
    }
}

enum Palette {
    static let accent = dynamic(light: 0x0A6CDB, dark: 0x5AA9FF)
    static let warn = Color(hex: 0xE8890C)
    static let critical = Color(hex: 0xE5484D)

    private static func dynamic(light: UInt32, dark: UInt32) -> Color {
        Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(hex: isDark ? dark : light)
        })
    }
}

extension NSColor {
    convenience init(hex: UInt32) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(nsColor: NSColor(hex: hex))
    }
}

enum Format {
    static func relative(to target: Date, from now: Date = .now) -> String {
        let minutes = max(0, Int((target.timeIntervalSince(now) / 60).rounded()))
        if minutes < 60 { return "\(minutes)min" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h \(String(format: "%02d", minutes % 60))min" }
        let days = hours / 24
        return days < 7 ? "\(days)d \(hours % 24)h" : "\(days)d"
    }

    static func clock(_ date: Date, relativeTo now: Date = .now) -> String {
        let time = date.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
        if Calendar.current.isDate(date, inSameDayAs: now) { return time }
        return "\(date.formatted(.dateTime.day(.twoDigits).month(.twoDigits))) \(time)"
    }
}
