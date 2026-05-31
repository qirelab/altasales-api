import { Injectable } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { extname, parse } from 'path';
import { TranscriptionProviderError } from './transcription-provider-error';

type ObjectStorageClient = Pick<S3Client, 'send'>;

export type UploadedAudioObject = {
  key: string;
  uri: string;
};

const DEFAULT_REGION = 'ru-central1';
const STORAGE_ENDPOINT = 'https://storage.yandexcloud.net';

@Injectable()
export class YandexObjectStorageService {
  constructor(private readonly client?: ObjectStorageClient) {}

  async uploadAudio(
    jobId: string,
    file: Express.Multer.File,
  ): Promise<UploadedAudioObject> {
    const config = this.getConfig();
    const key = this.buildObjectKey(jobId, file.originalname);

    try {
      await this.getClient(config).send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: file.buffer,
          ContentType: file.mimetype,
        }),
      );
    } catch {
      throw new TranscriptionProviderError(
        'TRANSCRIPTION_UPLOAD_FAILED',
        'Audio upload failed',
      );
    }

    return {
      key,
      uri: `${STORAGE_ENDPOINT}/${config.bucket}/${key}`,
    };
  }

  private getClient(config: ObjectStorageConfig): ObjectStorageClient {
    if (this.client) {
      return this.client;
    }

    return new S3Client({
      endpoint: STORAGE_ENDPOINT,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private getConfig(): ObjectStorageConfig {
    const bucket = process.env.YANDEX_OBJECT_STORAGE_BUCKET?.trim();
    const region = process.env.YANDEX_OBJECT_STORAGE_REGION?.trim() || DEFAULT_REGION;
    const accessKeyId = process.env.YANDEX_OBJECT_STORAGE_ACCESS_KEY_ID?.trim();
    const secretAccessKey = process.env.YANDEX_OBJECT_STORAGE_SECRET_ACCESS_KEY?.trim();

    if (!bucket || !region || !accessKeyId || !secretAccessKey) {
      throw new TranscriptionProviderError(
        'TRANSCRIPTION_UPLOAD_FAILED',
        'Object Storage is not configured',
      );
    }

    return { bucket, region, accessKeyId, secretAccessKey };
  }

  private buildObjectKey(jobId: string, originalName: string): string {
    const extension = extname(originalName).toLowerCase();
    const baseName = parse(originalName).name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    const safeName = `${baseName || 'audio'}${extension}`;
    return `transcription/${jobId}/${safeName}`;
  }
}

type ObjectStorageConfig = {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};
