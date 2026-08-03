import { BadRequestException } from '@nestjs/common';
import JSZip from 'jszip';

interface WorkbookSheetRef {
  name: string;
  rId: string;
  tag: string;
}

interface WorkbookRelationship {
  id: string;
  type: string;
  target: string;
  tag: string;
}

const WORKSHEET_REL_TYPE = '/worksheet';
const CALC_CHAIN_REL_TYPE = '/calcChain';
export async function listXlsxSheetNames(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await readZipText(zip, 'xl/workbook.xml');
  return parseWorkbookSheets(workbookXml).map((sheet) => sheet.name);
}
export async function extractXlsxSheetBuffer(
  buffer: Buffer,
  sheetIndex: number,
): Promise<Buffer> {
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await readZipText(zip, 'xl/workbook.xml');
  const sheets = parseWorkbookSheets(workbookXml);

  if (sheetIndex < 0 || sheetIndex >= sheets.length) {
    throw new BadRequestException('Лист не найден');
  }

  if (sheets.length === 1) {
    return buffer;
  }

  const kept = sheets[sheetIndex];
  const relsPath = 'xl/_rels/workbook.xml.rels';
  const relsXml = await readZipText(zip, relsPath);
  const relationships = parseRelationships(relsXml);
  const keptRel = relationships.find(
    (rel) => rel.id === kept.rId && rel.type.includes(WORKSHEET_REL_TYPE),
  );

  if (!keptRel) {
    throw new BadRequestException('Не удалось найти файл выбранного листа');
  }

  const keptSheetPath = resolveXlPath(keptRel.target);
  const removedSheetPaths = new Set<string>();

  for (const rel of relationships) {
    if (!rel.type.includes(WORKSHEET_REL_TYPE)) {
      continue;
    }
    if (rel.id === kept.rId) {
      continue;
    }
    removedSheetPaths.add(resolveXlPath(rel.target));
  }

  for (const path of removedSheetPaths) {
    zip.remove(path);
    const relsSibling = path.replace(
      /^(xl\/worksheets\/)([^/]+)\.xml$/i,
      '$1_rels/$2.xml.rels',
    );
    zip.remove(relsSibling);
  }

  zip.remove('xl/calcChain.xml');

  const keptSheetTag = kept.tag
    .replace(/\ssheetId="[^"]*"/i, ' sheetId="1"')
    .replace(/\ssheetId='[^']*'/i, ' sheetId=\'1\'');

  let nextWorkbookXml = replaceSheets(workbookXml, keptSheetTag);
  nextWorkbookXml = stripDefinedNames(nextWorkbookXml);
  zip.file('xl/workbook.xml', nextWorkbookXml);

  const nextRels = relationships.filter((rel) => {
    if (rel.type.includes(CALC_CHAIN_REL_TYPE)) {
      return false;
    }
    if (rel.type.includes(WORKSHEET_REL_TYPE)) {
      return rel.id === kept.rId;
    }
    return true;
  });
  zip.file(relsPath, buildRelationshipsXml(nextRels));

  const contentTypesPath = '[Content_Types].xml';
  const contentTypesXml = await readZipText(zip, contentTypesPath);
  zip.file(
    contentTypesPath,
    filterContentTypes(contentTypesXml, removedSheetPaths, keptSheetPath),
  );

  return Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
}

async function readZipText(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) {
    throw new BadRequestException(`В xlsx отсутствует ${path}`);
  }
  return file.async('text');
}

function parseWorkbookSheets(workbookXml: string): WorkbookSheetRef[] {
  const sheets: WorkbookSheetRef[] = [];
  const sheetTagRe = /<sheet\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null = sheetTagRe.exec(workbookXml);

  while (match) {
    const tag = match[0];
    const name = getAttr(tag, 'name');
    const rId = getAttr(tag, 'r:id') || getAttr(tag, 'Id');
    if (name?.trim() && rId) {
      sheets.push({ name: name.trim(), rId, tag });
    }
    match = sheetTagRe.exec(workbookXml);
  }

  return sheets;
}

function parseRelationships(relsXml: string): WorkbookRelationship[] {
  const relationships: WorkbookRelationship[] = [];
  const relRe = /<Relationship\b[^>]*\/?>/gi;
  let match: RegExpExecArray | null = relRe.exec(relsXml);

  while (match) {
    const tag = match[0];
    const id = getAttr(tag, 'Id');
    const type = getAttr(tag, 'Type') ?? '';
    const target = getAttr(tag, 'Target') ?? '';
    if (id && target) {
      relationships.push({ id, type, target, tag });
    }
    match = relRe.exec(relsXml);
  }

  return relationships;
}

function getAttr(tag: string, name: string): string | null {
  const re = new RegExp(
    `\\b${name.replace(':', '\\:')}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`,
    'i',
  );
  const match = re.exec(tag);
  return match?.[1] ?? match?.[2] ?? null;
}

function resolveXlPath(target: string): string {
  const normalized = target.replace(/\\/g, '/').replace(/^\//, '');
  if (normalized.startsWith('xl/')) {
    return normalized;
  }
  return `xl/${normalized}`;
}

function replaceSheets(workbookXml: string, keptSheetTag: string): string {
  if (!/<sheets\b[^>]*>[\s\S]*?<\/sheets>/i.test(workbookXml)) {
    throw new BadRequestException('Некорректная структура workbook.xml');
  }

  return workbookXml.replace(
    /<sheets\b[^>]*>[\s\S]*?<\/sheets>/i,
    `<sheets>${keptSheetTag}</sheets>`,
  );
}

function stripDefinedNames(workbookXml: string): string {
  return workbookXml.replace(/<definedNames\b[^>]*>[\s\S]*?<\/definedNames>/i, '');
}

function buildRelationshipsXml(relationships: WorkbookRelationship[]): string {
  const body = relationships.map((rel) => rel.tag).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    `${body}</Relationships>`
  );
}

function filterContentTypes(
  contentTypesXml: string,
  removedSheetPaths: Set<string>,
  keptSheetPath: string,
): string {
  const removedPartNames = new Set(
    [...removedSheetPaths].map((path) => `/${path}`),
  );
  removedPartNames.add('/xl/calcChain.xml');

  return contentTypesXml.replace(/<Override\b[^>]*\/?>/gi, (tag) => {
    const partName = getAttr(tag, 'PartName');
    if (!partName) {
      return tag;
    }

    const normalized = partName.replace(/\\/g, '/');
    if (removedPartNames.has(normalized)) {
      return '';
    }
    if (
      /\/xl\/worksheets\/[^/]+\.xml$/i.test(normalized) &&
      normalized !== `/${keptSheetPath}`
    ) {
      return '';
    }

    if (/\/xl\/calcChain\.xml$/i.test(normalized)) {
      return '';
    }

    return tag;
  });
}
