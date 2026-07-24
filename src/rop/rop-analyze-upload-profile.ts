import { BadRequestException } from '@nestjs/common';

export interface RopAnalyzeUploadProfile {
  maxBytes: number;
  allowedExtensions: ReadonlySet<string>;
  formatErrorMessage: string;
  sizeErrorMessage: string;
}

export const ROP_DOCUMENT_ANALYZE_UPLOAD_PROFILE: RopAnalyzeUploadProfile = {
  maxBytes: 20 * 1024 * 1024,
  allowedExtensions: new Set(['pdf', 'docx', 'xlsx']),
  formatErrorMessage: 'Допустимы только файлы PDF, DOCX или XLSX',
  sizeErrorMessage: 'Максимальный размер файла — 20 МБ',
};

export const ROP_DASHBOARD_ANALYZE_UPLOAD_PROFILE: RopAnalyzeUploadProfile = {
  maxBytes: 25 * 1024 * 1024,
  allowedExtensions: new Set(['pdf', 'xlsx', 'csv', 'png', 'jpg', 'jpeg', 'webp']),
  formatErrorMessage: 'Допустимы только файлы XLSX, CSV, PDF или скрин (PNG, JPG, WEBP)',
  sizeErrorMessage: 'Максимальный размер файла — 25 МБ',
};

export function getAnalyzeUploadProfileByCategoryId(
  categoryId: number,
  dashboardCategoryId: number,
): RopAnalyzeUploadProfile {
  if (categoryId === dashboardCategoryId) {
    return ROP_DASHBOARD_ANALYZE_UPLOAD_PROFILE;
  }

  return ROP_DOCUMENT_ANALYZE_UPLOAD_PROFILE;
}

export function getFileExtension(fileName: string): string {
  const parts = fileName.trim().toLowerCase().split('.');
  return parts.length > 1 ? (parts.at(-1) ?? '') : '';
}

export function assertAnalyzeUploadFile(
  file: Express.Multer.File,
  profile: RopAnalyzeUploadProfile,
): void {
  const extension = getFileExtension(file.originalname);
  if (!profile.allowedExtensions.has(extension)) {
    throw new BadRequestException(profile.formatErrorMessage);
  }

  if (file.size > profile.maxBytes) {
    throw new BadRequestException(profile.sizeErrorMessage);
  }
}
