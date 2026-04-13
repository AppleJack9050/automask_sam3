import type { UploadEntry } from './types'

type FileEntry = FileSystemEntry & {
  file: (
    success: (file: File) => void,
    error?: (err: DOMException | Error) => void,
  ) => void
}

type DirectoryReader = {
  readEntries: (
    success: (entries: FileSystemEntry[]) => void,
    error?: (err: DOMException | Error) => void,
  ) => void
}

type DirectoryEntry = FileSystemEntry & {
  createReader: () => DirectoryReader
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null
}

function readFileEntry(entry: FileEntry, relativePath: string) {
  return new Promise<UploadEntry>((resolve, reject) => {
    entry.file(
      (file) => resolve({ file, relativePath: relativePath || file.name }),
      (error) => reject(error ?? new Error('Failed to read dropped file.')),
    )
  })
}

function readDirectoryEntries(reader: DirectoryReader) {
  return new Promise<FileSystemEntry[]>((resolve, reject) => {
    reader.readEntries(resolve, (error) =>
      reject(error ?? new Error('Failed to read dropped directory.')),
    )
  })
}

async function walkEntry(entry: FileSystemEntry, prefix = ''): Promise<UploadEntry[]> {
  const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name

  if (entry.isFile) {
    return [await readFileEntry(entry as FileEntry, relativePath)]
  }

  const reader = (entry as DirectoryEntry).createReader()
  const files: UploadEntry[] = []
  while (true) {
    const children = await readDirectoryEntries(reader)
    if (children.length === 0) {
      break
    }
    for (const child of children) {
      files.push(...(await walkEntry(child, relativePath)))
    }
  }
  return files
}

function dedupeEntries(entries: UploadEntry[]) {
  const byPath = new Map<string, UploadEntry>()
  for (const entry of entries) {
    byPath.set(entry.relativePath, entry)
  }
  return [...byPath.values()].sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  )
}

export async function collectDroppedEntries(items: DataTransferItemList | null) {
  if (!items) {
    return []
  }

  const pending: Promise<UploadEntry[]>[] = []
  for (const item of Array.from(items)) {
    const withEntry = item as DataTransferItemWithEntry
    const entry = withEntry.webkitGetAsEntry?.()
    if (entry) {
      pending.push(walkEntry(entry))
      continue
    }
    const file = item.getAsFile()
    if (file) {
      pending.push(Promise.resolve([{ file, relativePath: file.name }]))
    }
  }

  return dedupeEntries((await Promise.all(pending)).flat())
}

export function normalizeInputFiles(files: FileList | null) {
  if (!files) {
    return []
  }
  return dedupeEntries(
    Array.from(files).map((file) => ({
      file,
      relativePath:
        'webkitRelativePath' in file && file.webkitRelativePath
          ? file.webkitRelativePath
          : file.name,
    })),
  )
}

export function inferDatasetName(entries: UploadEntry[]) {
  if (entries.length === 0) {
    return 'dataset'
  }
  const roots = new Set(entries.map((entry) => entry.relativePath.split('/')[0]))
  if (roots.size === 1) {
    return [...roots][0]
  }
  if (entries.length === 1) {
    return entries[0].file.name.replace(/\.(zip|tar\.gz|tgz|png|jpe?g|webp|tiff?)$/i, '')
  }
  return `dataset-${new Date().toISOString().slice(0, 10)}`
}
