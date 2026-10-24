import Foundation
import Synchronization

enum CollectorError: LocalizedError {
    case bunNotFound
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .bunNotFound: "bun not found. Install it with: brew install bun"
        case .failed(let message): message
        }
    }
}

/// Runs the TypeScript collector, which stays the single source of truth for every harness.
enum Collector {
    // GUI apps start with a minimal PATH; the collector shells out to gh, lsof, ps and osascript.
    private static let searchPath: [String] = {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        return [
            "\(home)/.bun/bin",
            "/etc/profiles/per-user/\(NSUserName())/bin",
            "\(home)/.nix-profile/bin",
            "/run/current-system/sw/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ]
    }()

    static func projectRoot() throws -> URL {
        if let root = ProcessInfo.processInfo.environment["QUOTA_PILL_ROOT"] {
            return URL(fileURLWithPath: root)
        }
        guard var url = Bundle.main.executableURL?.resolvingSymlinksInPath() else {
            throw CollectorError.failed("Cannot locate the collector. Set QUOTA_PILL_ROOT to the project root.")
        }
        url.deleteLastPathComponent()
        while url.path != "/" {
            if FileManager.default.fileExists(atPath: url.appendingPathComponent("src/cli.ts").path) {
                return url
            }
            url.deleteLastPathComponent()
        }
        throw CollectorError.failed("Cannot locate the collector. Set QUOTA_PILL_ROOT to the project root.")
    }

    /// - Parameters:
    ///   - only: Restricts the run to one harness.
    ///   - force: Skips local caches, for refreshes the user asked for.
    static func collect(only harness: String? = nil, force: Bool = false) async throws -> [HarnessReport] {
        guard let bun = searchPath
            .map({ URL(fileURLWithPath: $0).appendingPathComponent("bun") })
            .first(where: { FileManager.default.isExecutableFile(atPath: $0.path) })
        else { throw CollectorError.bunNotFound }

        let cli = try projectRoot().appendingPathComponent("src/cli.ts").path
        guard FileManager.default.fileExists(atPath: cli) else {
            throw CollectorError.failed("Cannot locate the collector. Set QUOTA_PILL_ROOT to the project root.")
        }
        var arguments = [cli]
        if let harness { arguments += ["--only", harness] }
        if force { arguments.append("--force") }
        let data = try await run(bun, arguments: arguments)
        return try decoder.decode([HarnessReport].self, from: data)
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            if let date = try? Date(text, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)) {
                return date
            }
            return try Date(text, strategy: .iso8601)
        }
        return decoder
    }()

    /// Always finishes, so a stuck collector can never leave the pill waiting forever.
    /// - Parameters:
    ///   - timeout: How long the run may take before it is killed and reported as failed.
    static func run(_ executable: URL, arguments: [String], timeout: Duration = .seconds(60)) async throws -> Data {
        let process = Process()
        process.executableURL = executable
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = searchPath.joined(separator: ":")
        process.environment = environment
        return try await withCheckedThrowingContinuation { continuation in
            Execution(process: process, continuation: continuation).start(timeout: timeout)
        }
    }
}

/// One collector process. Reads stdout and stderr as they arrive, so neither pipe can fill up
/// and block the child, and resumes the continuation exactly once: on exit or on timeout.
final class Execution: Sendable {
    private struct State {
        var continuation: CheckedContinuation<Data, any Error>?
        var output = Data()
        var errors = Data()
        var openStreams = 2
        var exited = false
    }

    /// How long to wait for the pipes to close after the collector exits. Only a leftover
    /// grandchild that inherited them keeps them open; everything the collector wrote is already buffered.
    private static let drainGrace: Duration = .seconds(2)
    /// How long the collector gets to exit after SIGTERM before SIGKILL.
    private static let killGrace: Duration = .seconds(3)

    private let process: Process
    private let stdout = Pipe()
    private let stderr = Pipe()
    private let state: Mutex<State>

    init(process: Process, continuation: CheckedContinuation<Data, any Error>) {
        self.process = process
        state = Mutex(State(continuation: continuation))
    }

    func start(timeout: Duration) {
        process.standardOutput = stdout
        process.standardError = stderr
        stdout.fileHandleForReading.readabilityHandler = { [self] handle in
            read(handle) { $0.output.append($1) }
        }
        stderr.fileHandleForReading.readabilityHandler = { [self] handle in
            read(handle) { $0.errors.append($1) }
        }
        process.terminationHandler = { [self] process in
            process.terminationHandler = nil
            state.withLock { $0.exited = true }
            finishIfDone()
            // A pipe still open here is held by a leftover descendant, which the group cleanup stops.
            after(Self.drainGrace) { self.finish() }
        }
        do {
            try process.run()
        } catch {
            // The handler only runs after an exit, so drop it here or it keeps this object and its pipes alive.
            process.terminationHandler = nil
            finish(throwing: error)
            return
        }
        after(timeout) {
            self.finish(throwing: CollectorError.failed("The collector did not answer within \(timeout.components.seconds) seconds."))
        }
    }

    private func read(_ handle: FileHandle, into append: (inout State, Data) -> Void) {
        let chunk = handle.availableData
        if chunk.isEmpty {
            handle.readabilityHandler = nil
            state.withLock { $0.openStreams -= 1 }
            finishIfDone()
        } else {
            state.withLock { append(&$0, chunk) }
        }
    }

    private func finishIfDone() {
        if state.withLock({ $0.exited && $0.openStreams == 0 }) { finish() }
    }

    /// Resumes with the process result. Called once the collector has exited.
    private func finish() {
        let status = process.terminationStatus
        complete { state in
            if status == 0 { return .success(state.output) }
            let message = String(decoding: state.errors, as: UTF8.self)
                .split(separator: "\n").first.map(String.init)
                ?? "The collector exited with code \(status)."
            return .failure(CollectorError.failed(message))
        }
    }

    private func finish(throwing error: any Error) {
        complete { _ in .failure(error) }
    }

    /// Resumes the continuation if nobody has yet, stops reading the pipes and stops whatever
    /// is left of the collector. The pipes close when this object goes away, never under a
    /// reader that may still be running.
    private func complete(_ result: (State) -> Result<Data, any Error>) {
        let resumed: (CheckedContinuation<Data, any Error>, Result<Data, any Error>)? = state.withLock { state in
            guard let continuation = state.continuation else { return nil }
            state.continuation = nil
            return (continuation, result(state))
        }
        guard let (continuation, result) = resumed else { return }
        continuation.resume(with: result)

        stdout.fileHandleForReading.readabilityHandler = nil
        stderr.fileHandleForReading.readabilityHandler = nil
        stopGroup()
    }

    /// Signals the collector's process group, which it leads, whenever the group still exists,
    /// whether the collector itself has exited or not. The group outlives the collector while any
    /// descendant remains, and its id cannot be reused until it is empty.
    private func stopGroup() {
        guard process.processIdentifier > 0 else { return }
        let group = -process.processIdentifier
        guard kill(group, 0) == 0 else { return }
        kill(group, SIGTERM)
        after(Self.killGrace) {
            if kill(group, 0) == 0 { kill(group, SIGKILL) }
        }
    }

    private func after(_ delay: Duration, _ work: @escaping @Sendable () -> Void) {
        let (seconds, attoseconds) = delay.components
        let interval = Double(seconds) + Double(attoseconds) / 1e18
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + interval, execute: work)
    }
}
