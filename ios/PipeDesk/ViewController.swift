import UIKit
import WebKit
import LocalAuthentication
import AVFoundation

final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var fileDestination: URL?

    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.957, green: 0.945, blue: 0.918, alpha: 1)

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.javaScriptCanOpenWindowsAutomatically = true
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")
        config.websiteDataStore = .default()
        config.userContentController.add(self, name: "saveFile")
        config.userContentController.add(self, name: "biometric")
        config.userContentController.add(self, name: "scanCccdQr")

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
        if message.name == "scanCccdQr" {
            presentCccdQrScanner()
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

    private func presentCccdQrScanner() {
        let scanner = CccdQrScannerViewController { [weak self] rawValue in
            guard let self else { return }
            guard let rawValue else {
                self.webView?.evaluateJavaScript("window.__pipedeskCccdQrCancelled && window.__pipedeskCccdQrCancelled()", completionHandler: nil)
                return
            }
            guard let data = try? JSONEncoder().encode(rawValue),
                  let jsonValue = String(data: data, encoding: .utf8) else { return }
            let js = "window.__pipedeskCccdQrResult && window.__pipedeskCccdQrResult(\(jsonValue))"
            self.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
        scanner.modalPresentationStyle = .fullScreen
        present(scanner, animated: true)
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


private final class CccdQrScannerViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    private let captureSession = AVCaptureSession()
    private let onFinish: (String?) -> Void
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var hasFinished = false

    init(onFinish: @escaping (String?) -> Void) {
        self.onFinish = onFinish
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        configureHeader()
        requestCameraAndStart()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func configureHeader() {
        let title = UILabel()
        title.translatesAutoresizingMaskIntoConstraints = false
        title.text = "Quét QR CCCD"
        title.textColor = .white
        title.font = .systemFont(ofSize: 20, weight: .semibold)

        let hint = UILabel()
        hint.translatesAutoresizingMaskIntoConstraints = false
        hint.text = "Đưa mã QR mặt trước thẻ vào khung hình"
        hint.textColor = .white
        hint.font = .systemFont(ofSize: 15)
        hint.textAlignment = .center
        hint.numberOfLines = 0

        let close = UIButton(type: .system)
        close.translatesAutoresizingMaskIntoConstraints = false
        close.setTitle("Hủy", for: .normal)
        close.tintColor = .white
        close.titleLabel?.font = .systemFont(ofSize: 17, weight: .medium)
        close.addTarget(self, action: #selector(cancel), for: .touchUpInside)

        view.addSubview(title)
        view.addSubview(hint)
        view.addSubview(close)
        NSLayoutConstraint.activate([
            title.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 20),
            title.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            close.centerYAnchor.constraint(equalTo: title.centerYAnchor),
            close.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            hint.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            hint.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
            hint.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -36)
        ])
    }

    private func requestCameraAndStart() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureScanner()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async {
                    granted ? self?.configureScanner() : self?.showCameraAccessError()
                }
            }
        default:
            showCameraAccessError()
        }
    }

    private func configureScanner() {
        guard captureSession.inputs.isEmpty,
              let camera = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: camera),
              captureSession.canAddInput(input) else {
            showCameraAccessError(message: "Không thể khởi động camera để quét QR.")
            return
        }
        captureSession.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard captureSession.canAddOutput(output) else {
            showCameraAccessError(message: "Không thể đọc mã QR trên thiết bị này.")
            return
        }
        captureSession.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: captureSession)
        preview.videoGravity = .resizeAspectFill
        preview.frame = view.bounds
        view.layer.insertSublayer(preview, at: 0)
        previewLayer = preview

        DispatchQueue.global(qos: .userInitiated).async { [captureSession] in
            captureSession.startRunning()
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard !hasFinished,
              let object = metadataObjects.compactMap({ $0 as? AVMetadataMachineReadableCodeObject }).first,
              let value = object.stringValue else { return }
        finish(value)
    }

    @objc private func cancel() {
        finish(nil)
    }

    private func finish(_ value: String?) {
        guard !hasFinished else { return }
        hasFinished = true
        if captureSession.isRunning { captureSession.stopRunning() }
        dismiss(animated: true) { [onFinish] in onFinish(value) }
    }

    private func showCameraAccessError(message: String = "Hãy cho phép quyền Camera trong Cài đặt để quét QR CCCD.") {
        let alert = UIAlertController(title: "Không mở được camera", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Đóng", style: .cancel) { [weak self] _ in self?.finish(nil) })
        present(alert, animated: true)
    }
}
