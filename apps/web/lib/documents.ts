/**
 * Turn a requirements document into plain text, in the browser. Nothing is uploaded.
 *
 * Each format is one reader in a list: to support a new format (say, .rtf or .odt), add a reader.
 * Readers for heavy formats load their library only when such a file is picked, so the page
 * itself stays light.
 */

export interface DocumentReader {
  /** What the person sees, e.g. "PDF". */
  label: string;
  extensions: string[];
  mimeTypes: string[];
  /** Largest file this reader accepts. */
  maxBytes: number;
  read: (file: File) => Promise<string>;
}

export class DocumentError extends Error {}

const MB = 1024 * 1024;

const plainText: DocumentReader = {
  label: 'Text or Markdown',
  extensions: ['.txt', '.text', '.md', '.markdown'],
  mimeTypes: ['text/plain', 'text/markdown'],
  maxBytes: 1 * MB,
  read: (file) => file.text(),
};

/** Lines of a PDF page from its positioned text pieces: same baseline → same line. */
export function linesFromItems(items: readonly { str: string; transform: number[]; hasEOL?: boolean }[]): string[] {
  const lines: string[] = [];
  let current = '';
  let lastY: number | undefined;
  for (const item of items) {
    const y = Math.round(item.transform[5] ?? 0);
    if (lastY !== undefined && Math.abs(y - lastY) > 2 && current.trim()) {
      lines.push(current.trim());
      current = '';
    }
    current += item.str;
    lastY = y;
    if (item.hasEOL && current.trim()) {
      lines.push(current.trim());
      current = '';
      lastY = undefined;
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines;
}

const pdf: DocumentReader = {
  label: 'PDF',
  extensions: ['.pdf'],
  mimeTypes: ['application/pdf'],
  maxBytes: 15 * MB,
  read: async (file) => {
    const pdfjs = await import('pdfjs-dist');
    // The parser runs in its own worker, bundled from the same package version.
    pdfjs.GlobalWorkerOptions.workerSrc ||= new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
    // No fonts or files from the network, no forms or scripts: the document is only read for its text.
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, useSystemFonts: false, enableXfa: false, stopAtErrors: false });
    const doc = await task.promise;
    try {
      const pages: string[] = [];
      for (let number = 1; number <= Math.min(doc.numPages, 300); number++) {
        const page = await doc.getPage(number);
        const content = await page.getTextContent();
        const items = content.items.filter((item) => 'str' in item) as { str: string; transform: number[]; hasEOL?: boolean }[];
        pages.push(linesFromItems(items).join('\n'));
        page.cleanup();
      }
      const text = pages.join('\n\n');
      if (!text.trim()) throw new DocumentError('This PDF has no text to read — it may be a scan. Export it with text, or paste the requirements.');
      return text;
    } finally {
      void task.destroy();
    }
  },
};

const word: DocumentReader = {
  label: 'Word',
  extensions: ['.docx'],
  mimeTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  maxBytes: 15 * MB,
  read: async (file) => {
    const mammoth = (await import('mammoth')) as unknown as { extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>; default?: { extractRawText: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> } };
    const extract = mammoth.extractRawText ?? mammoth.default?.extractRawText;
    if (!extract) throw new DocumentError('The Word reader couldn’t load.');
    const { value } = await extract({ arrayBuffer: await file.arrayBuffer() });
    // Word puts a blank line between paragraphs; one line per paragraph reads better here.
    return value.replace(/\n{2,}/g, '\n');
  },
};

export const READERS: readonly DocumentReader[] = [plainText, pdf, word];

/** The `accept` value for a file input that takes every supported format. */
export const ACCEPT = READERS.flatMap((reader) => [...reader.extensions, ...reader.mimeTypes]).join(',');
export const FORMATS_TEXT = 'PDF, Word (.docx), text or Markdown';

export function readerFor(file: { name: string; type: string }): DocumentReader | undefined {
  const name = file.name.toLowerCase();
  return READERS.find((reader) => reader.extensions.some((extension) => name.endsWith(extension))) ?? READERS.find((reader) => reader.mimeTypes.includes(file.type));
}

/** Read any supported file to text, or throw a DocumentError with a plain reason. */
export async function readDocument(file: File): Promise<string> {
  const reader = readerFor(file);
  if (!reader) throw new DocumentError(/\.doc$/i.test(file.name) ? 'Old Word files (.doc) aren’t read. Save it as .docx or PDF, or paste the text.' : `Use a ${FORMATS_TEXT} file, or paste the text below.`);
  if (file.size > reader.maxBytes) throw new DocumentError(`That ${reader.label} file is over ${Math.round(reader.maxBytes / MB)} MB. Use a smaller file or paste the requirements part.`);
  try {
    return await reader.read(file);
  } catch (error) {
    if (error instanceof DocumentError) throw error;
    throw new DocumentError(`That ${reader.label} file couldn’t be read. It may be damaged or protected with a password.`);
  }
}
