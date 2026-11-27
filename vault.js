// Linked Obsidian Folder Sync via File System Access API (zero external dependencies)
import { metaOf } from './census.js';

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
  try {
    const f = await fh.getFile();
    if (f && Number.isFinite(f.lastModified)) lastModified = f.lastModified;
  } catch {}
  return {
    name: fh.name || fileName,
    lastModified,
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

export async function listVaultMarkdownFiles(dirHandle) {
  if (!dirHandle || typeof dirHandle.values !== 'function') return [];
  const files = [];
  for await (const entry of dirHandle.values()) {
    if (!entry || entry.kind !== 'file') continue;
    if (!isSyncableVaultFileName(entry.name)) continue;
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

function buildLocalNoteFromVaultFile(file, existingNote = null, generateId = null) {
  const m = metaOf(file.content);
  const parsedAliases = String(m.aliases || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const titleFromFile = String(file.name || '').replace(/\.(md|markdown)$/i, '');
  const nowId = existingNote?.id || (typeof generateId === 'function' ? generateId() : `v_${Math.random().toString(36).slice(2, 10)}`);

  return {
    ...(existingNote || {}),
    id: nowId,
    title: titleFromFile || existingNote?.title || 'Untitled note',
    content: file.content,
    name: m.name || m.patient || existingNote?.name || '',
    aliases: parsedAliases.length ? parsedAliases : (existingNote?.aliases || []),
    room: m.room || m.bed || existingNote?.room || '',
    updated: Number(file.lastModified || Date.now()),
    sourceFileName: file.name,
    sourceLastModified: Number(file.lastModified || 0),
    sourceContentHash: file.hash || hashContent(file.content),
    localDirtySync: false,
  };
}

export async function syncVaultDirectory({
  dirHandle,
  localNotes = [],
  putNote,
  generateId = null,
  now = new Date(),
} = {}) {
  if (!dirHandle) throw new Error('No linked folder handle');
  if (typeof putNote !== 'function') throw new Error('putNote callback required');

  const diskFiles = await listVaultMarkdownFiles(dirHandle);
  const existingNames = new Set(diskFiles.map((f) => f.name));
  const diskByName = new Map(diskFiles.map((f) => [f.name.toLowerCase(), f]));
  const localByFile = new Map();
  for (const n of localNotes) {
    if (n?.sourceFileName) {
      localByFile.set(String(n.sourceFileName).trim().toLowerCase(), n);
    }
  }

  let pulled = 0;
  let pushed = 0;
  let conflicts = 0;
  let unchanged = 0;
  let unlinked = 0;
  const conflictFiles = [];
  const errors = [];
  const handledLocalIds = new Set();

  // 1. Reconcile all disk files against linked local notes
  for (const file of diskFiles) {
    const localNote = localByFile.get(file.name.toLowerCase()) || null;
    if (localNote) handledLocalIds.add(localNote.id);

    const decision = reconcileVaultEntry({
      diskText: file.content,
      diskLastModified: file.lastModified,
      localNote,
    });

    try {
      if (decision.action === 'noop') {
        if (localNote && (localNote.sourceContentHash !== file.hash || localNote.localDirtySync)) {
          await putNote({
            ...localNote,
            sourceFileName: file.name,
            sourceLastModified: file.lastModified,
            sourceContentHash: file.hash,
            localDirtySync: false,
          }, { skipVaultMirror: true });
        }
        unchanged++;
      } else if (decision.action === 'pull') {
        const nextNote = buildLocalNoteFromVaultFile(file, localNote, generateId);
        await putNote(nextNote, { skipVaultMirror: true });
        pulled++;
      } else if (decision.action === 'push') {
        const written = await writeVaultFile(dirHandle, file.name, decision.winnerContent);
        await putNote({
          ...localNote,
          sourceFileName: written.name,
          sourceLastModified: written.lastModified,
          sourceContentHash: written.hash,
          localDirtySync: false,
        }, { skipVaultMirror: true });
        pushed++;
      } else if (decision.action === 'conflict') {
        const conflictName = buildConflictFileName(file.name, now);
        await writeVaultFile(dirHandle, conflictName, decision.conflictCopyContent);
        existingNames.add(conflictName);
        conflictFiles.push(conflictName);

        if (decision.winner === 'local') {
          const written = await writeVaultFile(dirHandle, file.name, decision.winnerContent);
          await putNote({
            ...localNote,
            sourceFileName: written.name,
            sourceLastModified: written.lastModified,
            sourceContentHash: written.hash,
            localDirtySync: false,
          }, { skipVaultMirror: true });
        } else {
          const nextNote = buildLocalNoteFromVaultFile(file, localNote, generateId);
          await putNote(nextNote, { skipVaultMirror: true });
        }
        conflicts++;
      }
    } catch (err) {
      errors.push({ file: file.name, error: err?.message || String(err) });
    }
  }

  // 2. Reconcile local-only or missing-on-disk notes
  for (const localNote of localNotes) {
    if (!localNote || handledLocalIds.has(localNote.id)) continue;
    const key = localNote.sourceFileName ? String(localNote.sourceFileName).trim().toLowerCase() : '';
    if (key && diskByName.has(key)) continue;

    const decision = reconcileVaultEntry({
      diskText: null,
      diskLastModified: 0,
      localNote,
    });

    try {
      if (decision.action === 'unlink') {
        await putNote({
          ...localNote,
          sourceFileName: '',
          sourceLastModified: 0,
          sourceContentHash: '',
          localDirtySync: false,
        }, { skipVaultMirror: true });
        unlinked++;
      } else if (decision.action === 'push') {
        const targetName = localNote.sourceFileName || computeVaultFileName(localNote.room, localNote.name, existingNames);
        existingNames.add(targetName);
        const written = await writeVaultFile(dirHandle, targetName, decision.winnerContent);
        await putNote({
          ...localNote,
          sourceFileName: written.name,
          sourceLastModified: written.lastModified,
          sourceContentHash: written.hash,
          localDirtySync: false,
        }, { skipVaultMirror: true });
        pushed++;
      }
    } catch (err) {
      errors.push({ file: localNote.sourceFileName || localNote.title || localNote.id, error: err?.message || String(err) });
    }
  }

  return {
    pulled,
    pushed,
    conflicts,
    unchanged,
    unlinked,
    conflictFiles,
    errors,
    totalDiskFiles: diskFiles.length,
  };
}
