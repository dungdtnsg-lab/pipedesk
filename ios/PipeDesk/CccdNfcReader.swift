import Foundation
import CoreNFC
import CommonCrypto

final class CccdNfcReader: NSObject, NFCTagReaderSessionDelegate {
    var onResult: (([String: Any]) -> Void)?

    private var session: NFCTagReaderSession?
    private var can = ""
    private var cccd = ""
    private var dob = ""
    private var expiry = ""
    private var finished = false

    func start(can: String, cccd: String, dob: String, expiry: String) {
        self.can = can.replacingOccurrences(of: "\\D", with: "", options: .regularExpression)
        self.cccd = cccd.replacingOccurrences(of: "\\D", with: "", options: .regularExpression)
        self.dob = dob
        self.expiry = expiry
        finished = false

        guard NFCTagReaderSession.readingAvailable else {
            complete(ok: false, error: "Máy này không hỗ trợ NFC.")
            return
        }
        let session = NFCTagReaderSession(pollingOption: [.iso14443], delegate: self, queue: nil)
        session.alertMessage = "Chạm mép trên iPhone vào thẻ CCCD và giữ yên"
        self.session = session
        session.begin()
    }

    func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        if finished { return }
        let ns = error as NSError
        if ns.code == 200 || ns.code == 6 {
            complete(ok: false, error: "cancel")
            return
        }
        complete(ok: false, error: humanNfcError(error))
    }

    func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard let tag = tags.first else { return }
        if tags.count > 1 {
            session.alertMessage = "Nhiều thẻ — chỉ để 1 thẻ CCCD"
            session.restartPolling()
            return
        }
        session.connect(to: tag) { error in
            if let error {
                session.invalidate(errorMessage: error.localizedDescription)
                return
            }
            guard case let .iso7816(iso) = tag else {
                session.invalidate(errorMessage: "Thẻ không phải CCCD chip (ISO 7816)")
                return
            }
            Task { await self.read(iso: iso, session: session) }
        }
    }

    private func read(iso: NFCISO7816Tag, session: NFCTagReaderSession) async {
        do {
            _ = try await transceive(iso, "00A4040C07A0000002471001")
            let bacOk = await tryBac(iso: iso)
            if !bacOk {
                throw NSError(domain: "CRM D7", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: nfcHelpMessage()
                ])
            }
            let dg1 = try await readFile(iso, "0101")
            guard let parsed = Self.parseDG1(dg1) else {
                throw NSError(domain: "CRM D7", code: 2, userInfo: [
                    NSLocalizedDescriptionKey: "Đã kết nối chip nhưng không đọc được DG1."
                ])
            }
            var extra: [String: Any] = [:]
            if let dg13 = try? await readFile(iso, "010D") {
                extra = Self.parseDG13(dg13)
            }
            session.alertMessage = "Đọc CCCD thành công"
            session.invalidate()
            var data = parsed
            for (k, v) in extra where data[k] == nil { data[k] = v }
            finished = true
            onResult?(["ok": true, "source": "nfc", "data": data, "raw": data["raw"] as? String ?? ""])
        } catch {
            session.invalidate(errorMessage: error.localizedDescription)
        }
    }

    private func nfcHelpMessage() -> String {
        if can.count == 6 {
            return "Chip yêu cầu PACE/CAN. Nếu CAN đúng mà vẫn lỗi, sideload Apple ID miễn phí thường không được quyền NFC — dùng Quét QR hoặc Ảnh QR."
        }
        if cccd.count == 12, !dob.isEmpty, !expiry.isEmpty {
            return "BAC thất bại. Kiểm tra số CCCD, ngày sinh, ngày hết hạn trên thẻ rồi thử lại, hoặc dùng Quét QR."
        }
        return "Điền CAN 6 số (mặt trước) hoặc số CCCD + ngày sinh + ngày hết hạn rồi đọc NFC. Nếu không được, dùng Quét QR."
    }

    private func tryBac(iso: NFCISO7816Tag) async -> Bool {
        let yyMMdd: (String) -> String = { isoDate in
            let d = isoDate.replacingOccurrences(of: "-", with: "")
            if d.count == 8 { return String(d.suffix(6)) }
            return d
        }
        var candidates: [String] = []
        if cccd.count >= 9 {
            candidates.append(String(cccd.prefix(9)))
            if cccd.count == 12 { candidates.append(cccd) }
        }
        let dobKey = yyMMdd(dob)
        let expKey = yyMMdd(expiry)
        guard dobKey.count == 6, expKey.count == 6, !candidates.isEmpty else { return false }

        for doc in candidates {
            if await bacOnce(iso: iso, doc: doc, dob: dobKey, expiry: expKey) {
                return true
            }
        }
        return false
    }

    // MARK: - BAC (ICAO 9303)

    private var ksenc = Data()
    private var ksmac = Data()
    private var ssc = Data()

    private func bacOnce(iso: NFCISO7816Tag, doc: String, dob: String, expiry: String) async -> Bool {
        do {
            let padded = doc.padding(toLength: 9, withPad: "<", startingAt: 0)
            let mrz = padded + Self.checkDigit(padded) + dob + Self.checkDigit(dob) + expiry + Self.checkDigit(expiry)
            let kseed = Self.sha1(Data(mrz.utf8)).prefix(16)
            let kenc = Self.deriveKey(Data(kseed), counter: 1)
            let kmac = Self.deriveKey(Data(kseed), counter: 2)
            let challenge = try await transceive(iso, "0084000008")
            guard challenge.count >= 8 else { return false }
            let rndICC = Data(challenge.prefix(8))
            var rndIFD = Data((0..<8).map { _ in UInt8.random(in: 0...255) })
            var kifd = Data((0..<16).map { _ in UInt8.random(in: 0...255) })
            let s = rndIFD + rndICC + kifd
            let eifd = Self.tripleDESEncrypt(s, key: kenc)
            let mifd = Self.retailMAC(eifd, key: kmac)
            let cmd = Data([0x00, 0x82, 0x00, 0x00, 0x28]) + eifd + mifd + Data([0x28])
            let resp = try await transceiveData(iso, cmd)
            guard resp.count >= 40 else { return false }
            let eicc = Data(resp.prefix(32))
            let mac = Data(resp.dropFirst(32).prefix(8))
            let calc = Self.retailMAC(eicc, key: kmac)
            guard mac == calc else { return false }
            let plain = Self.tripleDESDecrypt(eicc, key: kenc)
            guard plain.count >= 32 else { return false }
            let kicc = Data(plain.suffix(16))
            var xored = Data()
            for i in 0..<16 { xored.append(kifd[i] ^ kicc[i]) }
            ksenc = Self.deriveKey(xored, counter: 1)
            ksmac = Self.deriveKey(xored, counter: 2)
            ssc = Data(rndICC.suffix(4) + rndIFD.suffix(4))
            return true
        } catch {
            return false
        }
    }

    private func readFile(_ iso: NFCISO7816Tag, _ fid: String) async throws -> Data {
        _ = try await sm(iso, Data([0x00, 0xA4, 0x02, 0x0C, 0x02]) + Self.hex(fid))
        var offset = 0
        var body = Data()
        let header = try await sm(iso, Data([0x00, 0xB0, 0x00, 0x00, 0x04]))
        guard header.count >= 4 else { throw nfcErr("DG rỗng") }
        var length = Int(header[1])
        var headerSkip = 2
        if header[1] > 0x80 {
            let n = Int(header[1] & 0x7F)
            length = 0
            for i in 0..<n { length = (length << 8) + Int(header[2 + i]) }
            headerSkip = 2 + n
        }
        body = header
        offset = header.count
        while offset < headerSkip + length {
            let want = min(0xE0, headerSkip + length - offset)
            let chunk = try await sm(iso, Data([0x00, 0xB0, UInt8((offset >> 8) & 0xFF), UInt8(offset & 0xFF), UInt8(want)]))
            if chunk.isEmpty { break }
            body.append(chunk)
            offset += chunk.count
        }
        return body
    }

    private func sm(_ iso: NFCISO7816Tag, _ apdu: Data) async throws -> Data {
        incrementSSC()
        var cmd = Data(apdu)
        if cmd.count < 5 { cmd.append(0) }
        let ins = cmd[1]
        let p1 = cmd[2]
        let p2 = cmd[3]
        let lc = cmd.count > 4 ? Int(cmd[4]) : 0
        let data = lc > 0 && cmd.count >= 5 + lc ? Data(cmd[5..<(5 + lc)]) : Data()
        let le = UInt8((ins == 0xB0) ? (cmd.last ?? 0) : 0)

        var do97 = Data()
        if ins == 0xB0 { do97 = Data([0x97, 0x01, le == 0 ? 0x00 : le]) }
        var do87 = Data()
        if !data.isEmpty {
            let enc = Self.tripleDESEncrypt(Self.pad80(data), key: ksenc)
            do87 = Data([0x87, UInt8(enc.count + 1), 0x01]) + enc
        }
        let masked = Data([0x0C, ins, p1, p2])
        let maced = Self.pad80(ssc + masked + do87 + do97)
        let mac = Self.retailMAC(maced, key: ksmac)
        var body = do87 + do97 + Data([0x8E, 0x08]) + mac
        let protected = Data([0x0C, ins, p1, p2, UInt8(body.count)]) + body + Data([0x00])
        let resp = try await transceiveData(iso, protected)
        return try unwrapSM(resp)
    }

    private func unwrapSM(_ resp: Data) throws -> Data {
        incrementSSC()
        var i = 0
        var do87 = Data()
        var sw = Data()
        while i + 1 < resp.count {
            let tag = resp[i]
            if tag == 0x87 {
                let len = Int(resp[i + 1])
                if i + 2 + len <= resp.count {
                    let val = Data(resp[(i + 2)..<(i + 2 + len)])
                    if val.first == 0x01 { do87 = Data(val.dropFirst()) }
                    i += 2 + len
                    continue
                }
            }
            if tag == 0x99 {
                let len = Int(resp[i + 1])
                sw = Data(resp[(i + 2)..<(i + 2 + len)])
                i += 2 + len
                continue
            }
            if tag == 0x8E {
                i += 2 + Int(resp[i + 1])
                continue
            }
            i += 1
        }
        if do87.isEmpty { return Data() }
        let plain = Self.tripleDESDecrypt(do87, key: ksenc)
        return Self.unpad80(plain)
    }

    private func incrementSSC() {
        guard !ssc.isEmpty else { return }
        var bytes = [UInt8](ssc)
        for i in stride(from: bytes.count - 1, through: 0, by: -1) {
            if bytes[i] == 0xFF { bytes[i] = 0 }
            else { bytes[i] += 1; break }
        }
        ssc = Data(bytes)
    }

    private func transceive(_ iso: NFCISO7816Tag, _ hex: String) async throws -> Data {
        try await transceiveData(iso, Self.hex(hex))
    }

    private func transceiveData(_ iso: NFCISO7816Tag, _ data: Data) async throws -> Data {
        guard let apdu = NFCISO7816APDU(data: data) else { throw nfcErr("APDU lỗi") }
        return try await withCheckedThrowingContinuation { cont in
            iso.sendCommand(apdu: apdu) { response, sw1, sw2, error in
                if let error {
                    cont.resume(throwing: error)
                    return
                }
                if sw1 == 0x90 && sw2 == 0x00 {
                    cont.resume(returning: response)
                    return
                }
                if sw1 == 0x61 {
                    let get = Data([0x00, 0xC0, 0x00, 0x00, sw2])
                    if let more = NFCISO7816APDU(data: get) {
                        iso.sendCommand(apdu: more) { extra, s1, s2, err in
                            if let err { cont.resume(throwing: err); return }
                            if s1 == 0x90 && s2 == 0x00 { cont.resume(returning: response + extra) }
                            else { cont.resume(throwing: self.nfcErr(String(format: "SW %02X%02X", s1, s2))) }
                        }
                        return
                    }
                }
                cont.resume(throwing: self.nfcErr(String(format: "Chip trả %02X%02X", sw1, sw2)))
            }
        }
    }

    private func complete(ok: Bool, error: String) {
        if finished { return }
        finished = true
        DispatchQueue.main.async {
            self.onResult?(["ok": ok, "source": "nfc", "error": error])
        }
    }

    private func nfcErr(_ message: String) -> NSError {
        NSError(domain: "CRM D7", code: 9, userInfo: [NSLocalizedDescriptionKey: message])
    }

    private func humanNfcError(_ error: Error) -> String {
        let text = error.localizedDescription.lowercased()
        if text.contains("entitlement") || text.contains("not allowed") || text.contains("permission") {
            return "iOS chưa cấp quyền NFC. Sideload Apple ID miễn phí thường bị chặn — dùng Quét QR / Ảnh QR, hoặc ký app bằng tài khoản Developer có NFC Tag Reading."
        }
        return error.localizedDescription
    }

    // MARK: Crypto helpers

    static func hex(_ string: String) -> Data {
        var s = string.replacingOccurrences(of: " ", with: "")
        var data = Data()
        var idx = s.startIndex
        while idx < s.endIndex {
            let next = s.index(idx, offsetBy: 2)
            if let b = UInt8(s[idx..<next], radix: 16) { data.append(b) }
            idx = next
        }
        return data
    }

    static func sha1(_ data: Data) -> Data {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA1_DIGEST_LENGTH))
        data.withUnsafeBytes { ptr in
            _ = CC_SHA1(ptr.baseAddress, CC_LONG(data.count), &hash)
        }
        return Data(hash)
    }

    static func checkDigit(_ input: String) -> String {
        let weights = [7, 3, 1]
        var sum = 0
        for (i, ch) in input.uppercased().enumerated() {
            let v: Int
            if ch == "<" { v = 0 }
            else if let d = ch.wholeNumberValue { v = d }
            else if ch >= "A" && ch <= "Z" { v = Int(ch.asciiValue! - 55) }
            else { v = 0 }
            sum += v * weights[i % 3]
        }
        return String(sum % 10)
    }

    static func adjustParity(_ bytes: Data) -> Data {
        Data(bytes.map { b -> UInt8 in
            var v = b & 0xFE
            let ones = (0..<8).reduce(0) { $0 + Int((v >> $1) & 1) }
            if ones % 2 == 0 { v |= 1 }
            return v
        })
    }

    static func deriveKey(_ kseed: Data, counter: UInt8) -> Data {
        let hash = sha1(kseed + Data([0, 0, 0, counter]))
        let ka = adjustParity(hash.prefix(8))
        let kb = adjustParity(hash.dropFirst(8).prefix(8))
        return ka + kb
    }

    static func tripleDESKey24(_ key16: Data) -> Data {
        let k1 = key16.prefix(8)
        let k2 = key16.suffix(8)
        return k1 + k2 + k1
    }

    static func tripleDESEncrypt(_ data: Data, key: Data) -> Data {
        cbc(data, key: key, encrypt: true, pad: data.count % 8 != 0)
    }

    static func tripleDESDecrypt(_ data: Data, key: Data) -> Data {
        cbc(data, key: key, encrypt: false, pad: false)
    }

    static func crypt3DES(_ data: Data, key: Data, op: CCOperation) -> Data {
        cbc(data, key: key, encrypt: op == CCOperation(kCCEncrypt), pad: false)
    }

    static func cbc(_ data: Data, key: Data, encrypt: Bool, pad: Bool) -> Data {
        let key24 = [UInt8](tripleDESKey24(key))
        var input = [UInt8](pad && encrypt ? pad80(data) : data)
        if input.count % 8 != 0 && encrypt {
            input = [UInt8](pad80(Data(input)))
        }
        var prev = [UInt8](repeating: 0, count: 8)
        var output = [UInt8]()
        var offset = 0
        while offset + 8 <= input.count {
            var block = Array(input[offset..<(offset + 8)])
            if encrypt {
                for i in 0..<8 { block[i] ^= prev[i] }
            }
            var out = [UInt8](repeating: 0, count: 8)
            var moved = 0
            CCCrypt(
                CCOperation(encrypt ? kCCEncrypt : kCCDecrypt),
                CCAlgorithm(kCCAlgorithm3DES),
                CCOptions(kCCOptionECBMode),
                key24, 24,
                nil,
                block, 8,
                &out, 8,
                &moved
            )
            if encrypt {
                prev = out
            } else {
                for i in 0..<8 { out[i] ^= prev[i] }
                prev = block
            }
            output.append(contentsOf: out)
            offset += 8
        }
        return Data(output)
    }

    static func pad80(_ data: Data) -> Data {
        var out = data + Data([0x80])
        while out.count % 8 != 0 { out.append(0) }
        return out
    }

    static func unpad80(_ data: Data) -> Data {
        var bytes = [UInt8](data)
        while let last = bytes.last, last == 0 { bytes.removeLast() }
        if bytes.last == 0x80 { bytes.removeLast() }
        return Data(bytes)
    }

    static func retailMAC(_ data: Data, key: Data) -> Data {
        let k1 = [UInt8](key.prefix(8))
        let k2 = [UInt8](key.suffix(8))
        let padded = [UInt8](pad80(data))
        var h = [UInt8](repeating: 0, count: 8)
        var offset = 0
        while offset < padded.count {
            var block = Array(padded[offset..<(offset + 8)])
            for i in 0..<8 { block[i] ^= h[i] }
            h = des(block, key: k1, encrypt: true)
            offset += 8
        }
        let y = des(h, key: k2, encrypt: false)
        let mac = des(y, key: k1, encrypt: true)
        return Data(mac)
    }

    static func des(_ block: [UInt8], key: [UInt8], encrypt: Bool) -> [UInt8] {
        var out = [UInt8](repeating: 0, count: 8)
        var moved = 0
        CCCrypt(
            CCOperation(encrypt ? kCCEncrypt : kCCDecrypt),
            CCAlgorithm(kCCAlgorithmDES),
            CCOptions(kCCOptionECBMode),
            key, 8,
            nil,
            block, 8,
            &out, 8,
            &moved
        )
        return out
    }

    static func parseDG1(_ data: Data) -> [String: Any]? {
        guard let idx = data.firstIndex(of: 0x5F) else { return parseMRZ(String(bytes: data, encoding: .ascii) ?? "") }
        var i = idx
        let bytes = [UInt8](data)
        if i + 2 < bytes.count, bytes[i] == 0x5F, bytes[i + 1] == 0x1F {
            let len = Int(bytes[i + 2])
            let start = i + 3
            if start + len <= bytes.count {
                let mrz = String(bytes: bytes[start..<(start + len)], encoding: .ascii) ?? ""
                return parseMRZ(mrz)
            }
        }
        return parseMRZ(String(bytes: data, encoding: .ascii) ?? "")
    }

    static func parseMRZ(_ mrz: String) -> [String: Any]? {
        let compact = mrz.replacingOccurrences(of: "\r", with: "").replacingOccurrences(of: "\n", with: "")
        guard compact.count >= 90 else { return nil }
        let line1 = String(compact.prefix(30))
        let line2 = String(compact.dropFirst(30).prefix(30))
        let line3 = String(compact.dropFirst(60).prefix(30))
        let doc9 = line1.dropFirst(5).prefix(9).replacingOccurrences(of: "<", with: "")
        let optional = (String(line1.dropFirst(15)) + String(line2.dropFirst(18).prefix(11)))
            .replacingOccurrences(of: "<", with: "")
        var id = (doc9 + optional).replacingOccurrences(of: "[^0-9]", with: "", options: .regularExpression)
        if id.count > 12 { id = String(id.prefix(12)) }
        if id.count < 12, let match = compact.range(of: "\\d{12}", options: .regularExpression) {
            id = String(compact[match])
        }
        func sixToIso(_ s: String) -> String {
            guard s.count == 6 else { return "" }
            let yy = Int(s.prefix(2)) ?? 0
            let year = yy >= 40 ? 1900 + yy : 2000 + yy
            return String(format: "%04d-%@-%@", year, String(s.dropFirst(2).prefix(2)), String(s.suffix(2)))
        }
        let dob = sixToIso(String(line2.prefix(6)))
        let sexChar = line2.dropFirst(7).prefix(1)
        let expiry = sixToIso(String(line2.dropFirst(8).prefix(6)))
        let nameRaw = line3.replacingOccurrences(of: "<", with: " ").replacingOccurrences(of: " +", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces)
        let parts = nameRaw.split(separator: " ").map(String.init)
        let name = parts.joined(separator: " ")
        let raw = [id, "", name, dob.replacingOccurrences(of: "-", with: ""), sexChar == "M" ? "Nam" : "Nữ", "", "", expiry].joined(separator: "|")
        return [
            "cccd": id,
            "customerName": name,
            "dateOfBirth": dob,
            "gender": sexChar == "M" ? "Nam" : (sexChar == "F" ? "Nữ" : ""),
            "nationality": "Việt Nam",
            "idExpiryDate": expiry,
            "raw": raw
        ]
    }

    static func parseDG13(_ data: Data) -> [String: Any] {
        var out: [String: Any] = [:]
        let bytes = [UInt8](data)
        var i = 0
        while i + 1 < bytes.count {
            if bytes[i] == 0x80 || bytes[i] == 0x5F {
                i += 1
                continue
            }
            i += 1
        }
        if let text = String(bytes: data, encoding: .utf8) ?? String(bytes: data, encoding: .ascii) {
            let parts = text.split(whereSeparator: { $0 == "|" || $0 == "\u{1E}" }).map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            if let addr = parts.first(where: { $0.count > 12 && $0.contains(" ") }) {
                out["fullAddress"] = addr
            }
        }
        return out
    }
}
