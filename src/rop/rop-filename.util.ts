export function repairUtf8Mojibake(value: string | null | undefined): string {
  if (!value) {
    return value ?? '';
  }

  if (!/[\u0080-\u00FF]/.test(value)) {
    return value;
  }

  const tryDecode = (chunk: string): string | null => {
    try {
      const repaired = Buffer.from(chunk, 'latin1').toString('utf8');
      if (repaired.includes('\uFFFD') || repaired === chunk) {
        return null;
      }

      if (/[А-Яа-яЁё]/.test(repaired)) {
        return repaired;
      }
    } catch {
      return null;
    }

    return null;
  };

  if (!/[А-Яа-яЁё]/.test(value)) {
    return tryDecode(value) ?? value;
  }

  return value.replace(
    /(?:[\u00C0-\u00FF][\u0080-\u00BF]+(?:[ ]+[\u00C0-\u00FF][\u0080-\u00BF]+)*)+/g,
    (chunk) => tryDecode(chunk) ?? chunk,
  );
}

export function decodeMulterOriginalName(
  originalname: string | null | undefined,
): string {
  return repairUtf8Mojibake(originalname);
}
