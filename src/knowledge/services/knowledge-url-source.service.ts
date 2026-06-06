import { BadRequestException, Injectable } from '@nestjs/common';
import { lookup } from 'dns/promises';
import {
  request as httpRequest,
  IncomingMessage,
  RequestOptions as HttpRequestOptions,
} from 'http';
import {
  request as httpsRequest,
  RequestOptions as HttpsRequestOptions,
} from 'https';
import { isIP } from 'net';
import { Readable } from 'stream';
import { KnowledgeExtractedTextBlock } from './knowledge-extraction.service';
import { KnowledgeHtmlExtractionService } from './knowledge-html-extraction.service';

type ResolveHost = (hostname: string) => Promise<string[]>;

export type KnowledgeUrlSourcePayload = {
  sourceUrl: string;
  title?: string;
  mimeType: string;
  size: number;
  blocks: KnowledgeExtractedTextBlock[];
};

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_SIZE_BYTES = 1_000_000;
const DEFAULT_MAX_REDIRECTS = 3;
const HTML_MIME_TYPE = 'text/html';
const IPV4_MAPPED_PREFIX = [
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0xff, 0xff,
];
const NAT64_WELL_KNOWN_PREFIX = [
  0x00, 0x64, 0xff, 0x9b,
  0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
];
const DISCARD_ONLY_PREFIX = [
  0x01, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00,
];

@Injectable()
export class KnowledgeUrlSourceService {
  constructor(
    private readonly htmlExtractionService: KnowledgeHtmlExtractionService,
  ) {}

  async acquire(inputUrl: string): Promise<KnowledgeUrlSourcePayload> {
    const { response, sourceUrl } = await this.fetchValidated(inputUrl);
    const mimeType = this.validateContentType(response);
    const html = await this.readBoundedText(response);
    const extraction = this.htmlExtractionService.extract(html);

    return {
      sourceUrl,
      title: extraction.title,
      mimeType,
      size: Buffer.byteLength(html, 'utf8'),
      blocks: extraction.blocks,
    };
  }

  private async fetchValidated(inputUrl: string): Promise<{
    response: Response;
    sourceUrl: string;
  }> {
    let currentUrl = this.normalizeAndValidateUrl(inputUrl);
    const maxRedirects = this.getPositiveInteger(
      process.env.KNOWLEDGE_URL_MAX_REDIRECTS,
      DEFAULT_MAX_REDIRECTS,
    );

    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const resolvedAddress = await this.validateResolvedHost(currentUrl);

      const response = await this.safeFetch(currentUrl, resolvedAddress);
      const responseUrl = response.url || currentUrl.href;

      if (!this.isRedirect(response.status)) {
        return {
          response,
          sourceUrl: this.normalizeAndValidateUrl(responseUrl).href,
        };
      }

      if (redirectCount >= maxRedirects) {
        throw new BadRequestException('Knowledge URL has too many redirects');
      }

      const location = response.headers.get('location');
      if (!location) {
        throw new BadRequestException('Knowledge URL redirect is invalid');
      }

      currentUrl = this.normalizeAndValidateUrl(location, currentUrl);
    }

    throw new BadRequestException('Knowledge URL has too many redirects');
  }

  private normalizeAndValidateUrl(value: string, base?: URL): URL {
    let url: URL;
    try {
      url = new URL(value, base);
    } catch {
      throw new BadRequestException('Knowledge URL is invalid');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException('Knowledge URL protocol is not supported');
    }

    if (url.username || url.password) {
      throw new BadRequestException('Knowledge URL credentials are not allowed');
    }

    url.hash = '';
    this.validateHostname(url.hostname);
    return url;
  }

  private validateHostname(hostname: string): void {
    const normalized = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
    if (
      normalized === 'localhost' ||
      normalized.endsWith('.localhost') ||
      normalized === ''
    ) {
      throw new BadRequestException('Knowledge URL host is not allowed');
    }

    if (isIP(normalized) && !this.isPublicIp(normalized)) {
      throw new BadRequestException('Knowledge URL host is not allowed');
    }
  }

  private async validateResolvedHost(url: URL): Promise<string> {
    const addresses = await this.resolveHost(url.hostname).catch(() => {
      throw new BadRequestException('Knowledge URL host could not be resolved');
    });

    if (!addresses.length || addresses.some((address) => !this.isPublicIp(address))) {
      throw new BadRequestException('Knowledge URL host is not allowed');
    }

    return addresses[0];
  }

  private async safeFetch(url: URL, resolvedAddress: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.getPositiveInteger(
        process.env.KNOWLEDGE_URL_TIMEOUT_MS,
        DEFAULT_TIMEOUT_MS,
      ),
    );

    try {
      return await this.fetchUrl(url, resolvedAddress, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          Host: url.host,
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        },
      });
    } catch (error) {
      if ((error as { name?: unknown })?.name === 'AbortError') {
        throw new BadRequestException('Knowledge URL fetch timed out');
      }
      throw new BadRequestException('Knowledge URL could not be fetched');
    } finally {
      clearTimeout(timeout);
    }
  }

  private validateContentType(response: Response): string {
    if (!response.ok) {
      throw new BadRequestException('Knowledge URL could not be fetched');
    }

    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    const mimeType = contentType.split(';')[0].trim();
    if (mimeType !== HTML_MIME_TYPE && mimeType !== 'application/xhtml+xml') {
      throw new BadRequestException('Knowledge URL content type is not supported');
    }
    return mimeType === 'application/xhtml+xml' ? HTML_MIME_TYPE : mimeType;
  }

  private async readBoundedText(response: Response): Promise<string> {
    const maxSize = this.getPositiveInteger(
      process.env.KNOWLEDGE_URL_MAX_RESPONSE_SIZE_BYTES,
      DEFAULT_MAX_RESPONSE_SIZE_BYTES,
    );
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > maxSize) {
      throw new BadRequestException('Knowledge URL response is too large');
    }

    const body = response.body;
    if (!body) {
      return '';
    }

    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }

      size += value.byteLength;
      if (size > maxSize) {
        await reader.cancel().catch(() => undefined);
        throw new BadRequestException('Knowledge URL response is too large');
      }
      chunks.push(value);
    }

    return Buffer.concat(chunks).toString('utf8');
  }

  private isRedirect(status: number): boolean {
    return status >= 300 && status < 400;
  }

  private isPublicIp(address: string): boolean {
    const version = isIP(address);
    if (version === 4) {
      return this.isPublicIpv4(address);
    }
    if (version === 6) {
      return this.isPublicIpv6(address);
    }
    return false;
  }

  private isPublicIpv4(address: string): boolean {
    const octets = address.split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) {
      return false;
    }

    const [first, second, third, fourth] = octets;
    if (first === 0 || first === 10 || first === 127) {
      return false;
    }
    if (first === 100 && second >= 64 && second <= 127) {
      return false;
    }
    if (first === 169 && second === 254) {
      return false;
    }
    if (first === 172 && second >= 16 && second <= 31) {
      return false;
    }
    if (first === 192 && second === 168) {
      return false;
    }
    if (first === 192 && second === 0 && third === 0) {
      return false;
    }
    if (first === 192 && second === 0 && third === 2) {
      return false;
    }
    if (first === 198 && (second === 18 || second === 19)) {
      return false;
    }
    if (first === 198 && second === 51 && third === 100) {
      return false;
    }
    if (first === 203 && second === 0 && third === 113) {
      return false;
    }
    if (first >= 224) {
      return false;
    }

    return !(first === 255 && second === 255 && third === 255 && fourth === 255);
  }

  private isPublicIpv6(address: string): boolean {
    const bytes = this.ipv6ToBytes(address);
    if (!bytes) {
      return false;
    }

    const embeddedIpv4 = this.extractEmbeddedIpv4(bytes);
    if (embeddedIpv4) {
      return this.isPublicIpv4(embeddedIpv4);
    }

    if (
      bytes.every((byte) => byte === 0) ||
      (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) ||
      this.matchesPrefix(bytes, [0xfc], 7) ||
      this.matchesPrefix(bytes, [0xfe, 0x80], 10) ||
      this.matchesPrefix(bytes, [0xff], 8) ||
      this.matchesPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32) ||
      this.matchesPrefix(bytes, DISCARD_ONLY_PREFIX, 64)
    ) {
      return false;
    }

    return true;
  }

  private getPositiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async resolveHost(hostname: string): Promise<string[]> {
    return defaultResolveHost(hostname);
  }

  private async fetchUrl(
    url: URL,
    resolvedAddress: string,
    init: Parameters<typeof fetch>[1],
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const requestOptions: HttpRequestOptions = {
        protocol: url.protocol,
        hostname: resolvedAddress,
        family: isIP(resolvedAddress) || undefined,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: init?.method ?? 'GET',
        headers: init?.headers as Record<string, string>,
        signal: init?.signal ?? undefined,
      };
      const onResponse = (message: IncomingMessage) => {
        const remoteAddress = message.socket.remoteAddress;
        if (!remoteAddress || !this.isPublicIp(remoteAddress)) {
          message.destroy();
          reject(new BadRequestException('Knowledge URL host is not allowed'));
          return;
        }

        resolve(this.toFetchResponse(message));
      };
      const request = url.protocol === 'https:'
        ? httpsRequest(
          this.requestOptionsForProtocol(url, requestOptions) as HttpsRequestOptions,
          onResponse,
        )
        : httpRequest(requestOptions, onResponse);

      request.on('error', reject);
      request.end();
    });
  }

  private requestOptionsForProtocol(
    url: URL,
    requestOptions: HttpRequestOptions,
  ): HttpRequestOptions | HttpsRequestOptions {
    if (url.protocol !== 'https:') {
      return requestOptions;
    }

    return {
      ...requestOptions,
      servername: this.tlsServerName(url),
    };
  }

  private toFetchResponse(message: IncomingMessage): Response {
    const headers = new Headers();
    for (const [name, value] of Object.entries(message.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          headers.append(name, item);
        }
      } else if (value !== undefined) {
        headers.set(name, String(value));
      }
    }

    return new Response(Readable.toWeb(message) as ReadableStream, {
      status: message.statusCode ?? 0,
      statusText: message.statusMessage,
      headers,
    });
  }

  private tlsServerName(url: URL): string | undefined {
    if (url.protocol !== 'https:') {
      return undefined;
    }
    return url.hostname.replace(/^\[|\]$/g, '');
  }

  private extractEmbeddedIpv4(bytes: number[]): string | undefined {
    const isIpv4Mapped = this.matchesPrefix(bytes, IPV4_MAPPED_PREFIX, 96);
    const isNat64WellKnown = this.matchesPrefix(bytes, NAT64_WELL_KNOWN_PREFIX, 96);

    if (!isIpv4Mapped && !isNat64WellKnown) {
      return undefined;
    }

    return bytes.slice(12, 16).join('.');
  }

  private ipv6ToBytes(address: string): number[] | undefined {
    const normalized = address.toLowerCase().replace(/^\[|\]$/g, '');
    const [withoutZone] = normalized.split('%');
    const expanded = this.expandDottedIpv4Tail(withoutZone);
    const halves = expanded.split('::');

    if (halves.length > 2) {
      return undefined;
    }

    const left = this.readIpv6Groups(halves[0]);
    const right = halves.length === 2 ? this.readIpv6Groups(halves[1]) : [];
    if (!left || !right) {
      return undefined;
    }

    const missing = 8 - left.length - right.length;
    if (
      missing < 0 ||
      (halves.length === 1 && missing !== 0) ||
      (halves.length === 2 && missing === 0)
    ) {
      return undefined;
    }

    return [...left, ...Array(missing).fill(0), ...right].flatMap((group) => [
      (group >> 8) & 0xff,
      group & 0xff,
    ]);
  }

  private expandDottedIpv4Tail(address: string): string {
    const match = address.match(/(.+:)(\d+\.\d+\.\d+\.\d+)$/);
    if (!match) {
      return address;
    }

    const octets = match[2].split('.').map(Number);
    if (octets.length !== 4 || octets.some((octet) => octet < 0 || octet > 255)) {
      return address;
    }

    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    return `${match[1]}${high}:${low}`;
  }

  private readIpv6Groups(value: string): number[] | undefined {
    if (!value) {
      return [];
    }

    return value.split(':').map((group) => {
      if (!/^[0-9a-f]{1,4}$/i.test(group)) {
        return Number.NaN;
      }
      return Number.parseInt(group, 16);
    }).every(Number.isFinite)
      ? value.split(':').map((group) => Number.parseInt(group, 16))
      : undefined;
  }

  private matchesPrefix(
    bytes: number[],
    prefixBytes: number[],
    prefixLength: number,
  ): boolean {
    const fullBytes = Math.floor(prefixLength / 8);
    const remainingBits = prefixLength % 8;

    for (let index = 0; index < fullBytes; index += 1) {
      if (bytes[index] !== prefixBytes[index]) {
        return false;
      }
    }

    if (remainingBits === 0) {
      return true;
    }

    const mask = 0xff << (8 - remainingBits) & 0xff;
    return (bytes[fullBytes] & mask) === (prefixBytes[fullBytes] & mask);
  }
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}
