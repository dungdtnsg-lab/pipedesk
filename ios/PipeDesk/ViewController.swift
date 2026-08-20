import UIKit
import WebKit
import LocalAuthentication
import AVFoundation

final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    private var webView: WKWebView!
    private var fileDestination: URL?
    private var nfcReader: CccdNfcReader?

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.043, green: 0.145, blue: 0.271, alpha: 1)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "saveFile")
        config.userContentController.add(self, name: "biometric")
        config.userContentController.add(self, name: "cccdScan")

        let webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.scrollView.bouncesZoom = false
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        view.addSubview(webView)
        self.webView = webView

        guard let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "www") else {
            return
        }
        webView.loadFileURL(index, allowingReadAccessTo: index.deletingLastPathComponent())
    }

    @available(iOS 15.0, *)
    func webView(
        _ webView: WKWebView,
        requestMediaCapturePermissionFor origin: WKSecurityOrigin,
        initiatedByFrame frame: WKFrameInfo,
        type: WKMediaCaptureType,
        decisionHandler: @escaping (WKPermissionDecision) -> Void
    ) {
        decisionHandler(.grant)
    }

    private func isExternal(_ url: URL) -> Bool {
        let scheme = (url.scheme ?? "").lowercased()
        if ["tel", "mailto", "sms", "zalo"].contains(scheme) { return true }
        if scheme == "http" || scheme == "https" {
            let host = (url.host ?? "").lowercased()
            if host.contains("zalo.me") { return true }
            if host.contains("google.com") { return true }
            if host.contains("maps.apple.com") { return true }
        }
        return false
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if navigationAction.shouldPerformDownload {
            decisionHandler(.download)
            return
        }
        if let url = navigationAction.request.url, isExternal(url) {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationResponse: WKNavigationResponse,
        decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void
    ) {
        if navigationResponse.canShowMIMEType {
            decisionHandler(.allow)
        } else {
            decisionHandler(.download)
        }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            UIApplication.shared.open(url)
        }
        return nil
    }

    func download(
        _ download: WKDownload,
        decideDestinationUsing response: URLResponse,
        suggestedFilename: String,
        completionHandler: @escaping (URL?) -> Void
    ) {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dest = docs.appendingPathComponent(suggestedFilename)
        try? FileManager.default.removeItem(at: dest)
        fileDestination = dest
        completionHandler(dest)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let dest = fileDestination else { return }
        shareFile(dest)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        if message.name == "cccdScan" {
            handleCccdScan(message.body)
            return
        }
        if message.name == "biometric" {
            let reason: String
            if let body = message.body as? [String: Any] {
                reason = String(body["reason"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            } else {
                reason = ""
            }
            authenticateOwner(reason: reason.isEmpty ? "Xác nhận xóa lead" : reason)
            return
        }
        guard message.name == "saveFile",
              let body = message.body as? [String: Any],
              let filename = body["filename"] as? String,
              let base64 = body["base64"] as? String,
              let data = Data(base64Encoded: base64) else { return }
        let dest = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(filename)
        do {
            try data.write(to: dest, options: .atomic)
            DispatchQueue.main.async { self.shareFile(dest) }
        } catch {
            return
        }
    }

    private func handleCccdScan(_ body: Any) {
        let dict = body as? [String: Any] ?? [:]
        let action = String(dict["action"] as? String ?? "qr")
        if action == "nfc" {
            startNfc(dict)
            return
        }
        if action == "photo" {
            startPhotoPicker()
            return
        }
        startQrScanner()
    }

    private func startQrScanner() {
        let scanner = CccdScannerViewController()
        scanner.modalPresentationStyle = .fullScreen
        scanner.onResult = { [weak self] raw in
            self?.replyCccd(ok: true, source: "qr", raw: raw, error: nil, data: nil)
        }
        scanner.onCancel = { [weak self] in
            self?.replyCccd(ok: false, source: "qr", raw: nil, error: "cancel", data: nil)
        }
        present(scanner, animated: true)
    }

    private func startPhotoPicker() {
        let picker = UIImagePickerController()
        picker.delegate = self
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            picker.sourceType = .camera
        } else {
            picker.sourceType = .photoLibrary
        }
        picker.allowsEditing = false
        present(picker, animated: true)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true) {
            self.replyCccd(ok: false, source: "photo", raw: nil, error: "cancel", data: nil)
        }
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        let image = info[.originalImage] as? UIImage
        picker.dismiss(animated: true) {
            if let image, let text = CccdScannerViewController.decode(image: image) {
                self.replyCccd(ok: true, source: "photo", raw: text, error: nil, data: nil)
            } else {
                self.replyCccd(ok: false, source: "photo", raw: nil, error: "Không đọc được QR trên ảnh. Chụp gần, rõ, tránh lóa.", data: nil)
            }
        }
    }

    private func startNfc(_ dict: [String: Any]) {
        let reader = CccdNfcReader()
        nfcReader = reader
        reader.onResult = { [weak self] payload in
            let ok = payload["ok"] as? Bool ?? false
            let raw = payload["raw"] as? String
            let error = payload["error"] as? String
            let data = payload["data"] as? [String: Any]
            self?.replyCccd(ok: ok, source: "nfc", raw: raw, error: error, data: data)
            self?.nfcReader = nil
        }
        reader.start(
            can: String(dict["can"] as? String ?? ""),
            cccd: String(dict["cccd"] as? String ?? ""),
            dob: String(dict["dob"] as? String ?? ""),
            expiry: String(dict["expiry"] as? String ?? "")
        )
    }

    private func jsString(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: "\\n")
            .replacingOccurrences(of: "\r", with: "")
    }

    private func replyCccd(ok: Bool, source: String, raw: String?, error: String?, data: [String: Any]?) {
        var obj: [String: Any] = [
            "ok": ok,
            "source": source
        ]
        if let raw { obj["raw"] = raw }
        if let error { obj["error"] = error }
        if let data { obj["data"] = data }
        guard let json = try? JSONSerialization.data(withJSONObject: obj),
              let text = String(data: json, encoding: .utf8) else { return }
        let js = "window.__cccdScanResult && window.__cccdScanResult(\(text))"
        DispatchQueue.main.async {
            self.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func authenticateOwner(reason: String) {
        let context = LAContext()
        context.localizedCancelTitle = "Hủy"
        context.localizedFallbackTitle = "Dùng mật mã máy"
        var authError: NSError?
        let policy: LAPolicy
        if context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &authError) {
            policy = .deviceOwnerAuthenticationWithBiometrics
        } else if context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) {
            policy = .deviceOwnerAuthentication
        } else {
            replyBiometric(ok: false, error: authError?.localizedDescription ?? "unavailable")
            return
        }
        context.evaluatePolicy(policy, localizedReason: reason) { success, error in
            DispatchQueue.main.async {
                self.replyBiometric(ok: success, error: error?.localizedDescription)
            }
        }
    }

    private func replyBiometric(ok: Bool, error: String?) {
        let escaped = (error ?? "")
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
        let js = "window.__pipedeskBiometricResult && window.__pipedeskBiometricResult(\(ok ? "true" : "false"), \"\(escaped)\")"
        webView?.evaluateJavaScript(js, completionHandler: nil)
    }

    private func shareFile(_ url: URL) {
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = view
        present(sheet, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptAlertPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping () -> Void
    ) {
        let alert = UIAlertController(title: "CRM D7", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptConfirmPanelWithMessage message: String,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (Bool) -> Void
    ) {
        let alert = UIAlertController(title: "CRM D7", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Hủy", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(
        _ webView: WKWebView,
        runJavaScriptTextInputPanelWithPrompt prompt: String,
        defaultText: String?,
        initiatedByFrame frame: WKFrameInfo,
        completionHandler: @escaping (String?) -> Void
    ) {
        let alert = UIAlertController(title: "CRM D7", message: prompt, preferredStyle: .alert)
        alert.addTextField { field in
            field.text = defaultText
            let lower = prompt.lowercased()
            field.isSecureTextEntry = lower.contains("mật") || lower.contains("password")
        }
        alert.addAction(UIAlertAction(title: "Hủy", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "OK", style: .default) { _ in
            completionHandler(alert.textFields?.first?.text)
        })
        present(alert, animated: true)
    }
}
