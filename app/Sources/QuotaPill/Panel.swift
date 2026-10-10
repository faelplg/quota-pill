import AppKit
import Observation
import SwiftUI

/// Where the pill grows when it expands, decided from its position on screen
/// so the summary row stays still under the pointer.
@MainActor @Observable
final class PanelState {
    var expanded = false
    var expandsUp = false
    var alignTrailing = false
}

final class PillPanel: NSPanel {
    init() {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 220, height: 28),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        isFloatingPanel = true
        level = .statusBar
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        hidesOnDeactivate = false
        isMovableByWindowBackground = true
        becomesKeyOnlyIfNeeded = true
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class DraggableHostingView<Content: View>: NSHostingView<Content> {
    override var mouseDownCanMoveWindow: Bool { true }

    // Let the first click act even though the app never becomes active.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

@MainActor
final class PanelController {
    private let panel = PillPanel()
    private let state = PanelState()
    private let store: QuotaStore
    private var pendingShrink: DispatchWorkItem?
    private var pendingHover: DispatchWorkItem?

    private static let autosaveName = "QuotaPill"
    private static let openDelay = 0.12
    private static let closeDelay = 0.3
    /// Slightly longer than the collapse animation, so it never gets clipped.
    private static let shrinkDelay = 0.26
    private static let reservedWidth: CGFloat = 320
    private static let reservedHeight: CGFloat = 800

    init(store: QuotaStore) {
        self.store = store
        let root = PillView(
            store: store,
            state: state,
            onSize: { [weak self] in self?.resize(to: $0) },
            onHover: { [weak self] in self?.hover($0) }
        )
        let host = DraggableHostingView(rootView: root)
        host.sizingOptions = []
        panel.contentView = host

        if !panel.setFrameUsingName(Self.autosaveName) {
            placeDefault()
        }
        panel.setFrameAutosaveName(Self.autosaveName)
        updateAnchors()
    }

    func show() {
        panel.orderFrontRegardless()
    }

    private func placeDefault() {
        guard let screen = NSScreen.main?.visibleFrame else { return }
        let size = panel.frame.size
        panel.setFrameOrigin(NSPoint(x: screen.maxX - size.width - 16, y: screen.maxY - size.height - 16))
    }

    private func updateAnchors() {
        guard let screen = (panel.screen ?? NSScreen.main)?.visibleFrame else { return }
        state.expandsUp = panel.frame.midY < screen.midY
        state.alignTrailing = panel.frame.midX > screen.midX
    }

    private func hover(_ inside: Bool) {
        pendingHover?.cancel()
        guard inside != state.expanded else { return }
        let work = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard inside else {
                state.expanded = false
                return
            }
            updateAnchors()
            reserveRoomForDetails()
            // Expand on the next pass, once the window already has room, so the
            // details grow out of the pill instead of sliding in from the far edge.
            DispatchQueue.main.async { self.state.expanded = true }
        }
        pendingHover = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (inside ? Self.openDelay : Self.closeDelay), execute: work)
    }

    /// Grows the transparent window up front; the real size arrives from SwiftUI right after.
    private func reserveRoomForDetails() {
        pendingShrink?.cancel()
        guard let screen = (panel.screen ?? NSScreen.main)?.visibleFrame else { return }
        let frame = panel.frame
        let room = state.expandsUp ? screen.maxY - frame.minY : frame.maxY - screen.minY
        apply(CGSize(width: max(frame.width, Self.reservedWidth), height: min(Self.reservedHeight, room)))
    }

    private func resize(to size: CGSize) {
        pendingShrink?.cancel()
        let current = panel.frame.size
        if size.width >= current.width && size.height >= current.height {
            apply(size)
            return
        }
        // Grow immediately, but shrink only after the content finished animating.
        let work = DispatchWorkItem { [weak self] in self?.apply(size) }
        pendingShrink = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Self.shrinkDelay, execute: work)
    }

    private func apply(_ size: CGSize) {
        let frame = panel.frame
        let x = state.alignTrailing ? frame.maxX - size.width : frame.minX
        let y = state.expandsUp ? frame.minY : frame.maxY - size.height
        panel.setFrame(NSRect(x: x, y: y, width: size.width, height: size.height), display: true)
        // Settle SwiftUI's layout for the new size now, outside any animation,
        // so the pill never visibly travels to its anchor corner.
        panel.contentView?.layoutSubtreeIfNeeded()
        panel.invalidateShadow()
    }
}
