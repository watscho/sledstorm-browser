import AppKit
import WebKit

private struct PanelLaunch: Decodable {
    let address: URL
    let openAtLaunch: Bool
}

private struct ServerQuit: Decodable {
    enum Event: String, Decodable {
        case stopped
        case notRunning = "not-running"
        case confirmationRequired = "confirmation-required"
    }

    let event: Event
    let instance: String?
    let message: String?
}

@main
@MainActor
final class ServerWindow: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, WKDownloadDelegate {
    private static let helperURL = Bundle.main.bundleURL.appending(path: "Contents/Helpers/SledStormServer")
    private let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 280),
                                  styleMask: [.titled, .closable, .miniaturizable, .resizable],
                                  backing: .buffered, defer: false)
    private var panelPort: Int?
    private var startingPanel = true
    private var quitPending = false

    static func main() {
        let environment = ProcessInfo.processInfo.environment
        if CommandLine.arguments.count > 1 || environment["SLED_SERVER_NO_BROWSER"] == "1"
            || !(environment["SLED_SERVER_OPENER"] ?? "").isEmpty {
            // Preserve the command-line entry point, exit status and signals.
            let path = helperURL.path
            var arguments = ([path] + CommandLine.arguments.dropFirst()).map { strdup($0) } + [nil]
            _ = arguments.withUnsafeMutableBufferPointer { execv(path, $0.baseAddress!) }
            perror("SledStormServer")
            exit(EXIT_FAILURE)
        }

        let application = NSApplication.shared
        let delegate = ServerWindow()
        application.delegate = delegate
        withExtendedLifetime(delegate) { application.run() }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        let title = "Sled Storm Server"
        let menu = NSMenu()
        let appMenu = NSMenuItem()
        appMenu.submenu = NSMenu()
        appMenu.submenu?.addItem(withTitle: "Quit \(title)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        menu.addItem(appMenu)
        NSApp.mainMenu = menu

        window.title = title
        window.titleVisibility = .hidden
        window.contentMinSize = NSSize(width: 320, height: 260)
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.center()
        let loading = NSTextField(labelWithString: "Connecting to the server…")
        loading.alignment = .center
        let content = NSView()
        loading.translatesAutoresizingMaskIntoConstraints = false
        content.addSubview(loading)
        NSLayoutConstraint.activate([
            loading.centerXAnchor.constraint(equalTo: content.centerXAnchor),
            loading.centerYAnchor.constraint(equalTo: content.centerYAnchor),
        ])
        window.contentView = content
        window.makeKeyAndOrderFront(nil)
        NSApp.activate()

        let launcher = Process()
        let output = Pipe()
        launcher.executableURL = Self.helperURL
        launcher.arguments = ["--native-panel"]
        launcher.standardOutput = output
        launcher.terminationHandler = { [weak self] process in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let launch = process.terminationStatus == 0 ? try? JSONDecoder().decode(PanelLaunch.self, from: data) : nil
            Task { @MainActor in self?.panelStarted(launch) }
        }
        do { try launcher.run() }
        catch { panelStarted(nil) }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        NSApp.terminate(nil)
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if !quitPending {
            quitPending = true
            if !startingPanel { Task { requestServerQuit() } }
        }
        return .terminateLater
    }

    private func panelStarted(_ launch: PanelLaunch?) {
        startingPanel = false
        if launch != nil || !quitPending { showPanel(launch) }
        // A quit during startup must wait for the launch helper to finish starting the server.
        if quitPending { requestServerQuit() }
    }

    private func requestServerQuit(confirmedInstance: String? = nil) {
        let helper = Process()
        let output = Pipe()
        helper.executableURL = Self.helperURL
        helper.arguments = ["--native-quit"] + (confirmedInstance.map { [$0] } ?? [])
        helper.standardOutput = output
        helper.terminationHandler = { [weak self] process in
            let data = output.fileHandleForReading.readDataToEndOfFile()
            let result = process.terminationStatus == 0 ? try? JSONDecoder().decode(ServerQuit.self, from: data) : nil
            Task { @MainActor in self?.handleServerQuit(result) }
        }
        do { try helper.run() }
        catch { handleServerQuit(nil) }
    }

    private func handleServerQuit(_ result: ServerQuit?) {
        switch result?.event {
        case .stopped, .notRunning:
            NSApp.reply(toApplicationShouldTerminate: true)
            return
        case .confirmationRequired:
            if let instance = result?.instance, let message = result?.message {
                let alert = NSAlert()
                alert.messageText = "Quit Sled Storm Server?"
                alert.informativeText = "\(message) Quitting disconnects them."
                alert.addButton(withTitle: "Cancel")
                alert.addButton(withTitle: "Quit Server")
                alert.beginSheetModal(for: window) { [weak self] choice in
                    if choice == .alertSecondButtonReturn {
                        self?.requestServerQuit(confirmedInstance: instance)
                    } else {
                        self?.cancelQuit()
                    }
                }
                return
            }
            fallthrough
        case nil:
            let alert = NSAlert()
            alert.messageText = "Could not stop Sled Storm Server"
            alert.informativeText = "The app is still open. Try quitting again."
            alert.beginSheetModal(for: window) { [weak self] _ in self?.cancelQuit() }
        }
    }

    private func cancelQuit() {
        quitPending = false
        NSApp.reply(toApplicationShouldTerminate: false)
    }

    private func showPanel(_ launch: PanelLaunch?) {
        guard let launch, launch.address.scheme == "http", launch.address.host == "127.0.0.1",
              let port = launch.address.port, launch.address.path == "/", launch.address.user == nil else {
            let alert = NSAlert()
            alert.messageText = "Could not connect to Sled Storm Server"
            alert.informativeText = "Close the window and try opening Sled Storm Server again."
            alert.beginSheetModal(for: window) { _ in self.window.close() }
            return
        }
        panelPort = port
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.userContentController.add(self, name: "openGame")
        config.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "copyInvite")
        if launch.openAtLaunch {
            config.userContentController.addUserScript(WKUserScript(source: "window.sledOpenAtLaunch = true",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        let page = WKWebView(frame: .zero, configuration: config)
        page.navigationDelegate = self
        page.uiDelegate = self
        window.contentView = page
        page.load(URLRequest(url: launch.address))
    }

    private func fromPanel(_ frame: WKFrameInfo) -> Bool {
        let origin = frame.securityOrigin
        return frame.isMainFrame && origin.protocol == "http" && origin.host == "127.0.0.1" && origin.port == panelPort
    }

    private func openGame(_ url: URL) {
        guard url.scheme == "http", url.host == "127.0.0.1", let port = url.port, port != panelPort,
              url.user == nil, url.password == nil, url.query == nil else { return }
        let room = url.path == "/" && url.fragment?.isEmpty == false
        let solo = url.path == "/solo" && url.fragment == nil
        guard room || solo else { return }
        NSWorkspace.shared.open(url)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard fromPanel(message.frameInfo), let address = message.body as? String, let url = URL(string: address) else { return }
        openGame(url)
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard fromPanel(message.frameInfo), let address = message.body as? String, let url = URL(string: address),
              url.scheme == "https", url.host?.hasSuffix(".trycloudflare.com") == true,
              url.path.hasPrefix("/access/"), url.user == nil, url.password == nil else {
            replyHandler(nil, "Invalid room invitation")
            return
        }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        replyHandler(nil, pasteboard.setString(address, forType: .string) ? nil : "Could not copy the room invitation")
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if action.navigationType == .linkActivated, fromPanel(action.sourceFrame), let url = action.request.url { openGame(url) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .cancel }
        if action.shouldPerformDownload && fromPanel(action.sourceFrame) { return .download }
        // A target-blank link is handled by the UI delegate above.
        if action.targetFrame == nil && fromPanel(action.sourceFrame) { return .allow }
        return url.scheme == "http" && url.host == "127.0.0.1" && url.port == panelPort && url.path == "/"
            ? .allow : .cancel
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String) async -> URL? {
        let save = NSSavePanel()
        save.nameFieldStringValue = suggestedFilename
        return await save.beginSheetModal(for: window) == .OK ? save.url : nil
    }
}
