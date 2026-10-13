import AppKit
import SwiftUI

private let links: [String: URL] = [
    "copilot": URL(string: "https://github.com/settings/billing/premium_requests_usage")!,
    "codex": URL(string: "https://chatgpt.com/codex/settings/usage")!,
    "claude": URL(string: "https://claude.ai/settings/usage")!,
]

private let cardRadius: CGFloat = 14
private let detailsWidth: CGFloat = 300

struct PillView: View {
    let store: QuotaStore
    let state: PanelState
    let onSize: (CGSize) -> Void
    let onHover: (Bool) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        card
            .fixedSize()
            .onGeometryChange(for: CGSize.self, of: \.size) { onSize($0) }
            // While the window waits to shrink, keep the card pinned to its anchor corner.
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: anchor)
    }

    private var anchor: Alignment {
        switch (state.expandsUp, state.alignTrailing) {
        case (false, false): .topLeading
        case (false, true): .topTrailing
        case (true, false): .bottomLeading
        case (true, true): .bottomTrailing
        }
    }
}

private extension Alignment {
    var unitPoint: UnitPoint {
        switch self {
        case .topTrailing: .topTrailing
        case .bottomLeading: .bottomLeading
        case .bottomTrailing: .bottomTrailing
        default: .topLeading
        }
    }
}

private extension View {
    /// Liquid Glass where available, and the closest system material before macOS 26.
    @ViewBuilder
    func cardBackground() -> some View {
        if #available(macOS 26, *) {
            glassEffect(.regular, in: .rect(cornerRadius: cardRadius))
        } else {
            background(BlurBackground(cornerRadius: cardRadius))
        }
    }
}

/// Blurs the desktop behind the panel. SwiftUI materials follow the window's
/// active state, and this panel is never active, so they would render flat.
private struct BlurBackground: NSViewRepresentable {
    let cornerRadius: CGFloat

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .popover
        view.blendingMode = .behindWindow
        view.state = .active
        view.maskImage = mask
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}

    /// A stretchable rounded rectangle, the documented way to shape the blur.
    private var mask: NSImage {
        let edge = cornerRadius * 2 + 1
        let image = NSImage(size: NSSize(width: edge, height: edge), flipped: false) { rect in
            NSColor.black.setFill()
            NSBezierPath(roundedRect: rect, xRadius: cornerRadius, yRadius: cornerRadius).fill()
            return true
        }
        image.capInsets = NSEdgeInsets(top: cornerRadius, left: cornerRadius, bottom: cornerRadius, right: cornerRadius)
        image.resizingMode = .stretch
        return image
    }
}

private extension PillView {

    private var card: some View {
        VStack(alignment: state.alignTrailing ? .trailing : .leading, spacing: 0) {
            if state.expanded && state.expandsUp { details }
            summary
            if state.expanded && !state.expandsUp { details }
        }
        .cardBackground()
        .contentShape(.rect(cornerRadius: cardRadius))
        .onHover(perform: onHover)
        .animation(reduceMotion ? .easeOut(duration: 0.15) : .snappy(duration: 0.22), value: state.expanded)
        .contextMenu {
            Button("Refresh now") { store.refresh(force: true) }
            Divider()
            Button("Quit") { NSApp.terminate(nil) }
        }
    }

    private var summary: some View {
        HStack(spacing: 12) {
            if store.reports.isEmpty {
                Text("AI")
                    .foregroundStyle(.secondary)
                Text(store.failure == nil ? "···" : "!")
                    .foregroundStyle(store.failure == nil ? Color.secondary : Palette.critical)
            } else {
                ForEach(store.reports) { report in
                    HStack(spacing: 4) {
                        Text(report.short)
                            .foregroundStyle(.secondary)
                        indicator(for: report)
                    }
                }
            }
        }
        .font(.system(size: 12, weight: .semibold))
        .monospacedDigit()
        .padding(.horizontal, 12)
        .frame(height: 28)
    }

    @ViewBuilder
    private func indicator(for report: HarnessReport) -> some View {
        if report.status == .error {
            Text("!").foregroundStyle(Palette.critical)
        } else if let pct = report.worstPct {
            Text("\(Int(pct.rounded()))")
                .foregroundStyle(Level(pct).color)
                .contentTransition(.numericText(value: pct))
        } else {
            Text("–").foregroundStyle(.tertiary)
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(store.reports) { report in
                SectionView(
                    report: report,
                    isRefreshing: store.isRefreshing(report.harness),
                    onRefresh: { store.refresh(harness: report.harness) }
                )
            }
            footer
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .frame(width: detailsWidth, alignment: .leading)
        .transition(reduceMotion ? .opacity : .opacity.combined(with: .scale(scale: 0.96, anchor: anchor.unitPoint)))
    }

    private var footer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VStack(alignment: .leading, spacing: 4) {
                if let failure = store.failure {
                    Text(failure)
                        .foregroundStyle(Palette.critical)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let updated = store.lastUpdated {
                    Text("Updated at \(Format.clock(updated))")
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
            RefreshButton(label: "Refresh all", isActive: store.isLoading) {
                store.refresh(force: true)
            }
        }
        .font(.system(size: 11))
    }
}

private struct SectionView: View {
    let report: HarnessReport
    let isRefreshing: Bool
    let onRefresh: () -> Void

    @State private var isHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(report.name)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Palette.accent)
                if let plan = report.plan {
                    Text(plan)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                // Revealed on hover so four idle buttons don't clutter the panel.
                RefreshButton(label: "Refresh \(report.name)", isActive: isRefreshing, action: onRefresh)
                    .opacity(isHovered || isRefreshing ? 1 : 0)
                    .animation(.easeOut(duration: 0.15), value: isHovered)
            }

            if report.status == .ok {
                if report.windows.isEmpty {
                    note("No active limits.")
                }
                ForEach(report.windows) { WindowRow(window: $0) }
                if let caveat {
                    note(caveat)
                }
            } else {
                Text(report.message ?? "Unavailable.")
                    .font(.system(size: 11))
                    .foregroundStyle(report.status == .error ? Palette.critical : .secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .contentShape(.rect)
        .onTapGesture(perform: open)
        .onHover { isHovered = $0 }
    }

    private var caveat: String? {
        let parts = [report.dataAsOf.map { "Data from \(Format.clock($0))" }, report.message].compactMap { $0 }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func open() {
        if let url = links[report.harness] {
            NSWorkspace.shared.open(url)
        } else if report.harness == "antigravity",
                  let app = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "com.google.antigravity") {
            NSWorkspace.shared.openApplication(at: app, configuration: .init())
        }
    }
}

private struct RefreshButton: View {
    let label: String
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "arrow.clockwise")
                .font(.system(size: 10, weight: .semibold))
                .symbolEffect(.rotate, options: .repeat(.continuous), isActive: isActive)
                .frame(width: 16, height: 14)
                .contentShape(.rect.inset(by: -4))
        }
        .buttonStyle(PressableStyle())
        .foregroundStyle(.secondary)
        .help(label)
        .accessibilityLabel(label)
    }
}

private struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.85 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

private struct WindowRow: View {
    let window: QuotaWindow

    var body: some View {
        let level = Level(window.usedPct)
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(window.label)
                    .foregroundStyle(.primary)
                Spacer(minLength: 8)
                Text("\(Int(window.usedPct.rounded()))%")
                    .monospacedDigit()
                    .foregroundStyle(level.color)
            }
            .font(.system(size: 12))

            ProgressBar(fraction: window.usedPct / 100, color: level.color)

            if window.resetsAt != nil || window.detail != nil {
                TimelineView(.periodic(from: .now, by: 30)) { context in
                    HStack {
                        if let resetsAt = window.resetsAt {
                            Text("resets in \(Format.relative(to: resetsAt, from: context.date))")
                            Spacer(minLength: 8)
                        }
                        if let detail = window.detail {
                            Text(detail).monospacedDigit()
                        }
                    }
                }
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
            }
        }
    }
}

private struct ProgressBar: View {
    let fraction: Double
    let color: Color

    var body: some View {
        Capsule()
            .fill(.primary.opacity(0.1))
            .overlay(alignment: .leading) {
                GeometryReader { proxy in
                    Capsule()
                        .fill(color)
                        .frame(width: max(fraction > 0 ? 4 : 0, proxy.size.width * min(1, fraction)))
                }
            }
            .frame(height: 4)
    }
}
