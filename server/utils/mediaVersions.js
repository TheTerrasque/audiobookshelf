/**
 * File versions: alternative copies of a library item's files stored under global.VersionsPath.
 *
 * Each user picks which version they get. The choice lives in user.extraData.mediaVersions:
 *   { [libraryItemId]: { audio?: versionId, ebook?: { [sourceIno]: versionId } } }
 * A missing entry, or one pointing at a deleted version, means the original files.
 *
 * Every place that hands audio files to a user (playback sessions, item JSON, file serving by ino)
 * resolves them through this module.
 */
const Path = require('path')
const fs = require('../libs/fsExtra')
const Logger = require('../Logger')
const Database = require('../Database')
const { sanitizeFilename, filePathToPOSIX } = require('./fileUtils')

const VERSION_INO_PREFIX = 'ver_'

/**
 * Synthetic ino for a version file. Never collides with real inodes (which are numeric strings).
 *
 * @param {string} versionId
 * @param {number} index
 */
function makeVersionFileIno(versionId, index) {
  return `${VERSION_INO_PREFIX}${versionId.replace(/-/g, '').slice(0, 12)}_${index}`
}

function isVersionFileIno(ino) {
  return typeof ino === 'string' && ino.startsWith(VERSION_INO_PREFIX)
}

/**
 * @param {import('../models/User')} user
 * @returns {Object<string, {audio?: string, ebook?: Object<string, string>}>}
 */
function getSelections(user) {
  return user?.extraData?.mediaVersions || {}
}

/**
 * @param {import('../models/User')} user
 * @param {string} libraryItemId
 * @returns {string|null}
 */
function getSelectedAudioVersionId(user, libraryItemId) {
  return getSelections(user)[libraryItemId]?.audio || null
}

/**
 * Version timeline length / original timeline length. 1 unless the version changed the speed.
 * A speed of 1.25 gives 0.8: 100 s into the original is 80 s into the version.
 *
 * @param {import('../models/MediaVersion')|{options?: Object}} version
 * @returns {number}
 */
function getVersionTimeScale(version) {
  const speed = Number(version?.options?.speed)
  if (!Number.isFinite(speed) || speed <= 0 || speed === 1) return 1
  return 1 / speed
}

/**
 * Time scale of the audio version a user has selected (cached on the selection so it can be used
 * synchronously when serializing progress and bookmarks).
 *
 * Progress and bookmarks are stored on the original timeline. The API speaks the user's timeline:
 * positions going out are multiplied by this, positions coming in are divided by it.
 *
 * @param {import('../models/User')} user
 * @param {string} libraryItemId
 * @returns {number}
 */
function getUserTimeScale(user, libraryItemId) {
  const scale = Number(getSelections(user)[libraryItemId]?.audioTimeScale)
  return Number.isFinite(scale) && scale > 0 ? scale : 1
}

/** Original timeline -> user's timeline */
function toUserTime(user, libraryItemId, time) {
  const scale = getUserTimeScale(user, libraryItemId)
  if (scale === 1 || typeof time !== 'number' || !Number.isFinite(time)) return time
  return time * scale
}

/** User's timeline -> original timeline */
function fromUserTime(user, libraryItemId, time, scale = null) {
  scale = scale ?? getUserTimeScale(user, libraryItemId)
  if (scale === 1 || typeof time !== 'number' || !Number.isFinite(time)) return time
  return time / scale
}

/**
 * Media progress JSON (old format) as seen by this user. Book progress only; podcast episodes never have versions.
 *
 * @param {import('../models/User')} user
 * @param {Object} progressJson
 */
function progressJsonForUser(user, progressJson) {
  if (!progressJson || progressJson.episodeId || !progressJson.libraryItemId) return progressJson
  const scale = getUserTimeScale(user, progressJson.libraryItemId)
  if (scale === 1) return progressJson
  return {
    ...progressJson,
    currentTime: typeof progressJson.currentTime === 'number' ? progressJson.currentTime * scale : progressJson.currentTime,
    duration: typeof progressJson.duration === 'number' ? progressJson.duration * scale : progressJson.duration
  }
}

/**
 * @param {import('../models/User')} user
 * @param {{libraryItemId: string, time: number}} bookmark
 */
function bookmarkForUser(user, bookmark) {
  if (!bookmark) return bookmark
  return { ...bookmark, time: toUserTime(user, bookmark.libraryItemId, bookmark.time) }
}

/**
 * Work out which timeline an incoming position is on when the client tells us the duration it played
 * (local/offline sessions, progress updates). A downloaded copy may be a different version than the
 * user's current selection, so match the duration against the item's versions first.
 *
 * @param {import('../models/User')} user
 * @param {import('../models/LibraryItem')} libraryItem
 * @param {number} [duration] - duration reported by the client
 * @returns {Promise<number>}
 */
async function resolveIncomingTimeScale(user, libraryItem, duration) {
  const selected = getUserTimeScale(user, libraryItem?.id)
  if (!libraryItem?.isBook || !(duration > 0)) return selected
  const originalDuration = libraryItem.media.duration || 0
  const close = (a, b) => Math.abs(a - b) <= Math.max(2, b * 0.002)
  // Same length as the selection's timeline: trust the selection
  if (originalDuration > 0 && close(duration, originalDuration * selected)) return selected
  if (originalDuration > 0 && close(duration, originalDuration)) return 1
  const versions = await getVersionsForItem(libraryItem.id)
  const match = versions.find((v) => v.kind === 'audio' && v.duration && close(duration, v.duration))
  return match ? getVersionTimeScale(match) : selected
}

/**
 * Map a progress update sent by a client (PATCH /api/me/progress) to the original timeline.
 *
 * @param {import('../models/User')} user
 * @param {Object} payload
 * @returns {Promise<Object>}
 */
async function progressPayloadFromUser(user, payload) {
  if (!payload?.libraryItemId || payload.episodeId) return payload
  if (typeof payload.currentTime !== 'number' && typeof payload.duration !== 'number') return payload
  let scale = getUserTimeScale(user, payload.libraryItemId)
  if (payload.duration > 0) {
    const versions = await getVersionsForItem(payload.libraryItemId)
    if (versions.some((v) => getVersionTimeScale(v) !== 1)) {
      const libraryItem = await Database.libraryItemModel.getExpandedById(payload.libraryItemId)
      if (libraryItem) scale = await resolveIncomingTimeScale(user, libraryItem, payload.duration)
    }
  }
  if (scale === 1) return payload
  const mapped = { ...payload }
  if (typeof mapped.currentTime === 'number') mapped.currentTime = mapped.currentTime / scale
  if (typeof mapped.duration === 'number') mapped.duration = mapped.duration / scale
  return mapped
}

/**
 * Set (or clear with versionId=null) a user's version choice for an item. Saves the user.
 *
 * @param {import('../models/User')} user
 * @param {string} libraryItemId
 * @param {'audio'} kind
 * @param {string|null} versionId
 * @param {number} [timeScale=1] - see getVersionTimeScale
 */
async function setSelection(user, libraryItemId, kind, versionId, timeScale = 1) {
  if (kind !== 'audio') throw new Error(`Unsupported version kind "${kind}"`)
  if (!user.extraData) user.extraData = {}
  const selections = { ...(user.extraData.mediaVersions || {}) }
  const itemSelection = { ...(selections[libraryItemId] || {}) }
  if (versionId) itemSelection.audio = versionId
  else delete itemSelection.audio
  if (versionId && timeScale && timeScale !== 1) itemSelection.audioTimeScale = timeScale
  else delete itemSelection.audioTimeScale

  if (Object.keys(itemSelection).length) selections[libraryItemId] = itemSelection
  else delete selections[libraryItemId]

  user.extraData.mediaVersions = selections
  user.changed('extraData', true)
  await user.save()
}

/**
 * Remove selections pointing at a deleted version (for every user that has one).
 *
 * @param {string} libraryItemId
 * @param {string} versionId
 * @returns {Promise<import('../models/User')[]>} users that changed
 */
async function clearSelectionsForVersion(libraryItemId, versionId) {
  const users = await Database.userModel.findAll()
  const changed = []
  for (const user of users) {
    if (getSelectedAudioVersionId(user, libraryItemId) === versionId) {
      await setSelection(user, libraryItemId, 'audio', null)
      changed.push(user)
    }
  }
  return changed
}

/**
 * @param {string} libraryItemId
 * @returns {Promise<import('../models/MediaVersion')[]>}
 */
function getVersionsForItem(libraryItemId) {
  return Database.mediaVersionModel.getForLibraryItem(libraryItemId)
}

/**
 * The audio version a user has selected for this item, or null for the originals.
 *
 * @param {import('../models/User')} user
 * @param {import('../models/LibraryItem')} libraryItem
 * @returns {Promise<import('../models/MediaVersion')|null>}
 */
async function getSelectedAudioVersion(user, libraryItem) {
  if (!user || !libraryItem?.isBook) return null
  const versionId = getSelectedAudioVersionId(user, libraryItem.id)
  if (!versionId) return null
  const version = await Database.mediaVersionModel.findByPk(versionId)
  if (!version || version.libraryItemId !== libraryItem.id || version.kind !== 'audio' || !version.files?.length) {
    return null
  }
  return version
}

/**
 * What a user gets for audio: either the item's own files or their selected version's.
 *
 * @param {import('../models/User')} user
 * @param {import('../models/LibraryItem')} libraryItem
 * @returns {Promise<{version: import('../models/MediaVersion'), audioFiles: Object[], tracks: Object[], duration: number, chapters: Object[]}|null>} null = originals
 */
async function getAudioView(user, libraryItem) {
  const version = await getSelectedAudioVersion(user, libraryItem)
  if (!version) return null
  const audioFiles = structuredClone(version.files)
  return {
    version,
    timeScale: getVersionTimeScale(version),
    audioFiles,
    tracks: libraryItem.media.getTracklist(libraryItem.id, null, audioFiles),
    duration: version.duration || audioFiles.reduce((sum, af) => sum + (af.duration || 0), 0),
    chapters: structuredClone(version.chapters?.length ? version.chapters : libraryItem.media.chapters || [])
  }
}

/**
 * Find a version file of this item by its synthetic ino.
 *
 * @param {string} libraryItemId
 * @param {string} ino
 * @returns {Promise<{version: import('../models/MediaVersion'), file: Object}|null>}
 */
async function findVersionFileByIno(libraryItemId, ino) {
  if (!isVersionFileIno(ino)) return null
  const versions = await getVersionsForItem(libraryItemId)
  for (const version of versions) {
    const file = version.files?.find((f) => f.ino === ino)
    if (file) return { version, file }
  }
  return null
}

/**
 * Apply a user's version to an expanded item JSON (as sent to clients), and attach the version list.
 * Clients then stream and download the chosen version without knowing about versions.
 *
 * @param {Object} itemJson - result of libraryItem.toOldJSONExpanded()
 * @param {import('../models/User')} user
 * @param {import('../models/LibraryItem')} libraryItem
 * @param {{originalFiles?: boolean}} [options] - originalFiles: list versions but keep the library files
 */
async function applyToExpandedItemJson(itemJson, user, libraryItem, options = {}) {
  if (!libraryItem?.isBook || !itemJson?.media) return itemJson
  const versions = await getVersionsForItem(libraryItem.id)
  itemJson.media.versions = versions.map((v) => v.toJSONForClient())

  const selectedId = getSelectedAudioVersionId(user, libraryItem.id)
  const selected = versions.find((v) => v.id === selectedId && v.kind === 'audio' && v.files?.length)
  itemJson.media.selectedVersions = { audio: selected?.id || null, audioTimeScale: selected ? getVersionTimeScale(selected) : 1 }
  if (!selected || options.originalFiles) return itemJson

  const audioFiles = structuredClone(selected.files)
  itemJson.media.audioFiles = audioFiles
  itemJson.media.tracks = libraryItem.media.getTracklist(libraryItem.id, null, audioFiles)
  itemJson.media.duration = selected.duration || itemJson.media.duration
  if (selected.chapters?.length) itemJson.media.chapters = structuredClone(selected.chapters)
  itemJson.media.size = selected.size || itemJson.media.size
  return itemJson
}

/**
 * Directory for a new version of a library item, mirroring the library layout:
 *   <VersionsPath>/<library name>/<item path relative to its library folder>/<label>/
 * Picks a free name if the label is already taken. Does not create the directory.
 *
 * @param {import('../models/LibraryItem')} libraryItem
 * @param {string} label
 * @returns {Promise<string>}
 */
async function getNewVersionDir(libraryItem, label) {
  const library = await Database.libraryModel.findByPk(libraryItem.libraryId)
  const folder = await Database.libraryFolderModel.findByPk(libraryItem.libraryFolderId)

  let relativeItemPath
  if (folder && libraryItem.path.startsWith(folder.path)) {
    relativeItemPath = Path.posix.relative(filePathToPOSIX(folder.path), filePathToPOSIX(libraryItem.path))
  } else {
    relativeItemPath = libraryItem.relPath || libraryItem.id
  }
  // A single-file item (e.g. Book.m4b at the folder root) gets a directory named after the file
  if (libraryItem.isFile) relativeItemPath = relativeItemPath.slice(0, -Path.extname(relativeItemPath).length) || relativeItemPath

  const segments = relativeItemPath
    .split('/')
    .filter((s) => s && s !== '.' && s !== '..')
    .map((s) => sanitizeFilename(s) || '_')
  const libraryName = sanitizeFilename(library?.name || '') || libraryItem.libraryId
  const baseDir = Path.join(global.VersionsPath, libraryName, ...segments)

  const cleanLabel = sanitizeFilename(label || '') || 'version'
  let dirPath = Path.join(baseDir, cleanLabel)
  let n = 2
  while (await fs.pathExists(dirPath)) {
    dirPath = Path.join(baseDir, `${cleanLabel} (${n++})`)
  }
  return filePathToPOSIX(dirPath)
}

/**
 * Register finished audio files in a version directory as a new audio version: probes each file,
 * gives it a synthetic ino, saves the MediaVersion row and writes version.json.
 *
 * @param {Object} params
 * @param {import('../models/LibraryItem')} params.libraryItem
 * @param {string} params.dirPath - version directory (inside global.VersionsPath)
 * @param {string[]} params.filePaths - audio files in play order
 * @param {string} params.label
 * @param {string} params.tool - e.g. 'encode-m4b', 'embed-metadata'
 * @param {Object} [params.options]
 * @param {Object[]} [params.chapters] - defaults to the item's chapters
 * @returns {Promise<import('../models/MediaVersion')>}
 */
async function createAudioVersion({ libraryItem, dirPath, filePaths, label, tool, options = {}, chapters = null }) {
  // Lazy requires: the scanner pulls in a lot and is not needed by the read paths
  const AudioFileScanner = require('../scanner/AudioFileScanner')
  const LibraryFile = require('../objects/files/LibraryFile')
  const { v4: uuidv4 } = require('uuid')

  const versionId = uuidv4()
  const files = []
  let size = 0
  for (const [i, filePath] of filePaths.entries()) {
    const libraryFile = new LibraryFile()
    await libraryFile.setDataFromPath(filePath, Path.basename(filePath))
    const audioFile = await AudioFileScanner.scan('version', libraryFile, {})
    if (!audioFile) throw new Error(`Failed to probe version file "${filePath}"`)
    const json = audioFile.toJSON()
    json.ino = makeVersionFileIno(versionId, i + 1)
    json.index = i + 1
    json.exclude = false
    files.push(json)
    size += json.metadata?.size || 0
  }

  const version = await Database.mediaVersionModel.create({
    id: versionId,
    libraryItemId: libraryItem.id,
    kind: 'audio',
    sourceIno: null,
    label,
    tool,
    options,
    dirPath: filePathToPOSIX(dirPath),
    files,
    duration: files.reduce((sum, f) => sum + (f.duration || 0), 0),
    chapters: structuredClone(chapters || libraryItem.media?.chapters || []),
    size
  })
  await writeVersionManifest(version, libraryItem).catch((error) => {
    Logger.warn(`[mediaVersions] Failed to write version.json in "${dirPath}"`, error)
  })
  return version
}

/**
 * A readable default label, e.g. "m4b 64k 2026-11-23 14.05".
 *
 * @param {string} prefix
 */
function defaultVersionLabel(prefix) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${prefix} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`
}

/**
 * Write the version.json sidecar so a version folder makes sense without the database.
 *
 * @param {import('../models/MediaVersion')} version
 * @param {import('../models/LibraryItem')} libraryItem
 */
async function writeVersionManifest(version, libraryItem) {
  const manifest = {
    versionId: version.id,
    libraryItemId: version.libraryItemId,
    libraryItemPath: libraryItem.path,
    title: libraryItem.media?.title || null,
    kind: version.kind,
    label: version.label,
    tool: version.tool,
    options: version.options,
    duration: version.duration,
    chapters: version.chapters,
    files: (version.files || []).map((f) => ({ filename: f.metadata?.filename, duration: f.duration, size: f.metadata?.size })),
    createdAt: new Date(version.createdAt || Date.now()).toISOString()
  }
  await fs.writeFile(Path.join(version.dirPath, 'version.json'), JSON.stringify(manifest, null, 2))
}

/**
 * Delete a version: database row, files on disk, and users' selections of it.
 * Only ever removes directories inside global.VersionsPath.
 *
 * @param {import('../models/MediaVersion')} version
 * @returns {Promise<import('../models/User')[]>} users whose selection was cleared
 */
async function deleteVersion(version) {
  await removeVersionDir(version.dirPath)
  const changedUsers = await clearSelectionsForVersion(version.libraryItemId, version.id)
  await version.destroy()
  return changedUsers
}

async function removeVersionDir(dirPath) {
  if (!dirPath) return
  const root = Path.resolve(global.VersionsPath)
  const target = Path.resolve(dirPath)
  if (target === root || !target.startsWith(root + Path.sep)) {
    Logger.error(`[mediaVersions] Refusing to remove "${dirPath}": not inside versions path "${global.VersionsPath}"`)
    return
  }
  await fs.remove(target).catch((error) => {
    Logger.error(`[mediaVersions] Failed to remove version directory "${target}"`, error)
  })
}

module.exports = {
  VERSION_INO_PREFIX,
  makeVersionFileIno,
  isVersionFileIno,
  getSelections,
  getSelectedAudioVersionId,
  setSelection,
  clearSelectionsForVersion,
  getVersionsForItem,
  getSelectedAudioVersion,
  getVersionTimeScale,
  getUserTimeScale,
  toUserTime,
  fromUserTime,
  progressJsonForUser,
  bookmarkForUser,
  resolveIncomingTimeScale,
  progressPayloadFromUser,
  getAudioView,
  findVersionFileByIno,
  applyToExpandedItemJson,
  getNewVersionDir,
  createAudioVersion,
  defaultVersionLabel,
  writeVersionManifest,
  deleteVersion
}
