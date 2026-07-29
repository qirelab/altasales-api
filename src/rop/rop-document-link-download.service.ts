import { BadRequestException, Injectable } from '@nestjs/common';

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

const ALLOWED_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx']);

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

const EXTENSION_BY_MIME = new Map<string, string>([
  ['application/pdf', 'pdf'],
  [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'docx',
  ],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
  ['application/vnd.ms-excel', 'xlsx'],
  ['application/msword', 'docx'],
]);

@Injectable()
export class RopDocumentLinkDownloadService {
  async downloadAsFile(
    link: string,
    suggestedName?: string,
  ): Promise<Express.Multer.File> {
    const normalizedLink = link.trim();
    const downloadUrl = await this.resolveDownloadUrl(normalizedLink);
    const parsedDownloadUrl = this.parseUrl(downloadUrl);

    const response = await this.fetchDocument(parsedDownloadUrl.href);
    const buffer = Buffer.from(await this.readResponseBody(response));
    const contentType = this.normalizeMimeType(
      response.headers.get('content-type'),
    );
    const fileName = this.resolveFileName(
      suggestedName,
      response.headers.get('content-disposition'),
      parsedDownloadUrl,
      contentType,
    );
    const extension = this.getExtension(fileName);

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        'Допустимы только файлы PDF, DOCX или XLSX',
      );
    }

    const mimetype =
      contentType ?? MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';

    return {
      fieldname: 'file',
      originalname: fileName,
      encoding: '7bit',
      mimetype,
      buffer,
      size: buffer.length,
    } as Express.Multer.File;
  }

  private async resolveDownloadUrl(link: string): Promise<string> {
    const url = this.parseUrl(link);

    if (this.isYandexDiskUrl(url)) {
      return this.resolveYandexDiskDownloadUrl(url.href);
    }

    const driveFileId = this.extractGoogleDriveFileId(url);
    if (driveFileId) {
      return `https://drive.google.com/uc?export=download&id=${driveFileId}`;
    }

    const googleDocId = this.extractGoogleDocumentId(url);
    if (googleDocId) {
      return `https://docs.google.com/document/d/${googleDocId}/export?format=pdf`;
    }

    const googleSheetId = this.extractGoogleSpreadsheetId(url);
    if (googleSheetId) {
      return `https://docs.google.com/spreadsheets/d/${googleSheetId}/export?format=xlsx`;
    }

    return url.href;
  }

  private async resolveYandexDiskDownloadUrl(
    publicUrl: string,
  ): Promise<string> {
    const apiUrl =
      'https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=' +
      encodeURIComponent(publicUrl);

    const response = await fetch(apiUrl);
    if (!response.ok) {
      throw new BadRequestException(
        'Не удалось получить ссылку на скачивание с Яндекс.Диска',
      );
    }

    const payload = (await response.json()) as { href?: string };
    if (!payload.href) {
      throw new BadRequestException(
        'Не удалось получить ссылку на скачивание с Яндекс.Диска',
      );
    }

    return payload.href;
  }

  private parseUrl(value: string): URL {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new BadRequestException('Введите корректную ссылку');
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadRequestException(
        'Ссылка должна начинаться с http:// или https://',
      );
    }

    if (url.username || url.password) {
      throw new BadRequestException('Ссылка с авторизацией не поддерживается');
    }

    this.validateHostname(url.hostname);
    return url;
  }

  private validateHostname(hostname: string): void {
    const normalized = hostname.toLowerCase().replace(/\.$/, '');

    if (
      normalized === 'localhost' ||
      normalized.endsWith('.localhost') ||
      normalized === '127.0.0.1' ||
      normalized.startsWith('192.168.') ||
      normalized.startsWith('10.') ||
      normalized.endsWith('.local')
    ) {
      throw new BadRequestException('Ссылка на этот адрес не поддерживается');
    }
  }

  private isYandexDiskUrl(url: URL): boolean {
    const hostname = url.hostname.toLowerCase();
    return (
      hostname === 'yadi.sk' ||
      hostname.endsWith('disk.yandex.ru') ||
      hostname.endsWith('disk.yandex.com') ||
      hostname.endsWith('disk.yandex.kz')
    );
  }

  private extractGoogleDriveFileId(url: URL): string | null {
    if (!url.hostname.toLowerCase().includes('drive.google.com')) {
      return null;
    }

    const match = url.pathname.match(/\/file\/d\/([^/]+)/);
    return match?.[1] ?? null;
  }

  private extractGoogleDocumentId(url: URL): string | null {
    if (!url.hostname.toLowerCase().includes('docs.google.com')) {
      return null;
    }

    const match = url.pathname.match(/\/document\/d\/([^/]+)/);
    return match?.[1] ?? null;
  }

  private extractGoogleSpreadsheetId(url: URL): string | null {
    if (!url.hostname.toLowerCase().includes('docs.google.com')) {
      return null;
    }

    const match = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
    return match?.[1] ?? null;
  }

  private async fetchDocument(url: string): Promise<Response> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new BadRequestException('Не удалось скачать файл по ссылке');
      }

      return response;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new BadRequestException('Не удалось скачать файл по ссылке');
    }
  }

  private async readResponseBody(response: Response): Promise<ArrayBuffer> {
    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > MAX_FILE_BYTES) {
      throw new BadRequestException('Максимальный размер файла — 20 МБ');
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_BYTES) {
      throw new BadRequestException('Максимальный размер файла — 20 МБ');
    }

    if (buffer.byteLength === 0) {
      throw new BadRequestException('Файл по ссылке пустой или недоступен');
    }

    return buffer;
  }

  private resolveFileName(
    suggestedName: string | undefined,
    contentDisposition: string | null,
    url: URL,
    contentType: string | null,
  ): string {
    const fromHeader =
      this.getFileNameFromContentDisposition(contentDisposition);
    if (fromHeader) {
      return fromHeader;
    }

    const fromSuggested = suggestedName?.trim();
    if (fromSuggested) {
      return fromSuggested;
    }

    const fromPath = decodeURIComponent(
      url.pathname.split('/').filter(Boolean).at(-1) ?? '',
    );
    if (fromPath && fromPath.includes('.')) {
      return fromPath;
    }

    const extension = contentType
      ? EXTENSION_BY_MIME.get(contentType)
      : undefined;
    return extension ? `document.${extension}` : 'document.pdf';
  }

  private getFileNameFromContentDisposition(
    value: string | null,
  ): string | null {
    if (!value) {
      return null;
    }

    const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
    if (utf8Match?.[1]) {
      try {
        return decodeURIComponent(utf8Match[1]);
      } catch {
        return utf8Match[1];
      }
    }

    const plainMatch = value.match(/filename="?([^";]+)"?/i);
    return plainMatch?.[1]?.trim() ?? null;
  }

  private normalizeMimeType(value: string | null): string | null {
    if (!value) {
      return null;
    }

    return value.split(';')[0].trim().toLowerCase() || null;
  }

  private getExtension(fileName: string): string {
    const parts = fileName.trim().toLowerCase().split('.');
    return parts.length > 1 ? (parts.at(-1) ?? '') : '';
  }
}
