const Path = require('path')
const SocketAuthority = require('../SocketAuthority')
const Logger = require('../Logger')
const fs = require('../libs/fsExtra')
const ffmpegHelpers = require('../utils/ffmpegHelpers')
const TaskManager = require('./TaskManager')
const Task = require('../objects/Task')
const fileUtils = require('../utils/fileUtils')
const Database = require('../Database')
const mediaVersions = require('../utils/mediaVersions')

/**
 * @typedef UpdateMetadataOptions
 * @property {boolean} [forceEmbedChapters=false] - Whether to force embed chapters.
 * @property {string} [label] - name of the new file version (fork; originals are never modified)
 */

class AudioMetadataMangaer {
  constructor() {
    this.itemsCacheDir = Path.join(global.MetadataPath, 'cache/items')

    this.MAX_CONCURRENT_TASKS = 1
    this.tasksRunning = []
    this.tasksQueued = []
  }

  /**
   * Get queued task data
   * @return {Array}
   */
  getQueuedTaskData() {
    return this.tasksQueued.map((t) => t.data)
  }

  getIsLibraryItemQueuedOrProcessing(libraryItemId) {
    return this.tasksQueued.some((t) => t.data.libraryItemId === libraryItemId) || this.tasksRunning.some((t) => t.data.libraryItemId === libraryItemId)
  }

  /**
   *
   * @param {import('../models/LibraryItem')} libraryItem
   * @returns
   */
  getMetadataObjectForApi(libraryItem) {
    return ffmpegHelpers.getFFMetadataObject(libraryItem, libraryItem.media.includedAudioFiles.length)
  }

  /**
   *
   * @param {string} userId
   * @param {import('../models/LibraryItem')[]} libraryItems
   * @param {UpdateMetadataOptions} options
   */
  handleBatchEmbed(userId, libraryItems, options = {}) {
    libraryItems.forEach((li) => {
      this.updateMetadataForItem(userId, li, options)
    })
  }

  /**
   *
   * @param {string} userId
   * @param {import('../models/LibraryItem')} libraryItem
   * @param {UpdateMetadataOptions} [options={}]
   */
  async updateMetadataForItem(userId, libraryItem, options = {}) {
    const forceEmbedChapters = !!options.forceEmbedChapters

    const audioFiles = libraryItem.media.includedAudioFiles

    const task = new Task()

    const itemCachePath = Path.join(this.itemsCacheDir, libraryItem.id)

    // Only writing chapters for single file audiobooks
    const chapters = audioFiles.length == 1 || forceEmbedChapters ? libraryItem.media.chapters.map((c) => ({ ...c })) : null

    let mimeType = audioFiles[0].mimeType
    if (audioFiles.some((a) => a.mimeType !== mimeType)) mimeType = null

    // Fork: tagged copies go into a new file version outside the library folder; originals are never touched
    const versionLabel = (typeof options.label === 'string' && options.label.trim()) || mediaVersions.defaultVersionLabel('tagged')
    const versionDir = await mediaVersions.getNewVersionDir(libraryItem, versionLabel)

    // Create task
    const libraryItemDir = libraryItem.isFile ? Path.dirname(libraryItem.path) : libraryItem.path
    const taskData = {
      libraryItemId: libraryItem.id,
      libraryItemDir,
      userId,
      audioFiles: audioFiles.map((af) => ({
        index: af.index,
        ino: af.ino,
        filename: af.metadata.filename,
        path: af.metadata.path,
        versionPath: Path.join(versionDir, af.metadata.filename),
        duration: af.duration
      })),
      coverPath: libraryItem.media.coverPath,
      metadataObject: ffmpegHelpers.getFFMetadataObject(libraryItem, audioFiles.length),
      itemCachePath,
      versionDir,
      versionLabel,
      chapters,
      mimeType,
      options: {
        forceEmbedChapters
      },
      duration: libraryItem.media.duration
    }

    const taskTitleString = {
      text: 'Embedding Metadata',
      key: 'MessageTaskEmbeddingMetadata'
    }
    const taskDescriptionString = {
      text: `Embedding metadata in audiobook "${libraryItem.media.title}".`,
      key: 'MessageTaskEmbeddingMetadataDescription',
      subs: [libraryItem.media.title]
    }
    task.setData('embed-metadata', taskTitleString, taskDescriptionString, false, taskData)

    if (this.tasksRunning.length >= this.MAX_CONCURRENT_TASKS) {
      Logger.info(`[AudioMetadataManager] Queueing embed metadata for audiobook "${libraryItem.media.title}"`)
      SocketAuthority.adminEmitter('metadata_embed_queue_update', {
        libraryItemId: libraryItem.id,
        queued: true
      })
      this.tasksQueued.push(task)
    } else {
      this.runMetadataEmbed(task)
    }
  }

  /**
   * Fail a task, removing its partially written version directory.
   *
   * @param {import('../objects/Task')} task
   * @param {{text: string, key: string, subs?: string[]}} failedString
   */
  async failTask(task, failedString) {
    task.setFailed(failedString)
    if (task.data.versionDir && !task.data.versionId) {
      await fs.remove(task.data.versionDir).catch((err) => {
        Logger.error(`[AudioMetadataManager] Failed to remove version directory "${task.data.versionDir}"`, err)
      })
    }
    this.handleTaskFinished(task)
  }

  /**
   *
   * @param {import('../objects/Task')} task
   */
  async runMetadataEmbed(task) {
    this.tasksRunning.push(task)
    TaskManager.addTask(task)

    Logger.info(`[AudioMetadataManager] Starting metadata embed task`, task.description)

    // Ensure the version directory can be created and written (the library folder may be read-only)
    const versionDirReady = await fs
      .mkdirp(task.data.versionDir)
      .then(() => fileUtils.isWritable(task.data.versionDir))
      .catch(() => false)
    if (!versionDirReady) {
      Logger.error(`[AudioMetadataManager] Version directory is not writable: ${task.data.versionDir}`)
      return this.failTask(task, {
        text: 'Target directory is not writable',
        key: 'MessageTaskTargetDirectoryNotWritable'
      })
    }

    // Ensure item cache dir exists (holds the ffmetadata file)
    const ffmetadataPath = Path.join(task.data.itemCachePath, 'ffmetadata.txt')
    let cacheDirCreated = false
    if (!(await fs.pathExists(task.data.itemCachePath))) {
      try {
        await fs.mkdirp(task.data.itemCachePath)
        cacheDirCreated = true
      } catch (err) {
        Logger.error(`[AudioMetadataManager] Failed to create cache directory ${task.data.itemCachePath}`, err)
        return this.failTask(task, {
          text: 'Failed to create cache directory',
          key: 'MessageTaskFailedToCreateCacheDirectory'
        })
      }
    }
    const cleanupCache = async () => {
      if (cacheDirCreated) await fs.remove(task.data.itemCachePath).catch(() => {})
      else await fs.remove(ffmetadataPath).catch(() => {})
    }

    // Create ffmetadata file
    const success = await ffmpegHelpers.writeFFMetadataFile(task.data.metadataObject, task.data.chapters, ffmetadataPath)
    if (!success) {
      Logger.error(`[AudioMetadataManager] Failed to write ffmetadata file for audiobook "${task.data.libraryItemId}"`)
      await cleanupCache()
      return this.failTask(task, {
        text: 'Failed to write metadata file',
        key: 'MessageTaskFailedToWriteMetadataFile'
      })
    }

    // Copy each audio file into the version directory and tag the copy
    let cummulativeProgress = 0
    for (const af of task.data.audioFiles) {
      const audioFileRelativeDuration = af.duration / task.data.duration
      SocketAuthority.adminEmitter('track_started', {
        libraryItemId: task.data.libraryItemId,
        ino: af.ino
      })

      try {
        await fs.copy(af.path, af.versionPath)
        await ffmpegHelpers.addCoverAndMetadataToFile(af.versionPath, task.data.coverPath, ffmetadataPath, af.index, task.data.mimeType, (progress) => {
          SocketAuthority.adminEmitter('task_progress', { libraryItemId: task.data.libraryItemId, progress: cummulativeProgress + progress * audioFileRelativeDuration })
          SocketAuthority.adminEmitter('track_progress', { libraryItemId: task.data.libraryItemId, ino: af.ino, progress })
        })
        Logger.info(`[AudioMetadataManager] Successfully tagged audio file copy "${af.versionPath}"`)
      } catch (err) {
        Logger.error(`[AudioMetadataManager] Failed to tag audio file copy "${af.versionPath}"`, err)
        await cleanupCache()
        return this.failTask(task, {
          text: `Failed to embed metadata in file "${Path.basename(af.path)}"`,
          key: 'MessageTaskFailedToEmbedMetadataInFile',
          subs: [Path.basename(af.path)]
        })
      }

      SocketAuthority.adminEmitter('track_finished', {
        libraryItemId: task.data.libraryItemId,
        ino: af.ino
      })

      cummulativeProgress += audioFileRelativeDuration * 100
    }

    await cleanupCache()

    // Register the tagged copies as a new file version
    try {
      const libraryItem = await Database.libraryItemModel.getExpandedById(task.data.libraryItemId)
      if (!libraryItem) throw new Error('Library item no longer exists')
      const version = await mediaVersions.createAudioVersion({
        libraryItem,
        dirPath: task.data.versionDir,
        filePaths: task.data.audioFiles.map((af) => af.versionPath),
        label: task.data.versionLabel,
        tool: 'embed-metadata',
        options: { ...task.data.options }
      })
      task.data.versionId = version.id
      SocketAuthority.emitter('item_versions_updated', { libraryItemId: libraryItem.id })
      Logger.info(`[AudioMetadataManager] Created version "${version.label}" (${version.id}) at "${task.data.versionDir}"`)
    } catch (err) {
      Logger.error(`[AudioMetadataManager] Failed to register version for "${task.data.libraryItemId}"`, err)
      return this.failTask(task, {
        text: 'Failed to write metadata file',
        key: 'MessageTaskFailedToWriteMetadataFile'
      })
    }

    task.setFinished()
    this.handleTaskFinished(task)
  }

  handleTaskFinished(task) {
    TaskManager.taskFinished(task)
    this.tasksRunning = this.tasksRunning.filter((t) => t.id !== task.id)

    if (this.tasksRunning.length < this.MAX_CONCURRENT_TASKS && this.tasksQueued.length) {
      Logger.info(`[AudioMetadataManager] Task finished and dequeueing next task. ${this.tasksQueued.length} tasks queued.`)
      const nextTask = this.tasksQueued.shift()
      SocketAuthority.emitter('metadata_embed_queue_update', {
        libraryItemId: nextTask.data.libraryItemId,
        queued: false
      })
      this.runMetadataEmbed(nextTask)
    } else if (this.tasksRunning.length > 0) {
      Logger.debug(`[AudioMetadataManager] Task finished but not dequeueing. Currently running ${this.tasksRunning.length} tasks. ${this.tasksQueued.length} tasks queued.`)
    } else {
      Logger.debug(`[AudioMetadataManager] Task finished and no tasks remain in queue`)
    }
  }
}
module.exports = AudioMetadataMangaer
