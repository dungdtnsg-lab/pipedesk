import UIKit
import WebKit
import LocalAuthentication
import AVFoundation
import PhotosUI
import UniformTypeIdentifiers
import Vision

final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler, PHPickerViewControllerDelegate {
    private var webView: WKWebView!
    private var fileDestination: URL?

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
        var configuration = PHPickerConfiguration(photoLibrary: .shared())
        configuration.filter = .images
        configuration.selectionLimit = 1
        let picker = PHPickerViewController(configuration: configuration)
        picker.delegate = self
        present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true) {
            guard let result = results.first else {
                self.replyCccd(ok: false, source: "photo", raw: nil, error: "cancel", data: nil)
                return
            }
            let provider = result.itemProvider
            guard provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) else {
                self.replyCccd(ok: false, source: "photo", raw: nil, error: "Ảnh không hợp lệ", data: nil)
                return
            }
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { [weak self] data, error in
                guard let self else { return }
                DispatchQueue.main.async {
                    guard let data else {
                        self.replyCccd(
                            ok: false,
                            source: "photo",
                            raw: nil,
                            error: error?.localizedDescription ?? "Không tải được ảnh từ thư viện",
                            data: nil
                        )
                        return
                    }
                    self.processCccdImage(data)
                }
            }
        }
    }

    private var cccdOCRAPIURL: URL? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: "CCCDOCRAPIURL") as? String else { return nil }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty, let url = URL(string: value), let scheme = url.scheme?.lowercased(), ["http", "https"].contains(scheme) else {
            return nil
        }
        return url
    }

    private func processCccdImage(_ data: Data) {
        let imageData = UIImage(data: data)?.jpegData(compressionQuality: 0.9) ?? data
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            if let image = UIImage(data: imageData), let text = CccdScannerViewController.decode(image: image) {
                self?.replyCccd(ok: true, source: "photo-qr", raw: text, error: nil, data: nil)
                return
            }
            if let endpoint = self?.cccdOCRAPIURL {
                self?.requestCccdOCR(endpoint: endpoint, imageData: imageData)
            } else {
                self?.recognizeCccdText(in: imageData)
            }
        }
    }

    private func requestCccdOCR(endpoint: URL, imageData: Data) {
        var request = URLRequest(url: endpoint, timeoutInterval: 35)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        let payload: [String: Any] = ["imageBase64": imageData.base64EncodedString()]
        guard let body = try? JSONSerialization.data(withJSONObject: payload) else {
            recognizeCccdText(in: imageData)
            return
        }
        request.httpBody = body
        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            guard let self else { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200...299).contains(status), let data,
                  let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let mapped = self.mapCccdOCR(object), !mapped.isEmpty else {
                self.recognizeCccdText(in: imageData)
                return
            }
            self.replyCccd(ok: true, source: "photo-api", raw: nil, error: nil, data: mapped)
        }.resume()
    }

    private func mapCccdOCR(_ object: [String: Any]) -> [String: Any]? {
        let values = (object["data"] as? [String: Any]) ?? object
        func string(_ keys: [String]) -> String? {
            for key in keys {
                if let value = values[key] as? String {
                    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !trimmed.isEmpty { return trimmed }
                } else if let value = values[key] as? NSNumber {
                    return value.stringValue
                }
            }
            return nil
        }

        var result: [String: Any] = [:]
        if let value = string(["ID_number", "id_number", "cccd", "CCCD"]) {
            let digits = value.filter { $0.isNumber }
            if !digits.isEmpty { result["cccd"] = digits }
        }
        if let value = string(["Name", "name", "customerName", "full_name"]) { result["customerName"] = value }
        if let value = string(["Date_of_birth", "date_of_birth", "dateOfBirth", "dob"]) { result["dateOfBirth"] = value }
        if let value = string(["Gender", "gender"]) { result["gender"] = value }
        if let value = string(["Nationality", "nationality"]) { result["nationality"] = value }
        if let value = string(["Place_of_residence", "place_of_residence", "fullAddress", "address"]) { result["fullAddress"] = value }
        if let value = string(["Place_of_origin", "place_of_origin"]) { result["placeOfOrigin"] = value }
        return result.isEmpty ? nil : result
    }

    private func recognizeCccdText(in data: Data) {
        guard let image = UIImage(data: data), let cgImage = image.cgImage else {
            replyCccd(ok: false, source: "photo", raw: nil, error: "Không đọc được ảnh CCCD", data: nil)
            return
        }
        let orientation = cgOrientation(for: image.imageOrientation)
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            if let supported = try? VNRecognizeTextRequest.supportedRecognitionLanguages(
                for: .accurate,
                revision: VNRecognizeTextRequest.currentRevision
            ) {
                request.recognitionLanguages = ["vi-VN", "en-US"].filter { supported.contains($0) }
            }
            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
            do {
                try handler.perform([request])
            } catch {
                DispatchQueue.main.async {
                    self?.replyCccd(ok: false, source: "photo", raw: nil, error: "Không nhận diện được chữ trên ảnh CCCD", data: nil)
                }
                return
            }
            let text = (request.results as? [VNRecognizedTextObservation] ?? [])
                .compactMap { $0.topCandidates(1).first?.string }
                .joined(separator: "\n")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            DispatchQueue.main.async {
                if text.isEmpty {
                    self?.replyCccd(ok: false, source: "photo", raw: nil, error: "Không nhận diện được chữ trên ảnh CCCD", data: nil)
                } else {
                    self?.replyCccd(ok: true, source: "photo-ocr", raw: text, error: nil, data: nil)
                }
            }
        }
    }

    private func cgOrientation(for orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch orientation {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
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
