import AVFoundation
import UIKit
import Vision

final class CccdScannerViewController: UIViewController, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureMetadataOutputObjectsDelegate, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    var onResult: ((String) -> Void)?
    var onCancel: (() -> Void)?

    private let session = AVCaptureSession()
    private let sessionQueue = DispatchQueue(label: "crmd7.qr.session")
    private let visionQueue = DispatchQueue(label: "crmd7.qr.vision")
    private var preview: AVCaptureVideoPreviewLayer?
    private var lastHandled = Date.distantPast
    private var didFinish = false
    private var torchOn = false
    private var captureDevice: AVCaptureDevice?
    private var currentZoom: CGFloat = 2.2

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        requestCameraAndStart()
        buildChrome()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        sessionQueue.async { self.session.stopRunning() }
    }

    private func buildChrome() {
        let title = UILabel()
        title.text = "Quét QR CCCD"
        title.textColor = .white
        title.font = .systemFont(ofSize: 18, weight: .semibold)
        title.translatesAutoresizingMaskIntoConstraints = false

        let hint = UILabel()
        hint.text = "Đưa góc QR dưới-phải mặt trước thẻ vào ô nhỏ. Giữ gần."
        hint.textColor = UIColor.white.withAlphaComponent(0.85)
        hint.font = .systemFont(ofSize: 13)
        hint.numberOfLines = 2
        hint.translatesAutoresizingMaskIntoConstraints = false

        let close = pillButton("Đóng", action: #selector(cancelTapped))
        let photo = pillButton("Ảnh QR", action: #selector(pickPhoto))
        let torch = pillButton("Đèn pin", action: #selector(toggleTorch))
        torch.tag = 21

        let frame = UIView()
        frame.layer.borderColor = UIColor.white.withAlphaComponent(0.92).cgColor
        frame.layer.borderWidth = 1.5
        frame.layer.cornerRadius = 12
        frame.backgroundColor = .clear
        frame.translatesAutoresizingMaskIntoConstraints = false

        let qrBox = UIView()
        qrBox.layer.borderColor = UIColor.white.cgColor
        qrBox.layer.borderWidth = 2
        qrBox.layer.cornerRadius = 4
        qrBox.translatesAutoresizingMaskIntoConstraints = false

        let zoomRow = UIStackView()
        zoomRow.axis = .horizontal
        zoomRow.spacing = 8
        zoomRow.translatesAutoresizingMaskIntoConstraints = false
        for (title, factor) in [("1×", 1.0), ("2×", 2.2), ("3×", 3.0)] as [(String, CGFloat)] {
            let btn = pillButton(title, action: #selector(zoomTapped(_:)))
            btn.tag = Int(factor * 10)
            if factor == 2.2 {
                btn.backgroundColor = UIColor.white
                btn.setTitleColor(UIColor(red: 0.04, green: 0.15, blue: 0.27, alpha: 1), for: .normal)
            }
            zoomRow.addArrangedSubview(btn)
        }

        view.addSubview(title)
        view.addSubview(hint)
        view.addSubview(close)
        view.addSubview(photo)
        view.addSubview(torch)
        view.addSubview(frame)
        view.addSubview(qrBox)
        view.addSubview(zoomRow)

        NSLayoutConstraint.activate([
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            close.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16),
            title.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 10),
            title.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            hint.topAnchor.constraint(equalTo: title.bottomAnchor, constant: 4),
            hint.leadingAnchor.constraint(equalTo: title.leadingAnchor),
            hint.trailingAnchor.constraint(equalTo: close.leadingAnchor, constant: -8),
            frame.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            frame.centerYAnchor.constraint(equalTo: view.centerYAnchor, constant: -18),
            frame.widthAnchor.constraint(equalTo: view.widthAnchor, multiplier: 0.86),
            frame.heightAnchor.constraint(equalTo: frame.widthAnchor, multiplier: 54.0 / 85.6),
            qrBox.widthAnchor.constraint(equalTo: frame.widthAnchor, multiplier: 0.22),
            qrBox.heightAnchor.constraint(equalTo: qrBox.widthAnchor),
            qrBox.trailingAnchor.constraint(equalTo: frame.trailingAnchor, constant: -14),
            qrBox.bottomAnchor.constraint(equalTo: frame.bottomAnchor, constant: -12),
            zoomRow.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            zoomRow.bottomAnchor.constraint(equalTo: photo.topAnchor, constant: -14),
            photo.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -18),
            photo.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 16),
            torch.centerYAnchor.constraint(equalTo: photo.centerYAnchor),
            torch.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -16)
        ])
    }

    private func pillButton(_ title: String, action: Selector) -> UIButton {
        let btn = UIButton(type: .system)
        btn.setTitle(title, for: .normal)
        btn.setTitleColor(.white, for: .normal)
        btn.titleLabel?.font = .systemFont(ofSize: 14, weight: .semibold)
        btn.backgroundColor = UIColor.white.withAlphaComponent(0.18)
        btn.layer.cornerRadius = 12
        btn.contentEdgeInsets = UIEdgeInsets(top: 10, left: 14, bottom: 10, right: 14)
        btn.addTarget(self, action: action, for: .touchUpInside)
        btn.translatesAutoresizingMaskIntoConstraints = false
        return btn
    }

    private func requestCameraAndStart() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            configureSession()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    if granted { self.configureSession() }
                    else { self.fail("Chưa cấp quyền camera") }
                }
            }
        default:
            fail("Vào Cài đặt → CRM D7 → bật Camera")
        }
    }

    private func configureSession() {
        sessionQueue.async {
            self.session.beginConfiguration()
            self.session.sessionPreset = .hd1920x1080
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                    ?? AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device) else {
                DispatchQueue.main.async { self.fail("Không mở được camera") }
                return
            }
            self.captureDevice = device
            if self.session.canAddInput(input) { self.session.addInput(input) }
            try? device.lockForConfiguration()
            if device.isFocusModeSupported(.continuousAutoFocus) {
                device.focusMode = .continuousAutoFocus
            }
            if device.isExposureModeSupported(.continuousAutoExposure) {
                device.exposureMode = .continuousAutoExposure
            }
            let maxZoom = min(device.activeFormat.videoMaxZoomFactor, 5)
            device.videoZoomFactor = min(max(2.2, 1), maxZoom)
            device.unlockForConfiguration()

            let output = AVCaptureVideoDataOutput()
            output.alwaysDiscardsLateVideoFrames = true
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.setSampleBufferDelegate(self, queue: self.visionQueue)
            if self.session.canAddOutput(output) { self.session.addOutput(output) }
            output.connection(with: .video)?.videoOrientation = .portrait

            let meta = AVCaptureMetadataOutput()
            if self.session.canAddOutput(meta) {
                self.session.addOutput(meta)
                meta.setMetadataObjectsDelegate(self, queue: DispatchQueue.main)
                meta.metadataObjectTypes = meta.availableMetadataObjectTypes.filter {
                    [.qr, .pdf417, .aztec, .dataMatrix].contains($0)
                }
            }
            self.session.commitConfiguration()

            DispatchQueue.main.async {
                let layer = AVCaptureVideoPreviewLayer(session: self.session)
                layer.videoGravity = .resizeAspectFill
                layer.frame = self.view.bounds
                self.view.layer.insertSublayer(layer, at: 0)
                self.preview = layer
            }
            self.session.startRunning()
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
              let text = obj.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines),
              !text.isEmpty else { return }
        finish(text)
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if didFinish { return }
        if Date().timeIntervalSince(lastHandled) < 0.28 { return }
        lastHandled = Date()
        guard let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        detect(pixelBuffer: pixel)
    }

    private func detect(pixelBuffer: CVPixelBuffer) {
        let request = VNDetectBarcodesRequest { [weak self] req, _ in
            guard let self else { return }
            let payloads = (req.results as? [VNBarcodeObservation] ?? [])
                .compactMap { $0.payloadStringValue }
                .filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
            if let text = payloads.first {
                self.finish(text)
            }
        }
        if #available(iOS 15.0, *) {
            request.symbologies = [.qr, .pdf417, .aztec, .dataMatrix, .microQR]
        } else {
            request.symbologies = [.qr, .pdf417, .aztec, .dataMatrix]
        }
        let handler = VNImageRequestHandler(cvPixelBuffer: pixelBuffer, orientation: .right)
        try? handler.perform([request])
    }

    @objc func pickPhoto() {
        let picker = UIImagePickerController()
        picker.delegate = self
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.allowsEditing = false
        present(picker, animated: true)
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
    }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        let image = (info[.originalImage] as? UIImage)
        picker.dismiss(animated: true) {
            guard let image else { return }
            if let text = Self.decode(image: image) {
                self.finish(text)
            } else {
                self.alert("Không đọc được QR trên ảnh. Chụp gần, rõ nét, tránh lóa.")
            }
        }
    }

    static func decode(image: UIImage) -> String? {
        guard let cg = image.cgImage else { return nil }
        let orientations: [CGImagePropertyOrientation] = [.up, .right, .down, .left]
        for orientation in orientations {
            let request = VNDetectBarcodesRequest()
            if #available(iOS 15.0, *) {
                request.symbologies = [.qr, .pdf417, .aztec, .dataMatrix, .microQR]
            } else {
                request.symbologies = [.qr, .pdf417, .aztec, .dataMatrix]
            }
            let handler = VNImageRequestHandler(cgImage: cg, orientation: orientation)
            try? handler.perform([request])
            if let text = request.results?.compactMap({ $0.payloadStringValue }).first, !text.isEmpty {
                return text
            }
        }
        return nil
    }

    @objc private func zoomTapped(_ sender: UIButton) {
        applyZoom(CGFloat(sender.tag) / 10)
        for case let btn as UIButton in view.subviews.flatMap({ ($0 as? UIStackView)?.arrangedSubviews ?? [] }) {
            let active = btn.tag == sender.tag && btn.tag >= 10
            if active {
                btn.backgroundColor = .white
                btn.setTitleColor(UIColor(red: 0.04, green: 0.15, blue: 0.27, alpha: 1), for: .normal)
            } else if btn.tag >= 10 && btn.tag <= 30 {
                btn.backgroundColor = UIColor.white.withAlphaComponent(0.18)
                btn.setTitleColor(.white, for: .normal)
            }
        }
    }

    private func applyZoom(_ factor: CGFloat) {
        guard let device = captureDevice else { return }
        let maxZ = min(device.activeFormat.videoMaxZoomFactor, 5)
        let z = min(max(factor, 1), maxZ)
        try? device.lockForConfiguration()
        device.videoZoomFactor = z
        device.unlockForConfiguration()
        currentZoom = z
    }

    @objc private func toggleTorch() {
        guard let device = AVCaptureDevice.default(for: .video), device.hasTorch else { return }
        try? device.lockForConfiguration()
        torchOn.toggle()
        device.torchMode = torchOn ? .on : .off
        device.unlockForConfiguration()
    }

    @objc private func cancelTapped() {
        guard !didFinish else { return }
        didFinish = true
        sessionQueue.async { self.session.stopRunning() }
        dismiss(animated: true) { self.onCancel?() }
    }

    private func finish(_ text: String) {
        guard !didFinish else { return }
        didFinish = true
        sessionQueue.async { self.session.stopRunning() }
        DispatchQueue.main.async {
            self.dismiss(animated: true) { self.onResult?(text) }
        }
    }

    private func fail(_ message: String) {
        alert(message)
    }

    private func alert(_ message: String) {
        let alert = UIAlertController(title: "CRM D7", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "OK", style: .default))
        present(alert, animated: true)
    }
}
