import Foundation

enum CollectorError: LocalizedError {
    case bunNotFound
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .bunNotFound: "bun não encontrado. Instale com: brew install bun"
        case .failed(let message): message
        }
    }
}

/// Runs the TypeScript collector, which stays the single source of truth for every harness.
enum Collector {
    // GUI apps start with a minimal PATH; the collector shells out to gh, security, lsof and ps.
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

    static let projectRoot: URL = {
        if let root = ProcessInfo.processInfo.environment["AI_QUOTA_ROOT"] {
            return URL(fileURLWithPath: root)
        }
        // app/Sources/QuotaPill/Collector.swift -> project root
        var url = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { url.deleteLastPathComponent() }
        return url
    }()

    static func collect() async throws -> [HarnessReport] {
        guard let bun = searchPath
            .map({ URL(fileURLWithPath: $0).appendingPathComponent("bun") })
            .first(where: { FileManager.default.isExecutableFile(atPath: $0.path) })
        else { throw CollectorError.bunNotFound }

        let cli = projectRoot.appendingPathComponent("src/cli.ts").path
        let data = try await run(bun, arguments: [cli, "json", "--no-alerts"])
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

    private static func run(_ executable: URL, arguments: [String]) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            let process = Process()
            process.executableURL = executable
            process.arguments = arguments
            var environment = ProcessInfo.processInfo.environment
            environment["PATH"] = searchPath.joined(separator: ":")
            process.environment = environment
            let stdout = Pipe()
            let stderr = Pipe()
            process.standardOutput = stdout
            process.standardError = stderr
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
                return
            }
            DispatchQueue.global(qos: .utility).async {
                let output = stdout.fileHandleForReading.readDataToEndOfFile()
                let errors = stderr.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                if process.terminationStatus == 0 {
                    continuation.resume(returning: output)
                } else {
                    let message = String(decoding: errors, as: UTF8.self)
                        .split(separator: "\n").first.map(String.init)
                        ?? "O coletor saiu com código \(process.terminationStatus)."
                    continuation.resume(throwing: CollectorError.failed(message))
                }
            }
        }
    }
}
