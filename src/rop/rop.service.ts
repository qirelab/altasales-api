import { randomBytes } from 'crypto';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  RopDocumentRecord,
  RopMeetingRecord,
  RopTaskListFilters,
  RopTaskRecord,
} from './rop.types';

export interface RopProject {
  id: string;
  name: string;
}

export interface RopUser {
  id: string;
  email: string;
}

export interface CreateRopUserPayload {
  email: string;
  password: string;
  projectId: string;
  firstName?: string | null;
  lastName?: string | null;
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
      this.logger.warn(
        'ROP API credentials not configured. ROP integration is disabled.',
      );
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

  private logRopFailure(
    action: string,
    response: Response,
    body: string,
  ): void {
    const requestId = response.headers.get('X-Request-ID');
    const suffix = requestId ? ` [X-Request-ID: ${requestId}]` : '';
    this.logger.error(
      `ROP ${action} failed (${response.status}): ${body}${suffix}`,
    );
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

    const data = (await response.json()) as {
      id: string | number;
      name: string;
    };
    return {
      id: this.normalizeId(data.id),
      name: data.name,
    };
  }

  generateUserPassword(): string {
    return randomBytes(24).toString('base64url');
  }

  async createUser(payload: CreateRopUserPayload): Promise<RopUser | null> {
    this.ensureConfigured();

    const projectId = Number(payload.projectId);
    const body: Record<string, unknown> = {
      email: payload.email.trim(),
      password: payload.password,
      role: 'api_client',
      project_id: Number.isFinite(projectId) ? projectId : payload.projectId,
    };
    if (payload.firstName?.trim()) {
      body.first_name = payload.firstName.trim();
    }
    if (payload.lastName?.trim()) {
      body.last_name = payload.lastName.trim();
    }

    const response = await fetch(`${this.apiUrl}/users`, {
      method: 'POST',
      headers: this.jsonHeaders,
      body: JSON.stringify(body),
    });

    if (response.status === 409) {
      this.logger.warn(
        `ROP user already exists for email ${payload.email.trim()}`,
      );
      return null;
    }

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('create user', response, error);
      throw new InternalServerErrorException('Failed to create user in ROP');
    }

    const data = (await response.json()) as {
      id: string | number;
      email: string;
    };
    return {
      id: this.normalizeId(data.id),
      email: data.email,
    };
  }

  async listDocuments(projectId: string): Promise<RopDocumentRecord[]> {
    this.ensureConfigured();

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/documents`,
      {
        method: 'GET',
        headers: this.jsonHeaders,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('list documents', response, error);
      throw new InternalServerErrorException(
        'Failed to list documents from ROP',
      );
    }

    return response.json() as Promise<RopDocumentRecord[]>;
  }

  async getDocument(
    projectId: string,
    documentId: string,
  ): Promise<RopDocumentRecord> {
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

  async getDocumentAnalyze(
    projectId: string,
    documentId: string,
  ): Promise<Record<string, unknown>> {
    this.ensureConfigured();

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/documents/${documentId}/analyze`,
      {
        method: 'GET',
        headers: this.jsonHeaders,
      },
    );

    if (response.status === 404) {
      throw new NotFoundException('Результат анализа документа не найден');
    }

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('get document analysis', response, error);
      throw new InternalServerErrorException(
        'Failed to get document analysis from ROP',
      );
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  async createDocument(
    projectId: string,
    name: string,
    options?: {
      link?: string;
      categoryId?: number;
    },
  ): Promise<RopDocument> {
    this.ensureConfigured();

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/documents`,
      {
        method: 'POST',
        headers: this.jsonHeaders,
        body: JSON.stringify({
          name,
          ...(options?.link ? { link: options.link } : {}),
          ...(options?.categoryId != null
            ? { category_id: options.categoryId }
            : {}),
        }),
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('create document', response, error);
      throw new InternalServerErrorException(
        'Failed to create document in ROP',
      );
    }

    const data = (await response.json()) as {
      id: string | number;
    } & RopDocument;
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

    const blob = new Blob([new Uint8Array(file.buffer)], {
      type: file.mimetype,
    });
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

    const data = (await response.json()) as {
      id: string | number;
    } & RopDocument;
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
      throw new InternalServerErrorException(
        'Failed to get download URL from ROP',
      );
    }

    const data = (await response.json()) as { download_url: string };
    return data.download_url;
  }

  async listTasks(
    projectId: string,
    filters: RopTaskListFilters = {},
  ): Promise<RopTaskRecord[]> {
    this.ensureConfigured();

    const params = new URLSearchParams();
    if (filters.startDate) {
      params.set('start_date', filters.startDate);
    }
    if (filters.endDate) {
      params.set('end_date', filters.endDate);
    }

    const query = params.toString();
    const url = `${this.apiUrl}/projects/${projectId}/tasks${query ? `?${query}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.jsonHeaders,
    });

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('list tasks', response, error);
      throw new InternalServerErrorException('Failed to list tasks from ROP');
    }

    return response.json() as Promise<RopTaskRecord[]>;
  }

  async getTask(projectId: string, taskId: string): Promise<RopTaskRecord> {
    this.ensureConfigured();

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/tasks/${taskId}`,
      {
        method: 'GET',
        headers: this.jsonHeaders,
      },
    );

    if (response.status === 404) {
      throw new NotFoundException('Задача не найдена');
    }

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('get task', response, error);
      throw new InternalServerErrorException('Failed to get task from ROP');
    }

    return response.json() as Promise<RopTaskRecord>;
  }

  async getDepartmentMonthDashboard(
    projectId: string,
    departmentId: string,
    startDate?: string,
    endDate?: string,
  ): Promise<Record<string, unknown>> {
    this.ensureConfigured();

    const params = new URLSearchParams();
    if (startDate) {
      params.set('start_date', startDate);
    }
    if (endDate) {
      params.set('end_date', endDate);
    }
    const query = params.toString();
    const url = `${this.apiUrl}/projects/${projectId}/departments/${departmentId}/dashboard${query ? `?${query}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.jsonHeaders,
    });

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('get month dashboard', response, error);
      throw new InternalServerErrorException(
        'Failed to get month dashboard from ROP',
      );
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  async getDepartmentIntervalDashboard(
    projectId: string,
    departmentId: string,
    startDate: string,
    endDate: string,
  ): Promise<Record<string, unknown>> {
    this.ensureConfigured();

    const params = new URLSearchParams();
    params.set('start_date', startDate);
    params.set('end_date', endDate);
    const query = params.toString();
    const url = `${this.apiUrl}/projects/${projectId}/departments/${departmentId}/interval-dashboard?${query}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.jsonHeaders,
    });

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('get interval dashboard', response, error);
      throw new InternalServerErrorException(
        'Failed to get interval dashboard from ROP',
      );
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  async getDepartmentBenchmarkDecomposition(
    projectId: string,
    departmentId: string,
    analyzeDate: string,
  ): Promise<Record<string, unknown>> {
    this.ensureConfigured();

    const params = new URLSearchParams();
    params.set('analyze_date', analyzeDate);
    const url = `${this.apiUrl}/projects/${projectId}/departments/${departmentId}/benchmark-analyze?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.jsonHeaders,
    });

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('get benchmark decomposition', response, error);
      throw new InternalServerErrorException(
        'Failed to get benchmark decomposition from ROP',
      );
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  async listMeetings(projectId: string): Promise<RopMeetingRecord[]> {
    this.ensureConfigured();

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/meetings`,
      {
        method: 'GET',
        headers: this.jsonHeaders,
      },
    );

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('list meetings', response, error);
      throw new InternalServerErrorException(
        'Failed to list meetings from ROP',
      );
    }

    return response.json() as Promise<RopMeetingRecord[]>;
  }

  async getMeeting(
    projectId: string,
    meetingId: string,
  ): Promise<RopMeetingRecord> {
    this.ensureConfigured();

    const response = await fetch(
      `${this.apiUrl}/projects/${projectId}/meetings/${meetingId}`,
      {
        method: 'GET',
        headers: this.jsonHeaders,
      },
    );

    if (response.status === 404) {
      throw new NotFoundException('Встреча не найдена');
    }

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('get meeting', response, error);
      throw new InternalServerErrorException('Failed to get meeting from ROP');
    }

    return response.json() as Promise<RopMeetingRecord>;
  }

  async createSsoLoginLink(
    email: string,
  ): Promise<{ loginUrl: string; expiresIn: number }> {
    this.ensureConfigured();

    const response = await fetch(`${this.apiUrl}/sso/login-link`, {
      method: 'POST',
      headers: this.jsonHeaders,
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('create SSO login link', response, error);
      throw new InternalServerErrorException(
        'Failed to create ROP SSO login link',
      );
    }

    const data = (await response.json()) as {
      login_url?: string;
      loginUrl?: string;
      expires_in?: number;
      expiresIn?: number;
    };

    const loginUrl = data.login_url ?? data.loginUrl;
    if (!loginUrl) {
      throw new InternalServerErrorException(
        'ROP SSO login link response is missing login_url',
      );
    }

    return {
      loginUrl,
      expiresIn: data.expires_in ?? data.expiresIn ?? 120,
    };
  }

  async activateSubscription(payload: {
    email: string;
    projectId: string;
    tariff: string;
  }): Promise<void> {
    this.ensureConfigured();

    const projectId = Number(payload.projectId);
    const body = {
      email: payload.email,
      project_id: Number.isFinite(projectId) ? projectId : payload.projectId,
      tariff: payload.tariff,
    };

    const response = await fetch(`${this.apiUrl}/users/subscription/activate`, {
      method: 'POST',
      headers: this.jsonHeaders,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('activate subscription', response, error);
      throw new InternalServerErrorException(
        'Failed to activate ROP subscription',
      );
    }
  }

  async deactivateSubscription(payload: {
    email: string;
    projectId: string;
  }): Promise<void> {
    this.ensureConfigured();

    const projectId = Number(payload.projectId);
    const body = {
      email: payload.email,
      project_id: Number.isFinite(projectId) ? projectId : payload.projectId,
    };

    const response = await fetch(
      `${this.apiUrl}/users/subscription/deactivate`,
      {
        method: 'POST',
        headers: this.jsonHeaders,
        body: JSON.stringify(body),
      },
    );

    if (response.status === 404) {
      this.logger.warn(
        `ROP deactivate skipped: user/project not found for ${payload.email}`,
      );
      return;
    }

    if (!response.ok) {
      const error = await response.text();
      this.logRopFailure('deactivate subscription', response, error);
      throw new InternalServerErrorException(
        'Failed to deactivate ROP subscription',
      );
    }
  }
}
