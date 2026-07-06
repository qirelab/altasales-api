import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';

import { RopDocumentRecord } from './rop.types';

export interface RopProject {
  id: string;
  name: string;
}

export interface RopDocument {
  id: string;
  project_id: string;
  name: string;
  link?: string;
  status?: string;
}

@Injectable()
export class RopService {
  private readonly logger = new Logger(RopService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.apiUrl = process.env.ROP_API_URL || '';
    this.apiKey = process.env.ROP_API_KEY || '';

    if (!this.isConfigured()) {
      this.logger.warn('ROP API credentials not configured. ROP integration is disabled.');
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiUrl && this.apiKey);
  }

  private get jsonHeaders(): Record<string, string> {
    return {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private normalizeId(value: string | number): string {
    return String(value);
  }

  private logRopFailure(action: string, response: Response, body: string): void {
    const requestId = response.headers.get('X-Request-ID');
    const suffix = requestId ? ` [X-Request-ID: ${requestId}]` : '';
    this.logger.error(`ROP ${action} failed (${response.status}): ${body}${suffix}`);
  }

  private ensureConfigured(): void {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }
  }

  async createProject(name: string): Promise<RopProject> {
    this.ensureConfigured();

    const response = await fetch(`${this.apiUrl}/projects`, {
      method: 'POST',
      headers: this.jsonHeaders,
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('create project', response, error);
      throw new InternalServerErrorException('Failed to create project in ROP');
    }

    const data = await response.json() as { id: string | number; name: string };
    return {
      id: this.normalizeId(data.id),
      name: data.name,
    };
  }

  async listDocuments(projectId: string): Promise<RopDocumentRecord[]> {
    this.ensureConfigured();

    const response = await fetch(`${this.apiUrl}/projects/${projectId}/documents`, {
      method: 'GET',
      headers: this.jsonHeaders,
    });

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('list documents', response, error);
      throw new InternalServerErrorException('Failed to list documents from ROP');
    }

    return response.json() as Promise<RopDocumentRecord[]>;
  }

  async getDocument(projectId: string, documentId: string): Promise<RopDocumentRecord> {
    this.ensureConfigured();

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/documents/${documentId}`,
      {
        method: 'GET',
        headers: this.jsonHeaders,
      },
    );

    if (response.status === 404) {
      throw new NotFoundException('Документ не найден');
    }

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('get document', response, error);
      throw new InternalServerErrorException('Failed to get document from ROP');
    }

    return response.json() as Promise<RopDocumentRecord>;
  }

  async createDocument(
    projectId: string,
    name: string,
  ): Promise<RopDocument> {
    this.ensureConfigured();

    const response = await fetch(`${this.apiUrl}/projects/${projectId}/documents`, {
      method: 'POST',
      headers: this.jsonHeaders,
      body: JSON.stringify({ name }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('create document', response, error);
      throw new InternalServerErrorException('Failed to create document in ROP');
    }

    const data = await response.json() as { id: string | number } & RopDocument;
    return {
      ...data,
      id: this.normalizeId(data.id),
    };
  }

  async uploadFile(
    projectId: string,
    documentId: string,
    file: Express.Multer.File,
  ): Promise<RopDocument> {
    this.ensureConfigured();

    const blob = new Blob([new Uint8Array(file.buffer)], { type: file.mimetype });
    const formData = new FormData();
    formData.append('file', blob, file.originalname);

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/documents/${documentId}/upload`,
      {
        method: 'POST',
        headers: {
          'X-API-Key': this.apiKey,
        },
        body: formData,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('upload file', response, error);
      throw new InternalServerErrorException('Failed to upload file to ROP');
    }

    const data = await response.json() as { id: string | number } & RopDocument;
    return {
      ...data,
      id: this.normalizeId(data.id),
    };
  }

  async getDownloadUrl(projectId: string, documentId: string): Promise<string> {
    this.ensureConfigured();

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/documents/${documentId}/download-url`,
      {
        method: 'GET',
        headers: this.jsonHeaders,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('get download URL', response, error);
      throw new InternalServerErrorException('Failed to get download URL from ROP');
    }

    const data = await response.json() as { download_url: string };
    return data.download_url;
  }
}
