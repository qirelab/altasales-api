import { extname } from 'path';

export const CATALOG_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const CATALOG_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export const CATALOG_IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.heic',
  '.heif',
]);

export const CATALOG_IMAGE_FORMATS_LABEL = 'JPEG, PNG, WebP, HEIC, HEIF';

export const CATALOG_STORAGE_FOLDERS = ['services', 'packages', 'expert-groups'] as const;

export type CatalogStorageFolder = (typeof CATALOG_STORAGE_FOLDERS)[number];

export function isCatalogImageAllowed(
  file: Pick<Express.Multer.File, 'mimetype' | 'originalname'>,
): boolean {
  if (CATALOG_IMAGE_MIME_TYPES.has(file.mimetype)) {
    return true;
  }
  const extension = extname(file.originalname).toLowerCase();
  return CATALOG_IMAGE_EXTENSIONS.has(extension);
}
