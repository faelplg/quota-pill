import AppKit
import Observation

@MainActor @Observable
final class QuotaStore {
    private(set) var reports: [HarnessReport] = []
    private(set) var lastUpdated: Date?
    private(set) var failure: String?
    private(set) var isLoading = false

    @ObservationIgnored private var timer: Timer?
    @ObservationIgnored private var wakeObserver: NSObjectProtocol?

    func start(interval: TimeInterval = 120) {
        refresh()
        timer = Timer.scheduledTimer(withTimeInterval: interval, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
        wakeObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didWakeNotification, object: nil, queue: .main
        ) { [weak self] _ in
            Task { @MainActor in self?.refresh() }
        }
    }

    func refresh() {
        guard !isLoading else { return }
        isLoading = true
        Task {
            defer { isLoading = false }
            do {
                reports = try await Collector.collect()
                lastUpdated = .now
                failure = nil
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}
