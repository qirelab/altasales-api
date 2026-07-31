import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { getFileExtension } from './rop-analyze-upload-profile';
import { decodeMulterOriginalName } from './rop-filename.util';

export type DashboardFilePartType = 'page' | 'sheet' | 'file';

export interface DashboardFilePart {
  id: string;
  label: string;
}

export interface DashboardFileInspectResult {
  parts: DashboardFilePart[];
  partType: DashboardFilePartType;
}

const WHOLE_FILE_PART: DashboardFilePart = {
  id: 'all',
  label: 'Весь файл',
};

@Injectable()
export class RopDashboardFilePartsService {
  async inspect(
    file: Express.Multer.File,
  ): Promise<DashboardFileInspectResult> {
    const extension = getFileExtension(file.originalname);

    if (extension === 'pdf') {
      return this.inspectPdf(file.buffer);
    }

    if (extension === 'xlsx') {
      return this.inspectXlsx(file.buffer);
    }

    return {
      parts: [WHOLE_FILE_PART],
      partType: 'file',
    };
  }

  async extractPart(
    file: Express.Multer.File,
    partId: string,
  ): Promise<Express.Multer.File> {
    if (partId === 'all') {
      return file;
    }

    const extension = getFileExtension(file.originalname);

    if (partId.startsWith('page:')) {
      if (extension !== 'pdf') {
        throw new BadRequestException(
          'Выбранная страница недоступна для этого файла',
        );
      }

      const pageNumber = Number(partId.slice('page:'.length));
      if (!Number.isInteger(pageNumber) || pageNumber < 1) {
        throw new BadRequestException('Некорректный номер страницы');
      }

      return this.extractPdfPage(file, pageNumber);
    }

    if (partId.startsWith('sheet:')) {
      if (extension !== 'xlsx') {
        throw new BadRequestException(
          'Выбранный лист недоступен для этого файла',
        );
      }

      const sheetIndex = Number(partId.slice('sheet:'.length));
      if (!Number.isInteger(sheetIndex) || sheetIndex < 0) {
        throw new BadRequestException('Некорректный номер листа');
      }

      return this.extractXlsxSheet(file, sheetIndex);
    }

    throw new BadRequestException('Некорректный фрагмент файла');
  }

  private async inspectPdf(
    buffer: Buffer,
  ): Promise<DashboardFileInspectResult> {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pageCount = pdf.getPageCount();

    if (pageCount <= 1) {
      return {
        parts: [{ id: 'page:1', label: 'Страница 1' }],
        partType: 'page',
      };
    }

    return {
      parts: Array.from({ length: pageCount }, (_, index) => ({
        id: `page:${index + 1}`,
        label: `Страница ${index + 1}`,
      })),
      partType: 'page',
    };
  }

  private async inspectXlsx(
    buffer: Buffer,
  ): Promise<DashboardFileInspectResult> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(this.toArrayBuffer(buffer));
    const sheets = workbook.worksheets.filter((sheet) => sheet.name);

    if (sheets.length <= 1) {
      const sheet = sheets[0];
      return {
        parts: [
          {
            id: 'sheet:0',
            label: sheet?.name ?? 'Лист 1',
          },
        ],
        partType: 'sheet',
      };
    }

    return {
      parts: sheets.map((sheet, index) => ({
        id: `sheet:${index}`,
        label: sheet.name || `Лист ${index + 1}`,
      })),
      partType: 'sheet',
    };
  }

  private async extractPdfPage(
    file: Express.Multer.File,
    pageNumber: number,
  ): Promise<Express.Multer.File> {
    const source = await PDFDocument.load(file.buffer, {
      ignoreEncryption: true,
    });
    const pageCount = source.getPageCount();

    if (pageNumber > pageCount) {
      throw new BadRequestException('Страница не найдена');
    }

    const target = await PDFDocument.create();
    const [page] = await target.copyPages(source, [pageNumber - 1]);
    target.addPage(page);

    const bytes = await target.save();
    const baseName =
      decodeMulterOriginalName(file.originalname).replace(/\.pdf$/i, '') ||
      'dashboard';

    return this.toMulterFile(
      Buffer.from(bytes),
      `${baseName}-page-${pageNumber}.pdf`,
      'application/pdf',
    );
  }

  private async extractXlsxSheet(
    file: Express.Multer.File,
    sheetIndex: number,
  ): Promise<Express.Multer.File> {
    const source = new ExcelJS.Workbook();
    await source.xlsx.load(this.toArrayBuffer(file.buffer));
    const sourceSheet = source.worksheets[sheetIndex];

    if (!sourceSheet) {
      throw new BadRequestException('Лист не найден');
    }

    const target = new ExcelJS.Workbook();
    const targetSheet = target.addWorksheet(sourceSheet.name);

    sourceSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        targetSheet.getCell(rowNumber, colNumber).value = cell.value;
      });
    });

    targetSheet.columns = sourceSheet.columns.map((column) => ({ ...column }));

    const bytes = await target.xlsx.writeBuffer();
    const baseName =
      decodeMulterOriginalName(file.originalname).replace(/\.xlsx$/i, '') ||
      'dashboard';
    const safeSheetName = sourceSheet.name.replace(/[^\wа-яА-ЯёЁ.-]+/gu, '_');

    return this.toMulterFile(
      Buffer.from(bytes),
      `${baseName}-${safeSheetName}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }

  private toArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    ) as ArrayBuffer;
  }

  private toMulterFile(
    buffer: Buffer,
    originalname: string,
    mimetype: string,
  ): Express.Multer.File {
    return {
      fieldname: 'file',
      originalname,
      encoding: '7bit',
      mimetype,
      buffer,
      size: buffer.length,
    } as Express.Multer.File;
  }
}
