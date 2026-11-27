// Linked Obsidian Folder Sync via File System Access API (zero external dependencies)
import { metaOf, parseChartHeader, parseRoomAndNameFromTitle } from './census.js';

export function isDirectoryPickerSupported() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function hashContent(str) {
  const norm = String(str || '').replace(/\r\n/g, '\n');
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function sanitizeFileSegment(raw) {
  return String(raw || '')
    .replace(/[\u0000-\u001f/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^\.+|\.+$/g, '')
    .trim();
}

export function isConflictCopyFileName(fileName) {
  return /\(Kardex conflict\b/i.test(String(fileName || ''));
}

export function isSyncableVaultFileName(fileName) {
  const clean = String(fileName || '').trim();
  if (!clean || clean.startsWith('.')) return false;
  if (!/\.(?:md|markdown)$/i.test(clean)) return false;
  if (isConflictCopyFileName(clean)) return false;
  return true;
}

export function computeVaultFileName(room, name, existingNames = new Set()) {
  const cleanRoom = sanitizeFileSegment(room);
  const cleanName = sanitizeFileSegment(name);
  const hasRoom = Boolean(cleanRoom && cleanRoom.toLowerCase() !== 'unassigned');
  const hasName = Boolean(cleanName && cleanName.toLowerCase() !== 'untitled note');

  let base = 'Untitled';
  if (hasRoom && hasName) base = `${cleanRoom} - ${cleanName}`;
  else if (hasName) base = cleanName;
  else if (hasRoom) base = cleanRoom;

  const taken = new Set(
    Array.from(existingNames || [], (n) => String(n || '').trim().toLowerCase()).filter(Boolean)
  );

  let candidate = `${base}.md`;
  let counter = 2;
  while (taken.has(candidate.toLowerCase())) {
    candidate = `${base} (${counter}).md`;
    counter++;
  }
  return candidate;
}

function isFrontmatterCensusTrue(content) {
  const m = metaOf(content);
  return /^true(?:\s+#.*)?$/i.test(String(m.census || '').trim());
}

export async function resolveUniqueVaultFileName(dirHandle, room, name, existingNames = new Set()) {
  const taken = new Set(
    Array.from(existingNames || [], (n) => String(n || '').trim().toLowerCase()).filter(Boolean)
  );
  for (let i = 0; i < 200; i++) {
    const candidate = computeVaultFileName(room, name, taken);
    if (!dirHandle || typeof dirHandle.getFileHandle !== 'function') {
      return candidate;
    }
    try {
      await dirHandle.getFileHandle(candidate, { create: false });
      taken.add(candidate.toLowerCase());
    } catch (err) {
      if (err?.name === 'NotFoundError') {
        return candidate;
      }
      return candidate;
    }
  }
  return computeVaultFileName(room, name, taken);
}

export function buildConflictFileName(fileName, now = new Date()) {
  const clean = String(fileName || 'Untitled.md').trim();
  const base = clean.replace(/\.(md|markdown)$/i, '');
  const d = now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const stamp = [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-') + ` ${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `${base} (Kardex conflict ${stamp}).md`;
}

export function isUneditedSyntheticNote(note) {
  const id = String(note?.id || '');
  if (!id.startsWith('syn-pt-')) return false;
  return !note?.sourceFileName && !note?.localDirtySync;
}

/**
 * Pure two-way state reconciliation for a single chart/file pair.
 */
export function reconcileVaultEntry({ diskText = null, diskLastModified = 0, localNote = null } = {}) {
  const hasDisk = typeof diskText === 'string';
  const hasLocal = Boolean(localNote && typeof localNote.content === 'string');

  if (!hasDisk && !hasLocal) {
    return { action: 'noop', reason: 'both-missing' };
  }

  if (hasDisk && !hasLocal) {
    return {
      action: 'pull',
      winnerContent: diskText,
      reason: 'disk-only',
    };
  }

  if (!hasDisk && hasLocal) {
    if (localNote.sourceFileName && !localNote.localDirtySync) {
      return { action: 'unlink', reason: 'missing-from-vault' };
    }
    if (isUneditedSyntheticNote(localNote)) {
      return { action: 'noop', reason: 'skip-unedited-synthetic' };
    }
    return {
      action: 'push',
      winnerContent: localNote.content,
      reason: 'local-only',
    };
  }

  const diskHash = hashContent(diskText);
  const localHash = hashContent(localNote.content);
  if (diskHash === localHash) {
    return { action: 'noop', diskHash, localHash, reason: 'hashes-match' };
  }

  const baseHash = String(localNote.sourceContentHash || '');
  const diskChanged = !baseHash || diskHash !== baseHash;
  const localChanged = Boolean(localNote.localDirtySync) || (Boolean(baseHash) && localHash !== baseHash);

  if (diskChanged && !localChanged) {
    return {
      action: 'pull',
      winnerContent: diskText,
      diskHash,
      localHash,
      reason: 'disk-newer',
    };
  }

  if (!diskChanged && localChanged) {
    return {
      action: 'push',
      winnerContent: localNote.content,
      diskHash,
      localHash,
      reason: 'local-newer',
    };
  }

  // Both edited independently since last sync -> preserve both safely
  const localTs = Number(localNote.updated || 0);
  const diskTs = Number(diskLastModified || 0);
  if (diskTs > localTs) {
    return {
      action: 'conflict',
      winner: 'disk',
      winnerContent: diskText,
      conflictCopyContent: localNote.content,
      diskHash,
      localHash,
      reason: 'both-changed-disk-winner',
    };
  }
  return {
    action: 'conflict',
    winner: 'local',
    winnerContent: localNote.content,
    conflictCopyContent: diskText,
    diskHash,
    localHash,
    reason: 'both-changed-local-winner',
  };
}

export async function queryDirPermission(dirHandle, { request = false } = {}) {
  if (!dirHandle) return 'denied';
  try {
    const opts = { mode: 'readwrite' };
    if (typeof dirHandle.queryPermission === 'function') {
      const state = await dirHandle.queryPermission(opts);
      if (state === 'granted') return 'granted';
      if (state === 'denied' && !request) return 'denied';
    }
    if (request && typeof dirHandle.requestPermission === 'function') {
      const nextState = await dirHandle.requestPermission(opts);
      return nextState || 'denied';
    }
    if (typeof dirHandle.queryPermission === 'function') {
      return (await dirHandle.queryPermission(opts)) || 'prompt';
    }
    return 'granted';
  } catch {
    return 'denied';
  }
}

export async function readVaultFile(dirHandle, fileName) {
  if (!dirHandle || !fileName) return null;
  try {
    const fh = await dirHandle.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    const content = await file.text();
    return {
      name: fh.name || fileName,
      content,
      lastModified: Number(file.lastModified || 0),
      hash: hashContent(content),
    };
  } catch (err) {
    if (err?.name === 'NotFoundError') return null;
    throw err;
  }
}

export async function writeVaultFile(dirHandle, fileName, content) {
  if (!dirHandle || !fileName) throw new Error('Directory handle and filename required');
  const fh = await dirHandle.getFileHandle(fileName, { create: true });
  const writable = await fh.createWritable();
  const payload = String(content ?? '');
  await writable.write(payload);
  await writable.close();
  let lastModified = Date.now();
  let size = typeof Blob !== 'undefined' ? new Blob([payload]).size : payload.length;
  try {
    const f = await fh.getFile();
    if (f && Number.isFinite(f.lastModified)) lastModified = f.lastModified;
    if (f && typeof f.size === 'number') size = f.size;
  } catch {}
  return {
    name: fh.name || fileName,
    lastModified,
    size,
    hash: hashContent(payload),
  };
}

export async function deleteVaultFile(dirHandle, fileName) {
  if (!dirHandle || !fileName) return false;
  try {
    await dirHandle.removeEntry(fileName);
    return true;
  } catch (err) {
    if (err?.name === 'NotFoundError') return false;
    throw err;
  }
}

export async function scanVaultEntries(dirHandle, onProgress = null) {
  if (!dirHandle || typeof dirHandle.values !== 'function') {
    return { handles: [], skippedDirs: 0, skippedConflicts: 0, skippedOther: 0 };
  }
  const handles = [];
  let skippedDirs = 0;
  let skippedConflicts = 0;
  let skippedOther = 0;
  let seen = 0;
  let lastYield = Date.now();

  for await (const entry of dirHandle.values()) {
    if (!entry) continue;
    seen++;
    if (entry.kind === 'directory') {
      if (!String(entry.name || '').startsWith('.')) skippedDirs++;
    } else if (entry.kind === 'file') {
      if (isConflictCopyFileName(entry.name)) {
        skippedConflicts++;
      } else if (isSyncableVaultFileName(entry.name)) {
        handles.push(entry);
      } else if (!String(entry.name || '').startsWith('.')) {
        skippedOther++;
      }
    }
    if (typeof onProgress === 'function' && (seen === 1 || seen % 25 === 0)) {
      onProgress({
        phase: 'scanning',
        found: handles.length,
        skippedDirs,
        currentFile: entry.name || '',
      });
    }
    if (Date.now() - lastYield >= 24) {
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }

  if (typeof onProgress === 'function') {
    onProgress({
      phase: 'scanning',
      found: handles.length,
      skippedDirs,
      currentFile: '',
    });
  }
  return { handles, skippedDirs, skippedConflicts, skippedOther };
}

export async function listVaultMarkdownFiles(dirHandle) {
  const { handles } = await scanVaultEntries(dirHandle);
  const files = [];
  for (const entry of handles) {
    try {
      const file = await entry.getFile();
      const content = await file.text();
      files.push({
        name: entry.name,
        content,
        lastModified: Number(file.lastModified || 0),
        hash: hashContent(content),
      });
    } catch {}
  }
  return files;
}

export function formatVaultSyncSummary(res) {
  if (!res) return 'Never synced';
  const errCount = Array.isArray(res.errors) ? res.errors.length : 0;
  if (res.mode === 'active-only') {
    if ((res.checked || 0) === 0 && (res.pushed || 0) === 0 && errCount === 0) {
      return '0 active charts synced — tap Scan Folder for New Active';
    }
    const activeParts = [
      'Active only',
      `${res.checked || 0} checked`,
      `${res.pulled || 0} pulled`,
      `${res.pushed || 0} pushed`,
      `${res.unchanged || 0} unchanged`,
    ];
    if (res.conflicts > 0) activeParts.push(`${res.conflicts} conflict`);
    if (res.unlinked > 0) activeParts.push(`${res.unlinked} unlinked`);
    if (errCount > 0) activeParts.push(`${errCount} error`);
    return activeParts.join(' · ');
  }
  if (res.totalDiskFiles === 0 && (res.skippedDirs || 0) > 0 && (res.pushed || 0) === 0) {
    return `0 top-level .md files (${res.skippedDirs} subfolder${res.skippedDirs === 1 ? '' : 's'} skipped — pick the subfolder containing your .md files)`;
  }
  if (res.totalDiskFiles === 0 && (res.pulled || 0) === 0 && (res.pushed || 0) === 0 && errCount === 0) {
    return 'Folder is empty (0 .md files)';
  }
  const parts = [
    `${res.totalDiskFiles} file${res.totalDiskFiles === 1 ? '' : 's'}`,
    `${res.pulled} pulled`,
    `${res.pushed} pushed`,
    `${res.unchanged} unchanged`,
  ];
  if (res.skippedInactive > 0) parts.push(`${res.skippedInactive} inactive skipped`);
  if (res.conflicts > 0) parts.push(`${res.conflicts} conflict`);
  if (res.unlinked > 0) parts.push(`${res.unlinked} unlinked`);
  if (errCount > 0) parts.push(`${errCount} error`);
  return parts.join(' · ');
}

function buildLocalNoteFromVaultFile(file, existingNote = null, generateId = null) {
  const m = metaOf(file.content);
  const parsedAliases = String(m.aliases || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const titleFromFile = String(file.name || '').replace(/\.(md|markdown)$/i, '');
  const derived = parseRoomAndNameFromTitle(file.name);
  const nowId = existingNote?.id || (typeof generateId === 'function' ? generateId() : `v_${Math.random().toString(36).slice(2, 10)}`);

  return {
    ...(existingNote || {}),
    id: nowId,
    title: titleFromFile || existingNote?.title || 'Untitled note',
    content: file.content,
    name: m.name || m.patient || derived.name || existingNote?.name || '',
    aliases: parsedAliases.length ? parsedAliases : (existingNote?.aliases || []),
    room: m.room || m.bed || m.rm || derived.room || existingNote?.room || '',
    updated: Number(file.lastModified || Date.now()),
    sourceFileName: file.name,
    sourceLastModified: Number(file.lastModified || 0),
    sourceFileSize: typeof file.size === 'number' ? file.size : -1,
    sourceContentHash: file.hash || hashContent(file.content),
    localDirtySync: false,
  };
}

function createVaultPersistHelper(putNote, putNotesBatch) {
  const dbBatch = [];
  const flushDbBatch = async () => {
    if (!dbBatch.length || typeof putNotesBatch !== 'function') return;
    const batch = dbBatch.splice(0, dbBatch.length);
    await putNotesBatch(batch);
  };
  const persistNote = async (n) => {
    if (typeof putNotesBatch === 'function') {
      dbBatch.push(n);
      if (dbBatch.length >= 100) await flushDbBatch();
    } else {
      await putNote(n, { skipVaultMirror: true });
    }
  };
  return { persistNote, flushDbBatch };
}

function isStatUnchanged(localNote, diskLastMod, diskSize) {
  if (!localNote || localNote.localDirtySync || !localNote.sourceContentHash) return false;
  if (!(diskLastMod > 0 && diskLastMod === Number(localNote.sourceLastModified || 0))) return false;
  return (
    localNote.sourceFileSize === undefined ||
    localNote.sourceFileSize < 0 ||
    diskSize < 0 ||
    diskSize === localNote.sourceFileSize
  );
}

async function applyDiskReconcileDecision({
  dirHandle,
  file,
  localNote,
  existingNames,
  generateId,
  now,
  persistNote,
  counts,
  conflictFiles,
}) {
  const decision = reconcileVaultEntry({
    diskText: file.content,
    diskLastModified: file.lastModified,
    localNote,
  });

  if (decision.action === 'noop') {
    if (
      localNote &&
      (localNote.sourceContentHash !== file.hash ||
        localNote.localDirtySync ||
        Number(localNote.sourceLastModified || 0) !== file.lastModified)
    ) {
      await persistNote({
        ...localNote,
        sourceFileName: file.name,
        sourceLastModified: file.lastModified,
        sourceFileSize: file.size,
        sourceContentHash: file.hash,
        localDirtySync: false,
      });
    }
    counts.unchanged++;
  } else if (decision.action === 'pull') {
    const nextNote = buildLocalNoteFromVaultFile(file, localNote, generateId);
    await persistNote(nextNote);
    counts.pulled++;
  } else if (decision.action === 'push') {
    const written = await writeVaultFile(dirHandle, file.name, decision.winnerContent);
    await persistNote({
      ...localNote,
      sourceFileName: written.name,
      sourceLastModified: written.lastModified,
      sourceFileSize: written.size,
      sourceContentHash: written.hash,
      localDirtySync: false,
    });
    counts.pushed++;
  } else if (decision.action === 'conflict') {
    const conflictName = buildConflictFileName(file.name, now);
    await writeVaultFile(dirHandle, conflictName, decision.conflictCopyContent);
    if (existingNames) existingNames.add(conflictName);
    conflictFiles.push(conflictName);

    if (decision.winner === 'local') {
      const written = await writeVaultFile(dirHandle, file.name, decision.winnerContent);
      await persistNote({
        ...localNote,
        sourceFileName: written.name,
        sourceLastModified: written.lastModified,
        sourceFileSize: written.size,
        sourceContentHash: written.hash,
        localDirtySync: false,
      });
    } else {
      const nextNote = buildLocalNoteFromVaultFile(file, localNote, generateId);
      await persistNote(nextNote);
    }
    counts.conflicts++;
  }
}

export async function syncActiveVaultNotes({
  dirHandle,
  localNotes = [],
  putNote,
  putNotesBatch = null,
  generateId = null,
  now = new Date(),
  onProgress = null,
} = {}) {
  if (!dirHandle) throw new Error('No linked folder handle');
  if (typeof putNote !== 'function') throw new Error('putNote callback required');

  const startedAt = Date.now();
  const targetNotes = [];
  const knownNames = new Set();

  for (const n of localNotes) {
    if (!n) continue;
    if (n.sourceFileName) knownNames.add(n.sourceFileName);
    if (isUneditedSyntheticNote(n)) continue;
    if (parseChartHeader(n.content, n).isCensus || Boolean(n.localDirtySync)) {
      targetNotes.push(n);
    }
  }

  const { persistNote, flushDbBatch } = createVaultPersistHelper(putNote, putNotesBatch);
  const totalWork = targetNotes.length;
  let processed = 0;
  const counts = { pulled: 0, pushed: 0, conflicts: 0, unchanged: 0, unlinked: 0 };
  const conflictFiles = [];
  const errors = [];

  const emitProgress = (currentFile = '') => {
    if (typeof onProgress !== 'function') return;
    const percent = totalWork > 0 ? Math.min(100, Math.round((processed / totalWork) * 100)) : 100;
    onProgress({
      phase: 'syncing',
      processed,
      total: totalWork,
      percent,
      currentFile,
      pulled: counts.pulled,
      pushed: counts.pushed,
      conflicts: counts.conflicts,
      unchanged: counts.unchanged,
      errorsCount: errors.length,
    });
  };

  emitProgress(targetNotes[0]?.sourceFileName || targetNotes[0]?.name || '');

  const CONCURRENCY = 8;
  let lastYield = Date.now();

  for (let offset = 0; offset < targetNotes.length; offset += CONCURRENCY) {
    const chunk = targetNotes.slice(offset, offset + CONCURRENCY);
    const loadedChunk = await Promise.all(
      chunk.map(async (localNote) => {
        if (!localNote.sourceFileName) {
          return { localNote, unlinkedLocal: true };
        }
        try {
          const fh = await dirHandle.getFileHandle(localNote.sourceFileName, { create: false });
          const rawFile = await fh.getFile();
          const diskLastMod = Number(rawFile.lastModified || 0);
          const diskSize = typeof rawFile.size === 'number' ? rawFile.size : -1;
          if (isStatUnchanged(localNote, diskLastMod, diskSize)) {
            return { localNote, fastUnchanged: true };
          }
          const content = await rawFile.text();
          return {
            localNote,
            file: {
              name: fh.name || localNote.sourceFileName,
              content,
              lastModified: diskLastMod,
              size: diskSize,
              hash: hashContent(content),
            },
          };
        } catch (err) {
          if (err?.name === 'NotFoundError') {
            return { localNote, missingOnDisk: true };
          }
          return { localNote, error: err };
        }
      })
    );

    for (const item of loadedChunk) {
      const { localNote, fastUnchanged, missingOnDisk, unlinkedLocal, file, error } = item;
      const label = localNote.sourceFileName || localNote.name || localNote.title || localNote.id;

      try {
        if (error) throw error;

        if (fastUnchanged) {
          counts.unchanged++;
        } else if (missingOnDisk) {
          const decision = reconcileVaultEntry({ diskText: null, diskLastModified: 0, localNote });
          if (decision.action === 'unlink') {
            await persistNote({
              ...localNote,
              sourceFileName: '',
              sourceLastModified: 0,
              sourceFileSize: -1,
              sourceContentHash: '',
              localDirtySync: false,
            });
            counts.unlinked++;
          } else if (decision.action === 'push') {
            const targetName = localNote.sourceFileName;
            knownNames.add(targetName);
            const written = await writeVaultFile(dirHandle, targetName, decision.winnerContent);
            await persistNote({
              ...localNote,
              sourceFileName: written.name,
              sourceLastModified: written.lastModified,
              sourceFileSize: written.size,
              sourceContentHash: written.hash,
              localDirtySync: false,
            });
            counts.pushed++;
          }
        } else if (unlinkedLocal) {
          const targetName = await resolveUniqueVaultFileName(dirHandle, localNote.room, localNote.name, knownNames);
          knownNames.add(targetName);
          const written = await writeVaultFile(dirHandle, targetName, localNote.content);
          await persistNote({
            ...localNote,
            sourceFileName: written.name,
            sourceLastModified: written.lastModified,
            sourceFileSize: written.size,
            sourceContentHash: written.hash,
            localDirtySync: false,
          });
          counts.pushed++;
        } else {
          await applyDiskReconcileDecision({
            dirHandle,
            file,
            localNote,
            existingNames: knownNames,
            generateId,
            now,
            persistNote,
            counts,
            conflictFiles,
          });
        }
      } catch (err) {
        errors.push({ file: label, error: err?.message || String(err) });
      }

      processed++;
      emitProgress(label);
    }

    if (Date.now() - lastYield >= 24) {
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }

  await flushDbBatch();

  return {
    mode: 'active-only',
    checked: targetNotes.length,
    pulled: counts.pulled,
    pushed: counts.pushed,
    conflicts: counts.conflicts,
    unchanged: counts.unchanged,
    unlinked: counts.unlinked,
    skippedInactive: 0,
    conflictFiles,
    errors,
    totalDiskFiles: targetNotes.length,
    skippedDirs: 0,
    skippedConflicts: 0,
    durationMs: Date.now() - startedAt,
  };
}

export async function syncVaultDirectory({
  dirHandle,
  localNotes = [],
  putNote,
  putNotesBatch = null,
  generateId = null,
  now = new Date(),
  onProgress = null,
  activeOnly = false,
  inactiveCache = null,
} = {}) {
  if (!dirHandle) throw new Error('No linked folder handle');
  if (typeof putNote !== 'function') throw new Error('putNote callback required');

  const startedAt = Date.now();
  const { handles: diskHandles, skippedDirs, skippedConflicts } = await scanVaultEntries(dirHandle, onProgress);
  const existingNames = new Set(diskHandles.map((h) => h.name));
  const diskNameSetLower = new Set(diskHandles.map((h) => String(h.name || '').toLowerCase()));
  const localByFile = new Map();
  for (const n of localNotes) {
    if (n?.sourceFileName) {
      localByFile.set(String(n.sourceFileName).trim().toLowerCase(), n);
    }
  }

  const pendingLocalNotes = [];
  for (const localNote of localNotes) {
    if (!localNote) continue;
    const key = localNote.sourceFileName ? String(localNote.sourceFileName).trim().toLowerCase() : '';
    if (key && diskNameSetLower.has(key)) continue;
    if (activeOnly && !localNote.localDirtySync && !parseChartHeader(localNote.content, localNote).isCensus) {
      continue;
    }
    const preDecision = reconcileVaultEntry({ diskText: null, diskLastModified: 0, localNote });
    if (preDecision.action === 'push' || preDecision.action === 'unlink') {
      pendingLocalNotes.push({ localNote, decision: preDecision });
    }
  }

  const { persistNote, flushDbBatch } = createVaultPersistHelper(putNote, putNotesBatch);

  const totalWork = diskHandles.length + pendingLocalNotes.length;
  let processed = 0;
  let skippedInactive = 0;
  const counts = { pulled: 0, pushed: 0, conflicts: 0, unchanged: 0, unlinked: 0 };
  const conflictFiles = [];
  const errors = [];
  const handledLocalIds = new Set();
  const nextInactiveCache = {};

  const emitProgress = (currentFile = '') => {
    if (typeof onProgress !== 'function') return;
    const percent = totalWork > 0 ? Math.min(100, Math.round((processed / totalWork) * 100)) : 100;
    onProgress({
      phase: 'syncing',
      processed,
      total: totalWork,
      percent,
      currentFile,
      pulled: counts.pulled,
      pushed: counts.pushed,
      conflicts: counts.conflicts,
      unchanged: counts.unchanged,
      errorsCount: errors.length,
    });
  };

  emitProgress(diskHandles[0]?.name || pendingLocalNotes[0]?.localNote?.name || '');

  // 1. Reconcile all disk files against linked local notes (chunked parallel reads + stat fast-path)
  const CONCURRENCY = 16;
  let lastYield = Date.now();

  for (let offset = 0; offset < diskHandles.length; offset += CONCURRENCY) {
    const chunk = diskHandles.slice(offset, offset + CONCURRENCY);
    const loadedChunk = await Promise.all(
      chunk.map(async (entry) => {
        const nameLower = entry.name.toLowerCase();
        const localNote = localByFile.get(nameLower) || null;
        try {
          const rawFile = await entry.getFile();
          const diskLastMod = Number(rawFile.lastModified || 0);
          const diskSize = typeof rawFile.size === 'number' ? rawFile.size : -1;

          if (activeOnly && !localNote) {
            const cached = inactiveCache && inactiveCache[nameLower];
            if (
              cached &&
              diskLastMod > 0 &&
              cached.lastModified === diskLastMod &&
              (diskSize < 0 || cached.size === diskSize)
            ) {
              nextInactiveCache[nameLower] = { lastModified: diskLastMod, size: diskSize };
              return { entry, localNote: null, skippedInactive: true };
            }
            const usedSlice = typeof rawFile.slice === 'function' && diskSize > 2048;
            const headText = usedSlice
              ? await rawFile.slice(0, 2048).text()
              : await rawFile.text();
            if (!isFrontmatterCensusTrue(headText)) {
              nextInactiveCache[nameLower] = { lastModified: diskLastMod, size: diskSize };
              return { entry, localNote: null, skippedInactive: true };
            }
            const content = usedSlice ? await rawFile.text() : headText;
            return {
              entry,
              localNote: null,
              file: {
                name: entry.name,
                content,
                lastModified: diskLastMod,
                size: diskSize,
                hash: hashContent(content),
              },
            };
          }

          if (isStatUnchanged(localNote, diskLastMod, diskSize)) {
            return { entry, localNote, fastUnchanged: true };
          }

          const content = await rawFile.text();
          return {
            entry,
            localNote,
            file: {
              name: entry.name,
              content,
              lastModified: diskLastMod,
              size: diskSize,
              hash: hashContent(content),
            },
          };
        } catch (err) {
          return { entry, localNote, error: err };
        }
      })
    );

    for (const item of loadedChunk) {
      const { entry, localNote, fastUnchanged, skippedInactive: isInactive, file, error } = item;
      if (localNote) handledLocalIds.add(localNote.id);

      try {
        if (error) throw error;

        if (isInactive) {
          skippedInactive++;
        } else if (fastUnchanged) {
          counts.unchanged++;
        } else {
          await applyDiskReconcileDecision({
            dirHandle,
            file,
            localNote,
            existingNames,
            generateId,
            now,
            persistNote,
            counts,
            conflictFiles,
          });
        }
      } catch (err) {
        errors.push({ file: entry.name, error: err?.message || String(err) });
      }

      processed++;
      emitProgress(entry.name);
    }

    if (Date.now() - lastYield >= 24) {
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }

  // 2. Reconcile local-only or missing-on-disk notes
  for (const { localNote, decision } of pendingLocalNotes) {
    if (handledLocalIds.has(localNote.id)) {
      processed++;
      continue;
    }

    try {
      if (decision.action === 'unlink') {
        await persistNote({
          ...localNote,
          sourceFileName: '',
          sourceLastModified: 0,
          sourceFileSize: -1,
          sourceContentHash: '',
          localDirtySync: false,
        });
        counts.unlinked++;
      } else if (decision.action === 'push') {
        const targetName = localNote.sourceFileName || computeVaultFileName(localNote.room, localNote.name, existingNames);
        existingNames.add(targetName);
        const written = await writeVaultFile(dirHandle, targetName, decision.winnerContent);
        await persistNote({
          ...localNote,
          sourceFileName: written.name,
          sourceLastModified: written.lastModified,
          sourceFileSize: written.size,
          sourceContentHash: written.hash,
          localDirtySync: false,
        });
        counts.pushed++;
      }
    } catch (err) {
      errors.push({ file: localNote.sourceFileName || localNote.title || localNote.id, error: err?.message || String(err) });
    }

    processed++;
    emitProgress(localNote.sourceFileName || localNote.name || localNote.title || '');
    if (Date.now() - lastYield >= 24) {
      await new Promise((r) => setTimeout(r, 0));
      lastYield = Date.now();
    }
  }

  await flushDbBatch();

  return {
    pulled: counts.pulled,
    pushed: counts.pushed,
    conflicts: counts.conflicts,
    unchanged: counts.unchanged,
    unlinked: counts.unlinked,
    skippedInactive,
    inactiveCache: activeOnly ? nextInactiveCache : undefined,
    conflictFiles,
    errors,
    totalDiskFiles: diskHandles.length,
    skippedDirs,
    skippedConflicts,
    durationMs: Date.now() - startedAt,
  };
}
