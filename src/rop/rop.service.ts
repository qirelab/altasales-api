import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';

export interface RopProject {
  id: string;
  name: string;
  partner_id: string;
}

export interface RopDocument {
  id: string;
  project_id: string;
  name: string;
  category: string;
  link: string;
  status: string;
}

export interface RopDownloadUrlResponse {
  url: string;
  expires_at: string;
}

@Injectable()
export class RopService {
  private readonly logger = new Logger(RopService.name);
  private readonly apiUrl: string;
  private readonly apiKey: string;

  constructor() {
    this.apiUrl = process.env.ROP_API_URL || '';
    this.apiKey = process.env.ROP_API_KEY || '';

    if (!this.apiUrl || !this.apiKey) {
      this.logger.warn('ROP API credentials not configured. File storage will not work.');
    }
  }

  private get headers(): Record<string, string> {
    return {
      'X-API-Key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  private isConfigured(): boolean {
    return Boolean(this.apiUrl && this.apiKey);
  }

  async createProject(name: string, partnerId: string): Promise<RopProject> {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }

    const response = await fetch(`${this.apiUrl}/projects`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        name,
        partner_id: partnerId,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to create ROP project: ${error}`);
      throw new InternalServerErrorException('Failed to create project in ROP');
    }

    return response.json();
  }

  async createDocument(
    projectId: string,
    name: string,
    category: string = 'other',
  ): Promise<RopDocument> {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }

    const response = await fetch(`${this.apiUrl}/projects/${projectId}/documents`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        name,
        category,
        link: '',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to create ROP document: ${error}`);
      throw new InternalServerErrorException('Failed to create document in ROP');
    }

    return response.json();
  }

  async uploadFile(
    projectId: string,
    documentId: string,
    file: Express.Multer.File,
  ): Promise<RopDocument> {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }

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
      this.logger.error(`Failed to upload file to ROP: ${error}`);
      throw new InternalServerErrorException('Failed to upload file to ROP');
    }

    return response.json();
  }

  async getDownloadUrl(projectId: string, documentId: string): Promise<string> {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/documents/${documentId}/download-url`,
      {
        method: 'GET',
        headers: this.headers,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to get download URL from ROP: ${error}`);
      throw new InternalServerErrorException('Failed to get download URL from ROP');
    }

    const data: RopDownloadUrlResponse = await response.json();
    return data.url;
  }

  async deleteDocument(projectId: string, documentId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new InternalServerErrorException('ROP API not configured');
    }

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/documents/${documentId}`,
      {
        method: 'DELETE',
        headers: this.headers,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logger.error(`Failed to delete document from ROP: ${error}`);
      throw new InternalServerErrorException('Failed to delete document from ROP');
    }
  }
}
