import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, parseEnv } from "node:util";
import path from "node:path";
//#region ../protocol/dist/index.mjs
const LETTER_DASH_NUMBER = "[a-zA-Z0-9-]";
const NUMERIC_IDENTIFIER = String.raw`0|[1-9]\d*`;
const NUMERIC_IDENTIFIER_LOOSE = String.raw`\d+`;
const NON_NUMERIC_IDENTIFIER = String.raw`\d*[a-zA-Z-]${LETTER_DASH_NUMBER}*`;
const MAIN_VERSION = String.raw`(${NUMERIC_IDENTIFIER})\.(${NUMERIC_IDENTIFIER})\.(${NUMERIC_IDENTIFIER})`;
const MAIN_VERSION_LOOSE = String.raw`(${NUMERIC_IDENTIFIER_LOOSE})\.(${NUMERIC_IDENTIFIER_LOOSE})\.(${NUMERIC_IDENTIFIER_LOOSE})`;
const PRERELEASE_IDENTIFIER = `(?:${NON_NUMERIC_IDENTIFIER}|${NUMERIC_IDENTIFIER})`;
const PRERELEASE_IDENTIFIER_LOOSE = `(?:${NON_NUMERIC_IDENTIFIER}|${NUMERIC_IDENTIFIER_LOOSE})`;
const PRERELEASE = String.raw`(?:-(${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*))`;
const PRERELEASE_LOOSE = String.raw`(?:-?(${PRERELEASE_IDENTIFIER_LOOSE}(?:\.${PRERELEASE_IDENTIFIER_LOOSE})*))`;
const BUILD_IDENTIFIER = `${LETTER_DASH_NUMBER}+`;
const BUILD = String.raw`(?:\+(${BUILD_IDENTIFIER}(?:\.${BUILD_IDENTIFIER})*))`;
const FULL_PLAIN = `v?${MAIN_VERSION}${PRERELEASE}?${BUILD}?`;
const LOOSE_PLAIN = String.raw`[v=\s]*${MAIN_VERSION_LOOSE}${PRERELEASE_LOOSE}?${BUILD}?`;
const XRANGE_IDENTIFIER = String.raw`${NUMERIC_IDENTIFIER}|x|X|\*`;
const XRANGE_IDENTIFIER_LOOSE = String.raw`${NUMERIC_IDENTIFIER_LOOSE}|x|X|\*`;
String.raw`[v=\s]*(${XRANGE_IDENTIFIER})(?:\.(${XRANGE_IDENTIFIER})(?:\.(${XRANGE_IDENTIFIER})(?:${PRERELEASE})?${BUILD}?)?)?`;
String.raw`[v=\s]*(${XRANGE_IDENTIFIER_LOOSE})(?:\.(${XRANGE_IDENTIFIER_LOOSE})(?:\.(${XRANGE_IDENTIFIER_LOOSE})(?:${PRERELEASE_LOOSE})?${BUILD}?)?)?`;
String.raw`(?:\^)`;
const COERCE_PLAIN = String.raw`(^|[^\d])(\d{1,${16}})(?:\.(\d{1,${16}}))?(?:\.(\d{1,${16}}))?`;
const COERCE = String.raw`${COERCE_PLAIN}(?:$|[^\d])`;
const COERCE_FULL = String.raw`${COERCE_PLAIN}(?:${PRERELEASE})?(?:${BUILD})?(?:$|[^\d])`;
function makeSafeRegexSource(source) {
	const replacements = [
		[String.raw`\s`, 1],
		[String.raw`\d`, 256],
		[LETTER_DASH_NUMBER, 250]
	];
	for (const [token, maximum] of replacements) source = source.split(`${token}*`).join(`${token}{0,${maximum}}`).split(`${token}+`).join(`${token}{1,${maximum}}`);
	return source;
}
function safeRegex(source, flags) {
	return new RegExp(makeSafeRegexSource(source), flags);
}
safeRegex(`^${FULL_PLAIN}$`);
safeRegex(`^${LOOSE_PLAIN}$`);
safeRegex(COERCE);
safeRegex(COERCE_FULL);
safeRegex(`^${PRERELEASE}$`);
safeRegex(`^${PRERELEASE_LOOSE}$`);
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const MAX_CATALOG_SEGMENT_LENGTH = 255;
function assertCatalogSegment(value, name) {
	if (value.length === 0 || value.length > MAX_CATALOG_SEGMENT_LENGTH || !/^[A-Za-z0-9._~-]+$/.test(value)) throw new Error(`${name} must be 1-${MAX_CATALOG_SEGMENT_LENGTH} URL-safe ASCII characters`);
}
function encodeUtf8(value) {
	const bytes = [];
	for (const codePointText of value) {
		const codePoint = codePointText.codePointAt(0);
		if (codePoint <= 127) bytes.push(codePoint);
		else if (codePoint <= 2047) bytes.push(192 | codePoint >> 6, 128 | codePoint & 63);
		else if (codePoint <= 65535) bytes.push(224 | codePoint >> 12, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
		else bytes.push(240 | codePoint >> 18, 128 | codePoint >> 12 & 63, 128 | codePoint >> 6 & 63, 128 | codePoint & 63);
	}
	return bytes;
}
function decodeUtf8(bytes) {
	let result = "";
	for (let index = 0; index < bytes.length;) {
		const first = bytes[index++];
		let codePoint;
		let continuationCount;
		if (first <= 127) {
			codePoint = first;
			continuationCount = 0;
		} else if ((first & 224) === 192) {
			codePoint = first & 31;
			continuationCount = 1;
		} else if ((first & 240) === 224) {
			codePoint = first & 15;
			continuationCount = 2;
		} else if ((first & 248) === 240) {
			codePoint = first & 7;
			continuationCount = 3;
		} else throw new Error("Invalid UTF-8 channel key");
		for (let offset = 0; offset < continuationCount; offset += 1) {
			const continuation = bytes[index++];
			if (continuation === void 0 || (continuation & 192) !== 128) throw new Error("Invalid UTF-8 channel key");
			codePoint = codePoint << 6 | continuation & 63;
		}
		if (codePoint > 1114111 || codePoint >= 55296 && codePoint <= 57343 || continuationCount === 1 && codePoint < 128 || continuationCount === 2 && codePoint < 2048 || continuationCount === 3 && codePoint < 65536) throw new Error("Invalid UTF-8 channel key");
		result += String.fromCodePoint(codePoint);
	}
	return result;
}
function base64UrlEncode(bytes) {
	let result = "";
	for (let index = 0; index < bytes.length; index += 3) {
		const first = bytes[index];
		const second = bytes[index + 1];
		const third = bytes[index + 2];
		const value = first << 16 | (second ?? 0) << 8 | (third ?? 0);
		result += BASE64URL_ALPHABET[value >> 18 & 63];
		result += BASE64URL_ALPHABET[value >> 12 & 63];
		if (second !== void 0) result += BASE64URL_ALPHABET[value >> 6 & 63];
		if (third !== void 0) result += BASE64URL_ALPHABET[value & 63];
	}
	return result;
}
function base64UrlDecode(value) {
	if (!/^[A-Za-z0-9_-]*$/.test(value) || value.length % 4 === 1) throw new Error("Invalid channel key");
	const bytes = [];
	for (let index = 0; index < value.length; index += 4) {
		const chunk = value.slice(index, index + 4);
		const encoded = [...chunk].map((character) => BASE64URL_ALPHABET.indexOf(character));
		if (encoded.some((part) => part < 0)) throw new Error("Invalid channel key");
		const bits = encoded[0] << 18 | encoded[1] << 12 | (encoded[2] ?? 0) << 6 | (encoded[3] ?? 0);
		bytes.push(bits >> 16 & 255);
		if (chunk.length >= 3) bytes.push(bits >> 8 & 255);
		if (chunk.length === 4) bytes.push(bits & 255);
	}
	return bytes;
}
function normalizeChannelName(channel) {
	return channel.trim().normalize("NFC");
}
function assertCanonicalChannelName(channel) {
	const normalized = normalizeChannelName(channel);
	if (normalized.length === 0 || normalized !== channel) throw new Error("Channel name must be non-empty, trimmed, and NFC-normalized");
	let codePointCount = 0;
	for (const _codePoint of normalized) {
		codePointCount += 1;
		if (codePointCount > 255) throw new Error("Channel name must not exceed 255 characters");
	}
}
function encodeChannelKey(channel) {
	assertCanonicalChannelName(channel);
	return base64UrlEncode(encodeUtf8(channel));
}
function decodeChannelKey(channelKey) {
	const channel = decodeUtf8(base64UrlDecode(channelKey));
	assertCanonicalChannelName(channel);
	if (encodeChannelKey(channel) !== channelKey) throw new Error("Channel key is not canonically encoded");
	return channel;
}
function createReleaseCatalogScopeKey(input) {
	decodeChannelKey(input.channelKey);
	if (input.strategy === "APP_VERSION") return `v1:app-version:${input.platform}:${input.channelKey}`;
	assertCatalogSegment(input.fingerprintHash, "Fingerprint hash");
	return `v1:fingerprint:${input.platform}:${input.channelKey}:${input.fingerprintHash}`;
}
function parseReleaseCatalogScopeKey(scopeKey) {
	const segments = scopeKey.split(":");
	const [version, strategy, platform, channelKey] = segments;
	if (version !== "v1" || platform !== "ios" && platform !== "android" || channelKey === void 0) throw new Error("Invalid release catalog scope key");
	const input = strategy === "app-version" && segments.length === 4 ? {
		channelKey,
		platform,
		strategy: "APP_VERSION"
	} : strategy === "fingerprint" && segments.length === 5 && segments[4] !== void 0 ? {
		channelKey,
		fingerprintHash: segments[4],
		platform,
		strategy: "FINGERPRINT"
	} : (() => {
		throw new Error("Invalid release catalog scope key");
	})();
	if (createReleaseCatalogScopeKey(input) !== scopeKey) throw new Error("Release catalog scope key is not canonical");
	return input;
}
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUUIDv7 = (value) => typeof value === "string" && UUID_V7_PATTERN.test(value);
/** The largest release catalog response body a client accepts, in UTF-8 bytes. */
const MAX_RELEASE_CATALOG_WIRE_BYTES = 528384;
/** The length of `value` in UTF-8 bytes, without an encoder the device may lack. */
const getUtf8ByteLength = (value) => {
	let bytes = 0;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 127) bytes += 1;
		else if (code <= 2047) bytes += 2;
		else if (code >= 55296 && code <= 56319 && index + 1 < value.length && value.charCodeAt(index + 1) >= 56320 && value.charCodeAt(index + 1) <= 57343) {
			bytes += 4;
			index += 1;
		} else bytes += 3;
	}
	return bytes;
};
const isStringArray = (value) => Array.isArray(value) && value.every((entry) => typeof entry === "string");
const isValidReleaseDescriptor = (value) => {
	if (value === null || typeof value !== "object") return false;
	const descriptor = value;
	return isUUIDv7(descriptor.releaseId) && (descriptor.kind === "BUNDLE" || descriptor.kind === "EMBEDDED") && (descriptor.kind === "BUNDLE" && typeof descriptor.bundleId === "string" || descriptor.kind === "EMBEDDED" && descriptor.bundleId === null) && Number.isSafeInteger(descriptor.rolloutCohortCount) && descriptor.rolloutCohortCount >= 0 && descriptor.rolloutCohortCount <= 1e3 && isStringArray(descriptor.targetCohorts) && descriptor.targetCohorts.length <= 100 && typeof descriptor.shouldForceUpdate === "boolean" && (descriptor.message === null || typeof descriptor.message === "string");
};
/** Whether the catalog is the expected scope's. */
const hasExpectedReleaseCatalogScope = (catalog, expected) => {
	try {
		const parsed = parseReleaseCatalogScopeKey(catalog.scopeKey);
		return parsed.channelKey === expected.channelKey && parsed.platform === expected.platform && parsed.strategy === expected.strategy && (parsed.strategy === "APP_VERSION" || expected.strategy === "FINGERPRINT" && parsed.fingerprintHash === expected.fingerprintHash);
	} catch {
		return false;
	}
};
/**
* Parses a release catalog response body as a client accepts it: within the
* wire limit, in the schema's shape, for the expected scope, and within the
* cohort limits. Any other body is null. The device's update client and
* doctor's server checks both run this, so they accept the same catalogs.
*/
const parseReleaseCatalog = (body, expectedScope) => {
	if (getUtf8ByteLength(body) > 528384) return null;
	try {
		const catalog = JSON.parse(body);
		if (catalog.schemaVersion !== 1 || typeof catalog.catalogId !== "string" || catalog.catalogId.length === 0 || typeof catalog.scopeKey !== "string" || !Number.isSafeInteger(catalog.generation) || (catalog.generation ?? 0) < 1 || typeof catalog.catalogHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(catalog.catalogHash) || catalog.fallbackPolicy !== "BUILTIN_IF_ACTIVE_INELIGIBLE" || !Array.isArray(catalog.releases) || !catalog.releases.every(isValidReleaseDescriptor) || catalog.rollbackReleases !== void 0 && (!Array.isArray(catalog.rollbackReleases) || !catalog.rollbackReleases.every(isValidReleaseDescriptor))) return null;
		if (!hasExpectedReleaseCatalogScope(catalog, expectedScope)) return null;
		if (new Set([...catalog.releases, ...catalog.rollbackReleases ?? []].flatMap((release) => release.targetCohorts)).size > 512) return null;
		return catalog;
	} catch {
		return null;
	}
};
//#endregion
//#region src/commands/infra/clientAuth.ts
/** Where the script keeps the credential it generated, before registering it. */
const CLIENT_CREDENTIAL_FILE = "client-credential.local";
//#endregion
//#region src/commands/doctor/server.ts
var VerificationError = class extends Error {};
const requireCheck = (condition, message) => {
	if (!condition) throw new VerificationError(message);
};
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = (value) => typeof value === "string" && value.length > 0;
const parseJson = (body) => {
	try {
		return JSON.parse(body);
	} catch {
		throw new VerificationError("Server did not return valid JSON.");
	}
};
async function verifyServer(options) {
	const { clientAuth } = options;
	const request = async (url, credential) => {
		const response = await (options.fetch ?? fetch)(url, {
			headers: credential && clientAuth ? { [clientAuth.credential.header]: credential } : {},
			redirect: "error",
			signal: AbortSignal.timeout(1e4)
		});
		let body = "";
		let size = 0;
		const decoder = new TextDecoder();
		for await (const chunk of response.body ?? []) {
			size += chunk.byteLength;
			requireCheck(size <= MAX_RELEASE_CATALOG_WIRE_BYTES, "Server response exceeds the probe limit.");
			body += decoder.decode(chunk, { stream: true });
		}
		body += decoder.decode();
		return {
			response,
			body
		};
	};
	let check = "inputs";
	try {
		const values = {
			"base-url": options.baseUrl,
			platform: options.platform,
			channel: options.channel,
			"app-version": options.appVersion,
			fingerprint: options.fingerprint
		};
		requireCheck(isText(values["base-url"]) && (values.platform === "ios" || values.platform === "android") && isText(values.channel) && isText(values["app-version"] ?? values.fingerprint) && values["app-version"] === void 0 !== (values.fingerprint === void 0), "Provide --base-url, --platform, --channel and exactly one of --app-version or --fingerprint.");
		const baseUrl = new URL(values["base-url"]);
		requireCheck(["http:", "https:"].includes(baseUrl.protocol) && !baseUrl.username && !baseUrl.password && !baseUrl.search && !baseUrl.hash, "Use an HTTP(S) server base URL without credentials, query or fragment.");
		const environmentText = await readFile(path.join(options.cwd, ".env.hotupdater"), "utf8").catch((error) => {
			if (error.code === "ENOENT") return "";
			throw error;
		});
		const environment = parseEnv(environmentText.replace(/^\uFEFF/, ""));
		let credential;
		if (clientAuth) {
			const { env, label } = clientAuth.credential;
			const saved = (await readFile(path.join(options.infraDir, "app", CLIENT_CREDENTIAL_FILE), "utf8").catch((error) => {
				if (error.code === "ENOENT") return "";
				throw error;
			})).trim();
			const fromEnvironment = (process.env[env] ?? environment[env])?.trim();
			requireCheck(!saved || !fromEnvironment || saved === fromEnvironment, `Saved client ${label}s differ. Resolve the target ${label} before verification.`);
			credential = fromEnvironment || saved;
			requireCheck(credential, `Store the client ${label} locally before verification.`);
		}
		const strategy = values["app-version"] ? "app-version" : "fingerprint";
		const target = values["app-version"] || values.fingerprint;
		requireCheck(isText(target), "An update target is required.");
		requireCheck(target !== "." && target !== ".." && (strategy !== "fingerprint" || /^[A-Za-z0-9._~-]{1,255}$/.test(target)) && values.channel === values.channel.trim().normalize("NFC") && [...values.channel].length <= 255, "Use the app's canonical channel and version or fingerprint as the catalog target.");
		const channelKey = Buffer.from(values.channel).toString("base64url");
		const expectedScope = strategy === "fingerprint" ? {
			channelKey,
			platform: values.platform,
			strategy: "FINGERPRINT",
			fingerprintHash: target
		} : {
			channelKey,
			platform: values.platform,
			strategy: "APP_VERSION"
		};
		const routeUrl = (route) => {
			const url = new URL(baseUrl);
			url.pathname = `${url.pathname.replace(/\/+$/, "")}/${route}`;
			return url;
		};
		const catalogUrl = routeUrl(`release-catalogs/${strategy}/${values.platform}/${channelKey}/${encodeURIComponent(target)}`);
		check = "version";
		const version = await request(routeUrl("version"));
		requireCheck(version.response.status === 200, "The version probe failed.");
		const versionBody = parseJson(version.body);
		requireCheck(isObject(versionBody) && versionBody["version"] === options.serverVersion && versionBody["infrastructureGeneration"] === options.infrastructureGeneration, "Server version or infrastructure generation does not match the scaffold.");
		check = "anonymous-catalog";
		if (clientAuth) {
			const anonymous = await request(catalogUrl);
			requireCheck(anonymous.response.status === 401, `The catalog must reject a request without the client ${clientAuth.credential.label} with HTTP 401.`);
		}
		check = "authenticated-catalog";
		const authenticated = await request(catalogUrl, credential);
		const catalog = parseJson(authenticated.body);
		const contentType = authenticated.response.headers.get("content-type") ?? "";
		const empty = authenticated.response.status === 404;
		if (empty) requireCheck(/^application\/json(?:;|$)/i.test(contentType) && isObject(catalog) && Object.keys(catalog).length === 1 && catalog["error"] === "Not found" && authenticated.response.headers.get("x-hot-updater-catalog") === "none", "HTTP 404 must be the empty-catalog response marked x-hot-updater-catalog: none.");
		else requireCheck(authenticated.response.status === 200 && /^application\/vnd\.hot-updater\.release-catalog\+json;\s*version=1(?:;|$)/i.test(contentType) && parseReleaseCatalog(authenticated.body, expectedScope) !== null, clientAuth ? "The authenticated request must return a valid release catalog for the requested scope." : "The request must return a valid release catalog for the requested scope.");
		return {
			status: "verified",
			checks: {
				version: "matches-manifest",
				anonymousCatalog: clientAuth ? 401 : "public",
				authenticatedCatalog: authenticated.response.status,
				catalog: empty ? "empty" : "available"
			}
		};
	} catch (error) {
		return {
			status: "failed",
			check,
			error: error instanceof VerificationError ? error.message : "Verification failed. Check local configuration, server access and response time."
		};
	}
}
//#endregion
//#region agent/verify-server.mjs
try {
	const { values } = parseArgs({
		options: {
			"base-url": { type: "string" },
			platform: { type: "string" },
			channel: { type: "string" },
			"app-version": { type: "string" },
			fingerprint: { type: "string" }
		},
		strict: true,
		allowPositionals: false
	});
	const manifest = JSON.parse(await readFile(new URL("../manifest.json", import.meta.url), "utf8"));
	if (typeof manifest.serverVersion !== "string" || !Number.isInteger(manifest.infrastructureGeneration) || manifest.clientAuth === void 0) throw new Error("Invalid manifest");
	const result = await verifyServer({
		cwd: process.cwd(),
		infraDir: fileURLToPath(new URL("..", import.meta.url)),
		baseUrl: values["base-url"],
		platform: values.platform,
		channel: values.channel,
		appVersion: values["app-version"],
		fingerprint: values.fingerprint,
		serverVersion: manifest.serverVersion,
		infrastructureGeneration: manifest.infrastructureGeneration,
		clientAuth: manifest.clientAuth
	});
	console.log(JSON.stringify(result));
	if (result.status !== "verified") process.exitCode = 1;
} catch {
	console.log(JSON.stringify({
		status: "failed",
		check: "inputs",
		error: "Cannot read verification inputs or scaffold manifest."
	}));
	process.exitCode = 1;
}
//#endregion
export {};
