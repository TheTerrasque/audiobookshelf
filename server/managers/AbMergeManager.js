const Path = require('path')
const fs = require('../libs/fsExtra')
const Logger = require('../Logger')
const TaskManager = require('./TaskManager')
const Task = require('../objects/Task')
const ffmpegHelpers = require('../utils/ffmpegHelpers')
const Ffmpeg = require('../libs/fluentFfmpeg')
const SocketAuthority = require('../SocketAuthority')
const { isWritable } = require('../utils/fileUtils')
const mediaVersions = require('../utils/mediaVersions')
const TrackProgressMonitor = require('../objects/TrackProgressMonitor')

/**
 * @typedef AbMergeEncodeOptions
 * @property {string} codec
 * @property {string} channels
 * @property {string} bitrate
 * @property {string} [label] - name of the new file version (fork)
 */

class AbMergeManager {
  constructor() {
    this.itemsCacheDir = Path.join(global.MetadataPath, 'cache/items')

    /** @type {Task[]} */
    this.pendingTasks = []
  }

  /**
   *
   * @param {string} libraryItemId
   * @returns {Task|null}
   */
  getPendingTaskByLibraryItemId(libraryItemId) {
    return this.pendingTasks.find((t) => t.task.data.libraryItemId === libraryItemId)
  }

  /**
   * Cancel and fail running task
   *
   * @param {Task} task
   * @returns {Promise<void>}
   */
  cancelEncode(task) {
    const taskFailedString = {
      text: 'Task canceled by user',
      key: 'MessageTaskCanceledByUser'
    }
    task.setFailed(taskFailedString)
    return this.removeTask(task, true)
  }

  /**
   *
   * @param {string} userId
   * @param {import('../models/LibraryItem')} libraryItem
   * @param {AbMergeEncodeOptions} [options={}]
   */
  async startAudiobookMerge(userId, libraryItem, options = {}) {
    const task = new Task()

    // Fork: the m4b becomes a new file version outside the library folder; originals are never touched
    const { label: requestedLabel, ...encodeOptions } = options || {}
    options = encodeOptions
    const versionLabel = (typeof requestedLabel === 'string' && requestedLabel.trim()) || mediaVersions.defaultVersionLabel(['m4b', options.bitrate].filter(Boolean).join(' '))
    const versionDir = await mediaVersions.getNewVersionDir(libraryItem, versionLabel)

    const audiobookBaseName = libraryItem.isFile ? Path.basename(libraryItem.path, Path.extname(libraryItem.path)) : Path.basename(libraryItem.path)
    const targetFilename = audiobookBaseName + '.m4b'
    const itemCachePath = Path.join(this.itemsCacheDir, libraryItem.id)
    const tempFilepath = Path.join(itemCachePath, targetFilename)
    const ffmetadataPath = Path.join(itemCachePath, 'ffmetadata.txt')
    const libraryItemDir = libraryItem.isFile ? Path.dirname(libraryItem.path) : libraryItem.path
    const taskData = {
      libraryItemId: libraryItem.id,
      libraryItemDir,
      userId,
      inos: libraryItem.media.includedAudioFiles.map((f) => f.ino),
      tempFilepath,
      targetFilename,
      targetFilepath: Path.join(versionDir, targetFilename),
      versionDir,
      versionLabel,
      itemCachePath,
      ffmetadataObject: ffmpegHelpers.getFFMetadataObject(libraryItem, 1),
      chapters: libraryItem.media.chapters?.map((c) => ({ ...c })),
      coverPath: libraryItem.media.coverPath,
      ffmetadataPath,
      duration: libraryItem.media.duration,
      encodeOptions: options
    }

    const taskTitleString = {
      text: 'Encoding M4b',
      key: 'MessageTaskEncodingM4b'
    }
    const taskDescriptionString = {
      text: `Encoding audiobook "${libraryItem.media.title}" into a single m4b file.`,
      key: 'MessageTaskEncodingM4bDescription',
      subs: [libraryItem.media.title]
    }
    task.setData('encode-m4b', taskTitleString, taskDescriptionString, false, taskData)
    TaskManager.addTask(task)
    Logger.info(`Start m4b encode for ${libraryItem.id} - TaskId: ${task.id}`)

    if (!(await fs.pathExists(taskData.itemCachePath))) {
      await fs.mkdir(taskData.itemCachePath)
    }

    this.runAudiobookMerge(libraryItem, task, options || {})
  }

  /**
   *
   * @param {import('../models/LibraryItem')} libraryItem
   * @param {Task} task
   * @param {AbMergeEncodeOptions} encodingOptions
   */
  async runAudiobookMerge(libraryItem, task, encodingOptions) {
    // Make sure the version directory can be created and written (the library folder itself may be read-only)
    const versionDirReady = await fs
      .mkdirp(task.data.versionDir)
      .then(() => isWritable(task.data.versionDir))
      .catch(() => false)
    if (!versionDirReady) {
      Logger.error(`[AbMergeManager] Version directory is not writable: ${task.data.versionDir}`)
      const taskFailedString = {
        text: 'Target directory is not writable',
        key: 'MessageTaskTargetDirectoryNotWritable'
      }
      task.setFailed(taskFailedString)
      this.removeTask(task, true)
      return
    }

    // Create ffmetadata file
    if (!(await ffmpegHelpers.writeFFMetadataFile(task.data.ffmetadataObject, task.data.chapters, task.data.ffmetadataPath))) {
      Logger.error(`[AudioMetadataManager] Failed to write ffmetadata file for audiobook "${task.data.libraryItemId}"`)
      const taskFailedString = {
        text: 'Failed to write metadata file',
        key: 'MessageTaskFailedToWriteMetadataFile'
      }
      task.setFailed(taskFailedString)
      this.removeTask(task, true)
      return
    }

    this.pendingTasks.push({
      id: task.id,
      task
    })

    const encodeFraction = 0.95
    const embedFraction = 1 - encodeFraction
    try {
      const trackProgressMonitor = new TrackProgressMonitor(
        libraryItem.media.includedAudioFiles.map((t) => t.duration),
        (trackIndex) => SocketAuthority.adminEmitter('track_started', { libraryItemId: libraryItem.id, ino: task.data.inos[trackIndex] }),
        (trackIndex, progressInTrack, taskProgress) => {
          SocketAuthority.adminEmitter('track_progress', { libraryItemId: libraryItem.id, ino: task.data.inos[trackIndex], progress: progressInTrack })
          SocketAuthority.adminEmitter('task_progress', { libraryItemId: libraryItem.id, progress: taskProgress * encodeFraction })
        },
        (trackIndex) => SocketAuthority.adminEmitter('track_finished', { libraryItemId: libraryItem.id, ino: task.data.inos[trackIndex] })
      )
      task.data.ffmpeg = new Ffmpeg()
      await ffmpegHelpers.mergeAudioFiles(libraryItem.media.includedAudioFiles, task.data.duration, task.data.itemCachePath, task.data.tempFilepath, encodingOptions, (progress) => trackProgressMonitor.update(progress), task.data.ffmpeg)
      delete task.data.ffmpeg
      trackProgressMonitor.finish()
    } catch (error) {
      if (error.message === 'FFMPEG_CANCELED') {
        Logger.info(`[AbMergeManager] Task cancelled ${task.id}`)
      } else {
        Logger.error(`[AbMergeManager] mergeAudioFiles failed`, error)
        const taskFailedString = {
          text: 'Failed to merge audio files',
          key: 'MessageTaskFailedToMergeAudioFiles'
        }
        task.setFailed(taskFailedString)
        this.removeTask(task, true)
      }
      return
    }

    // Write metadata to merged file
    try {
      task.data.ffmpeg = new Ffmpeg()
      await ffmpegHelpers.addCoverAndMetadataToFile(
        task.data.tempFilepath,
        task.data.coverPath,
        task.data.ffmetadataPath,
        1,
        'audio/mp4',
        (progress) => {
          Logger.debug(`[AbMergeManager] Embedding metadata progress: ${100 * encodeFraction + progress * embedFraction}`)
          SocketAuthority.adminEmitter('task_progress', { libraryItemId: libraryItem.id, progress: 100 * encodeFraction + progress * embedFraction })
        },
        task.data.ffmpeg
      )
      delete task.data.ffmpeg
    } catch (error) {
      if (error.message === 'FFMPEG_CANCELED') {
        Logger.info(`[AbMergeManager] Task cancelled ${task.id}`)
      } else {
        Logger.error(`[AbMergeManager] Failed to embed metadata in file "${task.data.tempFilepath}"`)
        const taskFailedString = {
          text: `Failed to embed metadata in file ${Path.basename(task.data.tempFilepath)}`,
          key: 'MessageTaskFailedToEmbedMetadataInFile',
          subs: [Path.basename(task.data.tempFilepath)]
        }
        task.setFailed(taskFailedString)
        this.removeTask(task, true)
      }
      return
    }

    // Move the m4b into the version directory and register it as a new file version
    Logger.debug(`[AbMergeManager] Moving m4b from ${task.data.tempFilepath} to ${task.data.targetFilepath}`)
    try {
      await fs.move(task.data.tempFilepath, task.data.targetFilepath, { overwrite: false })
      const version = await mediaVersions.createAudioVersion({
        libraryItem,
        dirPath: task.data.versionDir,
        filePaths: [task.data.targetFilepath],
        label: task.data.versionLabel,
        tool: 'encode-m4b',
        options: { ...encodingOptions },
        chapters: task.data.chapters
      })
      task.data.versionId = version.id
      SocketAuthority.emitter('item_versions_updated', { libraryItemId: libraryItem.id })
      Logger.info(`[AbMergeManager] Created version "${version.label}" (${version.id}) at "${task.data.versionDir}"`)
    } catch (err) {
      Logger.error(`[AbMergeManager] Failed to create version from m4b "${task.data.tempFilepath}"`, err)
      const taskFailedString = {
        text: 'Failed to move m4b file',
        key: 'MessageTaskFailedToMoveM4bFile'
      }
      task.setFailed(taskFailedString)
      this.removeTask(task, true)
      return
    }

    // Remove ffmetadata file
    await fs.remove(task.data.ffmetadataPath)

    task.setFinished()
    await this.removeTask(task, false)
    Logger.info(`[AbMergeManager] Ab task finished ${task.id}`)
  }

  /**
   * Remove ab merge task
   *
   * @param {Task} task
   * @param {boolean} [removeTempFilepath=false]
   */
  async removeTask(task, removeTempFilepath = false) {
    Logger.info('[AbMergeManager] Removing task ' + task.id)

    const pendingTask = this.pendingTasks.find((d) => d.id === task.id)
    if (pendingTask) {
      this.pendingTasks = this.pendingTasks.filter((d) => d.id !== task.id)
      if (task.data.ffmpeg) {
        Logger.warn(`[AbMergeManager] Killing ffmpeg process for task ${task.id}`)
        task.data.ffmpeg.kill()
        // wait for ffmpeg to exit, so that the output file is unlocked
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }

    if (removeTempFilepath) {
      // Fork: remove the version directory of a failed/canceled encode (only if no version was registered)
      if (task.data.versionDir && !task.data.versionId) {
        await fs.remove(task.data.versionDir).catch((err) => {
          Logger.error('[AbMergeManager] Failed to remove version directory', err)
        })
      }
      // On failed tasks remove the bad file if it exists
      if (await fs.pathExists(task.data.tempFilepath)) {
        await fs
          .remove(task.data.tempFilepath)
          .then(() => {
            Logger.info('[AbMergeManager] Deleted target file', task.data.tempFilepath)
          })
          .catch((err) => {
            Logger.error('[AbMergeManager] Failed to delete target file', err)
          })
      }
      if (await fs.pathExists(task.data.ffmetadataPath)) {
        await fs
          .remove(task.data.ffmetadataPath)
          .then(() => {
            Logger.info('[AbMergeManager] Deleted ffmetadata file', task.data.ffmetadataPath)
          })
          .catch((err) => {
            Logger.error('[AbMergeManager] Failed to delete ffmetadata file', err)
          })
      }
    }

    TaskManager.taskFinished(task)
  }
}
module.exports = AbMergeManager
