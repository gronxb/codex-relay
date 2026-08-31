//
//  HybridDirectFetch.swift
//  Pods
//
//  Created by  on 4/29/2026.
//

import Foundation
import Network
import NitroModules

private final class HttpBodyStreamDecoder {
    private var buffer = Data()
    private let contentLength: Int?
    private let isChunked: Bool
    private(set) var body = Data()
    private(set) var isComplete = false

    init(headers: [[String: String]]) {
        contentLength = HybridDirectFetch.headerValue("content-length", in: headers).flatMap(Int.init)
        isChunked = HybridDirectFetch.headerValue("transfer-encoding", in: headers)?
            .lowercased()
            .contains("chunked") == true
    }

    func append(_ data: Data) -> [Data] {
        guard !isComplete, !data.isEmpty else {
            return []
        }

        if isChunked {
            return appendChunked(data)
        }

        body.append(data)
        if let contentLength, body.count >= contentLength {
            isComplete = true
        }
        return [data]
    }

    private func appendChunked(_ data: Data) -> [Data] {
        buffer.append(data)
        var emitted: [Data] = []

        while true {
            guard let lineRange = buffer.range(of: Data("\r\n".utf8)) else {
                return emitted
            }
            let sizeData = buffer.subdata(in: buffer.startIndex..<lineRange.lowerBound)
            guard
                let sizeLine = String(data: sizeData, encoding: .ascii),
                let size = Int(sizeLine.split(separator: ";", maxSplits: 1)[0], radix: 16)
            else {
                return emitted
            }

            let payloadStart = lineRange.upperBound
            if size == 0 {
                isComplete = true
                buffer.removeAll(keepingCapacity: false)
                return emitted
            }

            let payloadEnd = payloadStart + size
            let chunkEnd = payloadEnd + 2
            guard chunkEnd <= buffer.endIndex else {
                return emitted
            }

            let chunk = buffer.subdata(in: payloadStart..<payloadEnd)
            body.append(chunk)
            emitted.append(chunk)
            buffer.removeSubrange(buffer.startIndex..<chunkEnd)
        }
    }
}

class HybridDirectFetch: HybridDirectFetchSpec {
    func fetch(request: DirectFetchRequest) throws -> Promise<DirectFetchResponse> {
        let promise = Promise<DirectFetchResponse>()

        Task {
            do {
                let response = try await Self.performRequest(request)
                promise.resolve(withResult: response)
            } catch {
                promise.reject(withError: error)
            }
        }

        return promise
    }

    func download(request: DirectFetchDownloadRequest) throws -> Promise<DirectFetchDownloadResponse> {
        let promise = Promise<DirectFetchDownloadResponse>()

        Task {
            do {
                let response = try await Self.performDownloadRequest(request)
                promise.resolve(withResult: response)
            } catch {
                promise.reject(withError: error)
            }
        }

        return promise
    }

    func stream(
        request: DirectFetchRequest,
        onChunk: @escaping (DirectFetchStreamChunk) -> Void
    ) throws -> Promise<DirectFetchResponse> {
        let promise = Promise<DirectFetchResponse>()

        Task {
            do {
                let response = try await Self.performStreamingRequest(request, onChunk: onChunk)
                promise.resolve(withResult: response)
            } catch {
                promise.reject(withError: error)
            }
        }

        return promise
    }

    private static func performRequest(_ request: DirectFetchRequest) async throws -> DirectFetchResponse {
        guard let url = URL(string: request.url) else {
            throw Self.error(code: 1, message: "Invalid URL: \(request.url)")
        }

        if url.scheme?.lowercased() == "http" {
            return try await Self.performRawHttpRequest(request, url: url)
        }

        return try await Self.performUrlSessionRequest(request, url: url)
    }

    private static func performDownloadRequest(
        _ request: DirectFetchDownloadRequest
    ) async throws -> DirectFetchDownloadResponse {
        guard let url = URL(string: request.url) else {
            throw Self.error(code: 1, message: "Invalid URL: \(request.url)")
        }

        do {
            return try await Self.withTimeout(request.timeoutMs) {
                try await Self.performUrlSessionDownloadRequest(request, url: url)
            }
        } catch {
            if url.scheme?.lowercased() == "http" {
                return try await Self.performRawHttpDownloadRequest(request, url: url)
            }
            throw error
        }
    }

    private static func performStreamingRequest(
        _ request: DirectFetchRequest,
        onChunk: @escaping (DirectFetchStreamChunk) -> Void
    ) async throws -> DirectFetchResponse {
        guard let url = URL(string: request.url) else {
            throw Self.error(code: 1, message: "Invalid URL: \(request.url)")
        }

        if url.scheme?.lowercased() == "http" {
            return try await Self.performRawHttpStreamRequest(request, url: url, onChunk: onChunk)
        }

        return try await Self.withTimeout(request.timeoutMs) {
            try await Self.performUrlSessionStreamRequest(request, url: url, onChunk: onChunk)
        }
    }

    private static func performUrlSessionRequest(
        _ request: DirectFetchRequest,
        url: URL
    ) async throws -> DirectFetchResponse {
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = (request.method ?? "GET").uppercased()
        if let timeoutMs = request.timeoutMs, timeoutMs > 0 {
            urlRequest.timeoutInterval = timeoutMs / 1000
        }
        for header in Self.decodeHeaders(request.headersJson) {
            urlRequest.setValue(header.value, forHTTPHeaderField: header.key)
        }
        if let parts = request.bodyFormData, !parts.isEmpty {
            let (body, contentType) = try Self.buildMultipartBody(parts)
            urlRequest.httpBody = body
            urlRequest.setValue(contentType, forHTTPHeaderField: "Content-Type")
        } else if let bodyString = request.bodyString {
            urlRequest.httpBody = Data(bodyString.utf8)
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.allowsCellularAccess = true
        configuration.allowsConstrainedNetworkAccess = true
        configuration.allowsExpensiveNetworkAccess = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.connectionProxyDictionary = [:]

        let session = URLSession(configuration: configuration)
        defer {
            session.finishTasksAndInvalidate()
        }

        let (data, response) = try await session.data(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw Self.error(code: 2, message: "Server returned a non-HTTP response.")
        }

        let headers = httpResponse.allHeaderFields.compactMap { key, value -> [String: String]? in
            guard let key = key as? String else {
                return nil
            }
            return ["key": key, "value": String(describing: value)]
        }

        return DirectFetchResponse(
            url: httpResponse.url?.absoluteString ?? request.url,
            status: Double(httpResponse.statusCode),
            statusText: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode),
            headersJson: Self.encodeHeaders(headers),
            bodyString: String(data: data, encoding: .utf8) ?? ""
        )
    }

    private static func performUrlSessionDownloadRequest(
        _ request: DirectFetchDownloadRequest,
        url: URL
    ) async throws -> DirectFetchDownloadResponse {
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = (request.method ?? "GET").uppercased()
        if let timeoutMs = request.timeoutMs, timeoutMs > 0 {
            urlRequest.timeoutInterval = timeoutMs / 1000
        }
        for header in Self.decodeHeaders(request.headersJson) {
            urlRequest.setValue(header.value, forHTTPHeaderField: header.key)
        }
        if let bodyString = request.bodyString {
            urlRequest.httpBody = Data(bodyString.utf8)
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.allowsCellularAccess = true
        configuration.allowsConstrainedNetworkAccess = true
        configuration.allowsExpensiveNetworkAccess = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.connectionProxyDictionary = [:]

        let session = URLSession(configuration: configuration)
        defer {
            session.finishTasksAndInvalidate()
        }

        let (temporaryUrl, response) = try await session.download(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw Self.error(code: 2, message: "Server returned a non-HTTP response.")
        }

        let headers = httpResponse.allHeaderFields.compactMap { key, value -> [String: String]? in
            guard let key = key as? String else {
                return nil
            }
            return ["key": key, "value": String(describing: value)]
        }
        let destinationUrl = try Self.destinationFileUrl(request.fileUri)
        try Self.replaceFile(at: destinationUrl, with: temporaryUrl)
        let bytesWritten = try FileManager.default.attributesOfItem(atPath: destinationUrl.path)[.size] as? NSNumber
        let byteCount = bytesWritten?.doubleValue ?? 0
        try Self.validateDownloadedBody(
            byteCount: Int(byteCount),
            headers: headers,
            status: httpResponse.statusCode,
            url: request.url
        )

        return DirectFetchDownloadResponse(
            url: httpResponse.url?.absoluteString ?? request.url,
            status: Double(httpResponse.statusCode),
            statusText: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode),
            headersJson: Self.encodeHeaders(headers),
            fileUri: request.fileUri,
            bytesWritten: byteCount
        )
    }

    private static func performUrlSessionStreamRequest(
        _ request: DirectFetchRequest,
        url: URL,
        onChunk: @escaping (DirectFetchStreamChunk) -> Void
    ) async throws -> DirectFetchResponse {
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = (request.method ?? "GET").uppercased()
        if let timeoutMs = request.timeoutMs, timeoutMs > 0 {
            urlRequest.timeoutInterval = timeoutMs / 1000
        }
        for header in Self.decodeHeaders(request.headersJson) {
            urlRequest.setValue(header.value, forHTTPHeaderField: header.key)
        }
        if let parts = request.bodyFormData, !parts.isEmpty {
            let (body, contentType) = try Self.buildMultipartBody(parts)
            urlRequest.httpBody = body
            urlRequest.setValue(contentType, forHTTPHeaderField: "Content-Type")
        } else if let bodyString = request.bodyString {
            urlRequest.httpBody = Data(bodyString.utf8)
        }

        let configuration = URLSessionConfiguration.ephemeral
        configuration.waitsForConnectivity = false
        configuration.allowsCellularAccess = true
        configuration.allowsConstrainedNetworkAccess = true
        configuration.allowsExpensiveNetworkAccess = true
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.connectionProxyDictionary = [:]

        let session = URLSession(configuration: configuration)
        defer {
            session.finishTasksAndInvalidate()
        }

        let (bytes, response) = try await session.bytes(for: urlRequest)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw Self.error(code: 2, message: "Server returned a non-HTTP response.")
        }

        let headers = httpResponse.allHeaderFields.compactMap { key, value -> [String: String]? in
            guard let key = key as? String else {
                return nil
            }
            return ["key": key, "value": String(describing: value)]
        }

        var body = Data()
        var pendingEmit = Data()
        for try await byte in bytes {
            body.append(byte)
            guard httpResponse.statusCode < 400 else {
                continue
            }

            pendingEmit.append(byte)
            if byte == 10 {
                Self.emitStreamChunk(pendingEmit, onChunk: onChunk)
                pendingEmit.removeAll(keepingCapacity: true)
            }
        }

        if httpResponse.statusCode < 400 && !pendingEmit.isEmpty {
            Self.emitStreamChunk(pendingEmit, onChunk: onChunk)
        }

        return DirectFetchResponse(
            url: httpResponse.url?.absoluteString ?? request.url,
            status: Double(httpResponse.statusCode),
            statusText: HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode),
            headersJson: Self.encodeHeaders(headers),
            bodyString: String(data: body, encoding: .utf8) ?? ""
        )
    }

    private static func performRawHttpRequest(
        _ request: DirectFetchRequest,
        url: URL
    ) async throws -> DirectFetchResponse {
        guard let host = url.host else {
            throw Self.error(code: 3, message: "HTTP URL is missing a host: \(request.url)")
        }
        guard let port = NWEndpoint.Port(rawValue: UInt16(url.port ?? 80)) else {
            throw Self.error(code: 4, message: "Invalid HTTP port for URL: \(request.url)")
        }

        let requestData = try Self.encodeHttpRequest(request, url: url, host: host)
        let responseData = try await Self.withTimeout(request.timeoutMs) {
            try await Self.sendRawHttpRequest(host: host, port: port, requestData: requestData)
        }
        return try Self.decodeHttpResponse(responseData, fallbackUrl: request.url)
    }

    private static func performRawHttpDownloadRequest(
        _ request: DirectFetchDownloadRequest,
        url: URL
    ) async throws -> DirectFetchDownloadResponse {
        guard let host = url.host else {
            throw Self.error(code: 3, message: "HTTP URL is missing a host: \(request.url)")
        }
        guard let port = NWEndpoint.Port(rawValue: UInt16(url.port ?? 80)) else {
            throw Self.error(code: 4, message: "Invalid HTTP port for URL: \(request.url)")
        }

        let requestData = Self.encodeHttpRequest(request, url: url, host: host)
        let responseData = try await Self.withTimeout(request.timeoutMs) {
            try await Self.sendRawHttpRequest(host: host, port: port, requestData: requestData)
        }
        let decoded = try Self.decodeHttpResponseBody(responseData)
        let destinationUrl = try Self.destinationFileUrl(request.fileUri)
        try Self.writeFile(decoded.body, to: destinationUrl)
        try Self.validateDownloadedBody(
            byteCount: decoded.body.count,
            headers: decoded.headers,
            status: decoded.status,
            url: request.url
        )

        return DirectFetchDownloadResponse(
            url: request.url,
            status: Double(decoded.status),
            statusText: decoded.statusText,
            headersJson: Self.encodeHeaders(decoded.headers),
            fileUri: request.fileUri,
            bytesWritten: Double(decoded.body.count)
        )
    }

    private static func performRawHttpStreamRequest(
        _ request: DirectFetchRequest,
        url: URL,
        onChunk: @escaping (DirectFetchStreamChunk) -> Void
    ) async throws -> DirectFetchResponse {
        guard let host = url.host else {
            throw Self.error(code: 3, message: "HTTP URL is missing a host: \(request.url)")
        }
        guard let port = NWEndpoint.Port(rawValue: UInt16(url.port ?? 80)) else {
            throw Self.error(code: 4, message: "Invalid HTTP port for URL: \(request.url)")
        }

        let requestData = try Self.encodeHttpRequest(request, url: url, host: host)
        return try await Self.withTimeout(request.timeoutMs) {
            try await Self.sendRawHttpStreamRequest(
                host: host,
                port: port,
                requestData: requestData,
                fallbackUrl: request.url,
                onChunk: onChunk
            )
        }
    }

    private static func encodeHttpRequest(
        _ request: DirectFetchRequest,
        url: URL,
        host: String
    ) throws -> Data {
        let (body, additionalHeaders) = try Self.bodyData(for: request)
        return Self.encodeHttpRequest(
            method: request.method,
            headersJson: request.headersJson,
            body: body,
            additionalHeaders: additionalHeaders,
            timeoutMs: request.timeoutMs,
            url: url,
            host: host
        )
    }

    private static func encodeHttpRequest(
        _ request: DirectFetchDownloadRequest,
        url: URL,
        host: String
    ) -> Data {
        return Self.encodeHttpRequest(
            method: request.method,
            headersJson: request.headersJson,
            body: request.bodyString.map { Data($0.utf8) } ?? Data(),
            additionalHeaders: [],
            timeoutMs: request.timeoutMs,
            url: url,
            host: host
        )
    }

    private static func encodeHttpRequest(
        method requestMethod: String?,
        headersJson: String?,
        body: Data,
        additionalHeaders: [(key: String, value: String)],
        timeoutMs _: Double?,
        url: URL,
        host: String
    ) -> Data {
        let method = (requestMethod ?? "GET").uppercased()
        let path = url.path.isEmpty ? "/" : url.path
        let target = url.query.map { "\(path)?\($0)" } ?? path
        var headers = Self.decodeHeaders(headersJson)
        for header in additionalHeaders {
            headers.removeAll { $0.key.caseInsensitiveCompare(header.key) == .orderedSame }
            headers.append(header)
        }

        if !Self.hasHeader("host", in: headers) {
            headers.append((key: "Host", value: url.port.map { "\(host):\($0)" } ?? host))
        }
        if !Self.hasHeader("user-agent", in: headers) {
            headers.append((key: "User-Agent", value: "react-native-direct-fetch"))
        }
        if !Self.hasHeader("connection", in: headers) {
            headers.append((key: "Connection", value: "close"))
        }
        if !body.isEmpty && !Self.hasHeader("content-length", in: headers) {
            headers.append((key: "Content-Length", value: String(body.count)))
        }

        var head = "\(method) \(target) HTTP/1.1\r\n"
        for header in headers {
            head += "\(header.key): \(header.value)\r\n"
        }
        head += "\r\n"

        var data = Data(head.utf8)
        data.append(body)
        return data
    }

    private static func bodyData(
        for request: DirectFetchRequest
    ) throws -> (body: Data, additionalHeaders: [(key: String, value: String)]) {
        if let parts = request.bodyFormData, !parts.isEmpty {
            let (body, contentType) = try Self.buildMultipartBody(parts)
            return (body, [(key: "Content-Type", value: contentType)])
        }
        return (request.bodyString.map { Data($0.utf8) } ?? Data(), [])
    }

    private static func buildMultipartBody(_ parts: [DirectFetchFormDataPart]) throws -> (Data, String) {
        let boundary = "DirectFetch-\(UUID().uuidString)"
        let crlf = "\r\n"
        var body = Data()

        for part in parts {
            body.append(Data("--\(boundary)\(crlf)".utf8))
            if let fileUri = part.fileUri {
                let fileName = Self.escapeMultipartValue(part.fileName ?? "file")
                let mimeType = Self.escapeMultipartValue(part.mimeType ?? "application/octet-stream")
                body.append(Data("Content-Disposition: form-data; name=\"\(Self.escapeMultipartValue(part.name))\"; filename=\"\(fileName)\"\(crlf)".utf8))
                body.append(Data("Content-Type: \(mimeType)\(crlf)\(crlf)".utf8))
                body.append(try Self.readMultipartFile(fileUri))
            } else {
                body.append(Data("Content-Disposition: form-data; name=\"\(Self.escapeMultipartValue(part.name))\"\(crlf)\(crlf)".utf8))
                body.append(Data((part.value ?? "").utf8))
            }
            body.append(Data(crlf.utf8))
        }

        body.append(Data("--\(boundary)--\(crlf)".utf8))
        return (body, "multipart/form-data; boundary=\(boundary)")
    }

    private static func readMultipartFile(_ uri: String) throws -> Data {
        let url: URL
        if let parsed = URL(string: uri), parsed.scheme?.lowercased() == "file" {
            url = parsed
        } else if uri.hasPrefix("http://") || uri.hasPrefix("https://") {
            throw Self.error(code: 11, message: "Remote multipart file URLs are not supported: \(uri)")
        } else {
            url = URL(fileURLWithPath: uri)
        }
        do {
            return try Data(contentsOf: url)
        } catch {
            throw Self.error(code: 12, message: "Cannot read multipart file at \(uri): \(error.localizedDescription)")
        }
    }

    private static func escapeMultipartValue(_ value: String) -> String {
        value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
    }

    private static func sendRawHttpRequest(
        host: String,
        port: NWEndpoint.Port,
        requestData: Data
    ) async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            let queue = DispatchQueue(label: "react-native-direct-fetch.http")
            let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
            var responseData = Data()
            var didFinish = false

            func finish(_ result: Result<Data, Error>) {
                guard !didFinish else {
                    return
                }
                didFinish = true
                connection.cancel()
                continuation.resume(with: result)
            }

            func receiveNext() {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
                    data,
                    _,
                    isComplete,
                    error in
                    if let error {
                        finish(.failure(error))
                        return
                    }
                    if let data {
                        responseData.append(data)
                    }
                    if isComplete || Self.isHttpResponseComplete(responseData) {
                        finish(.success(responseData))
                        return
                    }
                    receiveNext()
                }
            }

            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    connection.send(content: requestData, completion: .contentProcessed { error in
                        if let error {
                            finish(.failure(error))
                            return
                        }
                        receiveNext()
                    })
                case .failed(let error):
                    finish(.failure(error))
                default:
                    break
                }
            }

            connection.start(queue: queue)
        }
    }

    private static func sendRawHttpStreamRequest(
        host: String,
        port: NWEndpoint.Port,
        requestData: Data,
        fallbackUrl: String,
        onChunk: @escaping (DirectFetchStreamChunk) -> Void
    ) async throws -> DirectFetchResponse {
        try await withCheckedThrowingContinuation { continuation in
            let queue = DispatchQueue(label: "react-native-direct-fetch.http-stream")
            let connection = NWConnection(host: NWEndpoint.Host(host), port: port, using: .tcp)
            var responseBuffer = Data()
            var status: Int?
            var statusText = ""
            var headers: [[String: String]] = []
            var decoder: HttpBodyStreamDecoder?
            var didFinish = false

            func finish(_ result: Result<DirectFetchResponse, Error>) {
                guard !didFinish else {
                    return
                }
                didFinish = true
                connection.cancel()
                continuation.resume(with: result)
            }

            func emit(_ data: Data) {
                guard
                    let status,
                    status < 400,
                    !data.isEmpty
                else {
                    return
                }
                Self.emitStreamChunk(data, onChunk: onChunk)
            }

            func finalize() {
                guard let status else {
                    finish(.failure(Self.error(code: 5, message: "HTTP response did not include headers.")))
                    return
                }
                let body = decoder?.body ?? Data()
                finish(.success(DirectFetchResponse(
                    url: fallbackUrl,
                    status: Double(status),
                    statusText: statusText,
                    headersJson: Self.encodeHeaders(headers),
                    bodyString: String(data: body, encoding: .utf8) ?? ""
                )))
            }

            func process(_ data: Data) {
                responseBuffer.append(data)
                if decoder == nil {
                    guard let parsed = Self.parseHttpResponseHead(responseBuffer) else {
                        return
                    }
                    status = parsed.status
                    statusText = parsed.statusText
                    headers = parsed.headers
                    decoder = HttpBodyStreamDecoder(headers: parsed.headers)
                    let bodyData = responseBuffer.subdata(in: parsed.bodyStart..<responseBuffer.endIndex)
                    responseBuffer.removeAll(keepingCapacity: true)
                    for chunk in decoder?.append(bodyData) ?? [] {
                        emit(chunk)
                    }
                } else {
                    for chunk in decoder?.append(data) ?? [] {
                        emit(chunk)
                    }
                }
                if decoder?.isComplete == true {
                    finalize()
                }
            }

            func receiveNext() {
                connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) {
                    data,
                    _,
                    isComplete,
                    error in
                    if let error {
                        finish(.failure(error))
                        return
                    }
                    if let data {
                        process(data)
                    }
                    if didFinish {
                        return
                    }
                    if isComplete {
                        finalize()
                        return
                    }
                    receiveNext()
                }
            }

            connection.stateUpdateHandler = { state in
                switch state {
                case .ready:
                    connection.send(content: requestData, completion: .contentProcessed { error in
                        if let error {
                            finish(.failure(error))
                            return
                        }
                        receiveNext()
                    })
                case .failed(let error):
                    finish(.failure(error))
                default:
                    break
                }
            }

            connection.start(queue: queue)
        }
    }

    private static func decodeHttpResponse(
        _ data: Data,
        fallbackUrl: String
    ) throws -> DirectFetchResponse {
        let decoded = try Self.decodeHttpResponseBody(data)

        return DirectFetchResponse(
            url: fallbackUrl,
            status: Double(decoded.status),
            statusText: decoded.statusText,
            headersJson: Self.encodeHeaders(decoded.headers),
            bodyString: String(data: decoded.body, encoding: .utf8) ?? ""
        )
    }

    private static func decodeHttpResponseBody(
        _ data: Data
    ) throws -> (status: Int, statusText: String, headers: [[String: String]], body: Data) {
        guard let headerRange = data.range(of: Data("\r\n\r\n".utf8)) else {
            throw Self.error(code: 5, message: "HTTP response did not include headers.")
        }
        let headerData = data.subdata(in: data.startIndex..<headerRange.lowerBound)
        var bodyData = data.subdata(in: headerRange.upperBound..<data.endIndex)
        guard let headerText = String(data: headerData, encoding: .isoLatin1) else {
            throw Self.error(code: 6, message: "HTTP response headers were not decodable.")
        }

        let lines = headerText.components(separatedBy: "\r\n")
        guard let statusLine = lines.first else {
            throw Self.error(code: 7, message: "HTTP response status line was missing.")
        }
        let statusParts = statusLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard statusParts.count >= 2, let status = Int(statusParts[1]) else {
            throw Self.error(code: 8, message: "HTTP response status line was invalid: \(statusLine)")
        }

        let headers = Self.parseHttpHeaders(lines.dropFirst())
        if Self.headerValue("transfer-encoding", in: headers)?.lowercased().contains("chunked") == true {
            bodyData = Self.decodeChunkedBody(bodyData) ?? bodyData
        }

        return (
            status: status,
            statusText: statusParts.count >= 3 ? statusParts[2] : "",
            headers: headers,
            body: bodyData
        )
    }

    private static func parseHttpResponseHead(
        _ data: Data
    ) -> (bodyStart: Data.Index, status: Int, statusText: String, headers: [[String: String]])? {
        guard let headerRange = data.range(of: Data("\r\n\r\n".utf8)) else {
            return nil
        }
        let headerData = data.subdata(in: data.startIndex..<headerRange.lowerBound)
        guard let headerText = String(data: headerData, encoding: .isoLatin1) else {
            return nil
        }

        let lines = headerText.components(separatedBy: "\r\n")
        guard let statusLine = lines.first else {
            return nil
        }
        let statusParts = statusLine.split(separator: " ", maxSplits: 2).map(String.init)
        guard statusParts.count >= 2, let status = Int(statusParts[1]) else {
            return nil
        }

        return (
            bodyStart: headerRange.upperBound,
            status: status,
            statusText: statusParts.count >= 3 ? statusParts[2] : "",
            headers: Self.parseHttpHeaders(lines.dropFirst())
        )
    }

    private static func destinationFileUrl(_ fileUri: String) throws -> URL {
        if let url = URL(string: fileUri), url.isFileURL {
            return url
        }
        return URL(fileURLWithPath: fileUri)
    }

    private static func replaceFile(at destinationUrl: URL, with sourceUrl: URL) throws {
        try FileManager.default.createDirectory(
            at: destinationUrl.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        if FileManager.default.fileExists(atPath: destinationUrl.path) {
            try FileManager.default.removeItem(at: destinationUrl)
        }
        try FileManager.default.moveItem(at: sourceUrl, to: destinationUrl)
    }

    private static func writeFile(_ data: Data, to destinationUrl: URL) throws {
        try FileManager.default.createDirectory(
            at: destinationUrl.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let temporaryUrl = destinationUrl.appendingPathExtension("direct-fetch.tmp")
        if FileManager.default.fileExists(atPath: temporaryUrl.path) {
            try FileManager.default.removeItem(at: temporaryUrl)
        }
        try data.write(to: temporaryUrl, options: .atomic)
        try Self.replaceFile(at: destinationUrl, with: temporaryUrl)
    }

    private static func validateDownloadedBody(
        byteCount: Int,
        headers: [[String: String]],
        status: Int,
        url: String
    ) throws {
        guard status >= 200, status < 300 else {
            return
        }
        if byteCount <= 0 {
            throw Self.error(code: 9, message: "Downloaded response was empty: \(url)")
        }
        if
            let contentLength = Self.headerValue("content-length", in: headers),
            let expectedLength = Int(contentLength),
            expectedLength != byteCount
        {
            throw Self.error(
                code: 10,
                message: "Downloaded response was truncated: \(byteCount)/\(expectedLength) bytes for \(url)"
            )
        }
    }

    private static func parseHttpHeaders(_ lines: ArraySlice<String>) -> [[String: String]] {
        lines.compactMap { line -> [String: String]? in
            guard let separator = line.firstIndex(of: ":") else {
                return nil
            }
            let key = String(line[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
            let value = String(line[line.index(after: separator)...])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return ["key": key, "value": value]
        }
    }

    private static func isHttpResponseComplete(_ data: Data) -> Bool {
        guard let headerRange = data.range(of: Data("\r\n\r\n".utf8)) else {
            return false
        }
        let headerData = data.subdata(in: data.startIndex..<headerRange.lowerBound)
        guard let headerText = String(data: headerData, encoding: .isoLatin1) else {
            return false
        }

        let headers = Self.parseHttpHeaders(headerText.components(separatedBy: "\r\n").dropFirst())
        let bodyLength = data.distance(from: headerRange.upperBound, to: data.endIndex)
        if
            let contentLength = Self.headerValue("content-length", in: headers),
            let expectedLength = Int(contentLength)
        {
            return bodyLength >= expectedLength
        }
        if Self.headerValue("transfer-encoding", in: headers)?.lowercased().contains("chunked") == true {
            return data.suffix(5) == Data("0\r\n\r\n".utf8)
        }
        return false
    }

    private static func decodeChunkedBody(_ data: Data) -> Data? {
        var cursor = data.startIndex
        var decoded = Data()
        while cursor < data.endIndex {
            guard let lineRange = data[cursor..<data.endIndex].range(of: Data("\r\n".utf8)) else {
                return nil
            }
            let sizeData = data.subdata(in: cursor..<lineRange.lowerBound)
            guard
                let sizeLine = String(data: sizeData, encoding: .ascii),
                let size = Int(sizeLine.split(separator: ";", maxSplits: 1)[0], radix: 16)
            else {
                return nil
            }
            cursor = lineRange.upperBound
            if size == 0 {
                return decoded
            }
            let chunkEnd = cursor + size
            guard chunkEnd <= data.endIndex else {
                return nil
            }
            decoded.append(data.subdata(in: cursor..<chunkEnd))
            cursor = chunkEnd
            if data[cursor..<data.endIndex].starts(with: Data("\r\n".utf8)) {
                cursor += 2
            }
        }
        return decoded
    }

    private static func decodeHeaders(_ headersJson: String?) -> [(key: String, value: String)] {
        guard
            let headersJson,
            let data = headersJson.data(using: .utf8),
            let rawHeaders = try? JSONSerialization.jsonObject(with: data) as? [[String: String]]
        else {
            return []
        }
        return rawHeaders.compactMap { header in
            guard let key = header["key"], let value = header["value"] else {
                return nil
            }
            return (key: key, value: value)
        }
    }

    private static func encodeHeaders(_ headers: [[String: String]]) -> String {
        guard
            JSONSerialization.isValidJSONObject(headers),
            let data = try? JSONSerialization.data(withJSONObject: headers),
            let json = String(data: data, encoding: .utf8)
        else {
            return "[]"
        }
        return json
    }

    private static func hasHeader(_ name: String, in headers: [(key: String, value: String)]) -> Bool {
        headers.contains { $0.key.caseInsensitiveCompare(name) == .orderedSame }
    }

    private static func emitStreamChunk(
        _ data: Data,
        onChunk: @escaping (DirectFetchStreamChunk) -> Void
    ) {
        guard
            !data.isEmpty,
            let text = String(data: data, encoding: .utf8),
            !text.isEmpty
        else {
            return
        }

        let chunk = DirectFetchStreamChunk(bodyString: text)
        if Thread.isMainThread {
            onChunk(chunk)
        } else {
            DispatchQueue.main.sync {
                onChunk(chunk)
            }
        }
    }

    fileprivate static func headerValue(_ name: String, in headers: [[String: String]]) -> String? {
        headers.first { header in
            header["key"]?.caseInsensitiveCompare(name) == .orderedSame
        }?["value"]
    }

    private static func withTimeout<T>(
        _ timeoutMs: Double?,
        operation: @escaping () async throws -> T
    ) async throws -> T {
        let seconds = max((timeoutMs ?? 30000) / 1000, 1)
        return try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }
            group.addTask {
                try await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
                throw Self.error(code: 9, message: "Direct HTTP request timed out.")
            }
            guard let result = try await group.next() else {
                throw Self.error(code: 10, message: "Direct HTTP request did not complete.")
            }
            group.cancelAll()
            return result
        }
    }

    private static func error(code: Int, message: String) -> NSError {
        NSError(
            domain: "DirectFetch",
            code: code,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
