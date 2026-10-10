import AppKit
import Observation

@MainActor @Observable
final class QuotaStore {
    private(set) var reports: [HarnessReport] = []
    private(set) var lastUpdated: Date?
    private(set) var failure: String?
    private(set) var isLoading = false
    private(set) var refreshing: Set<String> = []

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

    func isRefreshing(_ harness: String) -> Bool {
        isLoading || refreshing.contains(harness)
    }

    func refresh(force: Bool = false) {
        guard !isLoading else { return }
        isLoading = true
        Task {
            defer { isLoading = false }
            do {
                reports = try await Collector.collect(force: force)
                lastUpdated = .now
                failure = nil
            } catch {
                failure = error.localizedDescription
            }
        }
    }

    func refresh(harness: String) {
        guard !isRefreshing(harness) else { return }
        refreshing.insert(harness)
        Task {
            defer { refreshing.remove(harness) }
            do {
                for report in try await Collector.collect(only: harness, force: true) {
                    if let index = reports.firstIndex(where: { $0.harness == report.harness }) {
                        reports[index] = report
                    }
                }
            } catch {
                failure = error.localizedDescription
            }
        }
    }
}
