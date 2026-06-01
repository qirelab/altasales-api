export const CATALOG_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const CATALOG_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const CATALOG_STORAGE_FOLDERS = ['services', 'packages'] as const;

export type CatalogStorageFolder = (typeof CATALOG_STORAGE_FOLDERS)[number];
