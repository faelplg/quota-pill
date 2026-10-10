import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let store = QuotaStore()
    private var controller: PanelController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let controller = PanelController(store: store)
        controller.show()
        self.controller = controller
        store.start()
    }
}

MainActor.assumeIsolated {
    let app = NSApplication.shared
    let delegate = AppDelegate()
    app.delegate = delegate
    app.setActivationPolicy(.accessory)
    app.run()
}
