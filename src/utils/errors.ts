export class PubcopyError extends Error {
  elementType: string;
  filePath: string;
  reason: string;

  constructor(elementType: string, filePath: string, reason: string) {
    super(`[Pubcopy] ${elementType} in ${filePath}: ${reason}`);
    this.name = "PubcopyError";
    this.elementType = elementType;
    this.filePath = filePath;
    this.reason = reason;
  }
}

export interface ConversionWarning {
  elementType: string;
  fileName: string;
  reason: string;
}

export class WarningCollector {
  private warnings: ConversionWarning[] = [];

  add(elementType: string, fileName: string, reason: string): void {
    this.warnings.push({ elementType, fileName, reason });
  }

  getWarnings(): ConversionWarning[] {
    return [...this.warnings];
  }

  hasWarnings(): boolean {
    return this.warnings.length > 0;
  }

  clear(): void {
    this.warnings = [];
  }
}
