import Foundation
import Testing
@testable import QuotaPill

/// Runs `Collector.run` against small shell scripts that stand in for the collector.
struct CollectorRunTests {
    private let shell = URL(fileURLWithPath: "/bin/sh")

    private func run(_ script: String, timeout: Duration = .seconds(10)) async throws -> String {
        let data = try await Collector.run(shell, arguments: ["-c", script], timeout: timeout)
        return String(decoding: data, as: UTF8.self)
    }

    private func isAlive(_ pid: pid_t) -> Bool { kill(pid, 0) == 0 }

    private func pid(in file: URL) throws -> pid_t {
        try #require(pid_t(String(contentsOf: file, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)))
    }

    private func temporaryFile() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("quota-pill-\(UUID().uuidString)")
    }

    /// Starts an `Execution` that must fail and checks that nothing keeps it, or its pipes, alive afterwards.
    private func expectReleaseAfterFailure(of process: Process, timeout: Duration, within limit: Duration) async throws {
        weak var execution: Execution?
        await #expect(throws: (any Error).self) {
            try await withCheckedThrowingContinuation { continuation in
                let started = Execution(process: process, continuation: continuation)
                execution = started
                started.start(timeout: timeout)
            }
        }
        // Readers stop and pending grace work runs asynchronously, so give the release some time.
        let deadline = ContinuousClock.now + limit
        while execution != nil, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(50))
        }
        #expect(execution == nil)
    }

    @Test func releasesTheExecutionWhenLaunchFails() async throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file) }
        // Exists but is not executable, so launching it throws.
        try "#!/bin/sh\necho ok\n".write(to: file, atomically: true, encoding: .utf8)
        let process = Process()
        process.executableURL = file
        try await expectReleaseAfterFailure(of: process, timeout: .seconds(60), within: .seconds(1))
    }

    @Test func releasesTheExecutionAfterATimeout() async throws {
        let process = Process()
        process.executableURL = shell
        process.arguments = ["-c", "exec sleep 600"]
        // The kill ends the process and its handler, then the drain grace lets go.
        try await expectReleaseAfterFailure(of: process, timeout: .seconds(1), within: .seconds(5))
    }

    @Test func returnsStdout() async throws {
        #expect(try await run("echo ok") == "ok\n")
    }

    @Test func reportsTheFirstStderrLineOnFailure() async throws {
        await #expect(throws: CollectorError.self) { try await run("echo boom >&2; echo more >&2; exit 3") }
        do {
            _ = try await run("echo boom >&2; exit 3")
        } catch {
            #expect(error.localizedDescription == "boom")
        }
    }

    @Test func readsBothPipesWithoutDeadlock() async throws {
        // Far more than a pipe buffer on stderr before anything on stdout.
        let output = try await run("head -c 1000000 /dev/zero | tr '\\0' x >&2; echo ok")
        #expect(output == "ok\n")
    }

    @Test func timesOutAndKillsACollectorThatNeverEnds() async throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file) }
        let start = ContinuousClock.now
        do {
            _ = try await run("echo $$ > '\(file.path)'; exec sleep 600", timeout: .seconds(1))
            Issue.record("The run should have timed out.")
        } catch {
            #expect(error.localizedDescription.contains("did not answer"))
        }
        #expect(ContinuousClock.now - start < .seconds(5))
        let pid = try pid(in: file)
        try await Task.sleep(for: .milliseconds(500))
        #expect(!isAlive(pid))
    }

    @Test func finishesWhenAGrandchildHoldsThePipes() async throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file) }
        let start = ContinuousClock.now
        let output = try await run("sleep 600 & echo $! > '\(file.path)'; echo ok")
        #expect(output == "ok\n")
        #expect(ContinuousClock.now - start < .seconds(5))
        let pid = try pid(in: file)
        try await Task.sleep(for: .milliseconds(500))
        #expect(!isAlive(pid))
    }

    @Test func stopsADescendantWhenTheTimeoutFollowsTheCollectorExit() async throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file) }
        // The collector exits after 0.5s, so the 1s timeout fires inside the drain grace.
        do {
            _ = try await run("sleep 600 & echo $! > '\(file.path)'; echo ok; sleep 0.5", timeout: .seconds(1))
            Issue.record("The run should have timed out.")
        } catch {
            #expect(error.localizedDescription.contains("did not answer"))
        }
        let pid = try pid(in: file)
        defer { kill(pid, SIGKILL) }
        try await Task.sleep(for: .milliseconds(500))
        #expect(!isAlive(pid))
    }

    @Test func killsAGrandchildThatIgnoresSIGTERMAfterTheCollectorExits() async throws {
        let file = temporaryFile()
        defer { try? FileManager.default.removeItem(at: file) }
        let output = try await run("sh -c \"trap '' TERM; echo \\$\\$ > '\(file.path)'; exec sleep 600\" & echo ok")
        #expect(output == "ok\n")
        let pid = try pid(in: file)
        defer { kill(pid, SIGKILL) }
        // SIGTERM went out when the run finished; SIGKILL follows after the kill grace.
        #expect(isAlive(pid))
        try await Task.sleep(for: .seconds(4))
        #expect(!isAlive(pid))
    }
}
