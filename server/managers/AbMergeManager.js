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
const audioProcessing = require('../utils/audioProcessing')
const audioParts = require('../utils/audioParts')

/**
 * @typedef AbMergeEncodeOptions
 * @property {string} codec
 * @property {string} channels
 * @property {string} bitrate
 * @property {string} [label] - name of the new file version (fork)
 * @property {string} [normalize] - fork: audio processing options, see utils/audioProcessing.js
 * @property {string} [loudnessTarget]
 * @property {string} [truePeak]
 * @property {string} [loudnessRange]
 * @property {string} [compress]
 * @property {string} [voiceEq]
 * @property {string} [denoise]
 * @property {string} [speed]
 * @property {string} [partMinutes] - fork: split the result into parts of about this many minutes
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
    const { label: requestedLabel, normalize, loudnessTarget, truePeak, loudnessRange, compress, voiceEq, denoise, speed, partMinutes: rawPartMinutes, ...encodeOptions } = options || {}
    // Throws on invalid values; ToolsController validates first
    const partMinutes = audioParts.parsePartMinutes(rawPartMinutes)
    // Throws on invalid values; ToolsController validates first so this only fails for direct callers
    const processing = audioProcessing.parseAudioProcessingOptions({ normalize, loudnessTarget, truePeak, loudnessRange, compress, voiceEq, denoise, speed })
    const processingSummary = audioProcessing.summarizeAudioProcessing(processing)
    options = { ...encodeOptions, audioFilters: audioProcessing.buildAudioFilters(processing) }
    // A speed change makes the version shorter/longer; positions map between timelines by this factor
    const timeScale = processing.speed && processing.speed !== 1 ? 1 / processing.speed : 1
    const versionLabel = (typeof requestedLabel === 'string' && requestedLabel.trim()) || mediaVersions.defaultVersionLabel(['m4b', options.bitrate, timeScale !== 1 ? `${processing.speed}x` : null, partMinutes ? `${partMinutes}min parts` : null].filter(Boolean).join(' '))
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
      chapters: libraryItem.media.chapters?.map((c) => ({ ...c, start: c.start * timeScale, end: c.end * timeScale })),
      coverPath: libraryItem.media.coverPath,
      ffmetadataPath,
      partMinutes,
      partsDir: Path.join(itemCachePath, 'parts'),
      audiobookBaseName,
      duration: libraryItem.media.duration * timeScale,
      timeScale,
      processingSummary,
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

    // Fork: optional split into parts after encoding (see utils/audioParts.js)
    const partCuts = task.data.partMinutes ? audioParts.computePartCuts(task.data.duration, task.data.partMinutes * 60, task.data.chapters) : []
    const splitFraction = partCuts.length ? 0.05 : 0
    const encodeFraction = 0.95 - splitFraction
    const embedFraction = 0.05
    try {
      const trackProgressMonitor = new TrackProgressMonitor(
        libraryItem.media.includedAudioFiles.map((t) => t.duration * task.data.timeScale),
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

    // Fork: cut the m4b into parts (no re-encode)
    let partPaths = null
    if (partCuts.length) {
      try {
        await fs.emptyDir(task.data.partsDir)
        task.data.ffmpeg = new Ffmpeg()
        partPaths = await ffmpegHelpers.splitAudioFile(
          task.data.tempFilepath,
          partCuts,
          task.data.partsDir,
          task.data.duration,
          (progress) => {
            SocketAuthority.adminEmitter('task_progress', { libraryItemId: libraryItem.id, progress: 100 * (encodeFraction + embedFraction) + progress * splitFraction })
          },
          task.data.ffmpeg
        )
        delete task.data.ffmpeg
        Logger.info(`[AbMergeManager] Split "${task.data.targetFilename}" into ${partPaths.length} parts`)
      } catch (error) {
        if (error.message === 'FFMPEG_CANCELED') {
          Logger.info(`[AbMergeManager] Task cancelled ${task.id}`)
        } else {
          Logger.error(`[AbMergeManager] Failed to split "${task.data.tempFilepath}" into parts`, error)
          task.setFailed({ text: 'Failed to split audio file into parts', key: 'MessageTaskFailedToSplitIntoParts' })
          this.removeTask(task, true)
        }
        return
      }
    }

    // Move the m4b (or its parts) into the version directory and register it as a new file version
    Logger.debug(`[AbMergeManager] Moving m4b from ${task.data.tempFilepath} to ${task.data.versionDir}`)
    try {
      let filePaths = [task.data.targetFilepath]
      if (partPaths) {
        const digits = Math.max(2, String(partPaths.length).length)
        filePaths = []
        for (const [i, partPath] of partPaths.entries()) {
          const target = Path.join(task.data.versionDir, `${task.data.audiobookBaseName} - Part ${String(i + 1).padStart(digits, '0')}.m4b`)
          await fs.move(partPath, target, { overwrite: false })
          filePaths.push(target)
        }
        await fs.remove(task.data.tempFilepath)
        await fs.remove(task.data.partsDir)
      } else {
        await fs.move(task.data.tempFilepath, task.data.targetFilepath, { overwrite: false })
      }
      const version = await mediaVersions.createAudioVersion({
        libraryItem,
        dirPath: task.data.versionDir,
        filePaths,
        label: task.data.versionLabel,
        tool: 'encode-m4b',
        options: { codec: encodingOptions.codec, bitrate: encodingOptions.bitrate, channels: encodingOptions.channels, ...task.data.processingSummary, ...(partPaths ? { partMinutes: task.data.partMinutes, parts: partPaths.length } : {}) },
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
      if (task.data.partsDir) await fs.remove(task.data.partsDir).catch(() => {})
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
