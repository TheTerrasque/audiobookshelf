const { Request, Response } = require('express')
const Logger = require('../Logger')
const Database = require('../Database')
const SocketAuthority = require('../SocketAuthority')
const mediaVersions = require('../utils/mediaVersions')

/**
 * @typedef RequestUserObject
 * @property {import('../models/User')} user
 *
 * @typedef {Request & RequestUserObject} RequestWithUser
 *
 * @typedef RequestEntityObject
 * @property {import('../models/LibraryItem')} libraryItem
 *
 * @typedef {RequestWithUser & RequestEntityObject} LibraryItemControllerRequest
 */

/**
 * Fork: file versions (alternative copies of an item's files stored outside library folders).
 */
class MediaVersionController {
  constructor() {}

  /**
   * GET: /api/items/:id/versions
   * Versions of the item, plus the requesting user's selection.
   *
   * @param {LibraryItemControllerRequest} req
   * @param {Response} res
   */
  async getVersions(req, res) {
    const versions = await mediaVersions.getVersionsForItem(req.libraryItem.id)
    res.json({
      versions: versions.map((v) => v.toJSONForClient()),
      selected: { audio: mediaVersions.getSelectedAudioVersionId(req.user, req.libraryItem.id) },
      originalDuration: req.libraryItem.media.duration || 0
    })
  }

  /**
   * PATCH: /api/items/:id/versions/:versionId
   * Rename a version (admin). Body: { label }
   *
   * @param {LibraryItemControllerRequest} req
   * @param {Response} res
   */
  async updateVersion(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const version = await MediaVersionController.findItemVersion(req)
    if (!version) return res.sendStatus(404)

    const label = typeof req.body?.label === 'string' ? req.body.label.trim() : ''
    if (!label) return res.status(400).send('Invalid label')

    version.label = label
    await version.save()
    await mediaVersions.writeVersionManifest(version, req.libraryItem).catch((error) => {
      Logger.warn(`[MediaVersionController] Failed to update version.json for version "${version.id}"`, error)
    })
    MediaVersionController.emitItemVersionsUpdated(req.libraryItem.id)
    res.json(version.toJSONForClient())
  }

  /**
   * DELETE: /api/items/:id/versions/:versionId
   * Delete a version and its files (admin). Users that selected it fall back to the original.
   *
   * @param {LibraryItemControllerRequest} req
   * @param {Response} res
   */
  async deleteVersion(req, res) {
    if (!req.user.isAdminOrUp) return res.sendStatus(403)
    const version = await MediaVersionController.findItemVersion(req)
    if (!version) return res.sendStatus(404)

    Logger.info(`[MediaVersionController] User "${req.user.username}" deleting version "${version.label}" (${version.id}) of item "${req.libraryItem.id}"`)
    const changedUsers = await mediaVersions.deleteVersion(version)
    for (const user of changedUsers) {
      SocketAuthority.clientEmitter(user.id, 'user_updated', user.toOldJSONForBrowser())
    }
    MediaVersionController.emitItemVersionsUpdated(req.libraryItem.id)
    res.sendStatus(200)
  }

  /**
   * PATCH: /api/me/item/:id/version
   * Choose which version of an item the current user gets.
   * Body: { kind: 'audio', versionId: string|null } (null = original files)
   *
   * @param {RequestWithUser} req
   * @param {Response} res
   */
  async setUserVersion(req, res) {
    const libraryItem = await Database.libraryItemModel.getExpandedById(req.params.id)
    if (!libraryItem?.media) return res.sendStatus(404)
    if (!req.user.checkCanAccessLibraryItem(libraryItem)) return res.sendStatus(403)

    const kind = req.body?.kind || 'audio'
    if (kind !== 'audio') return res.status(400).send('Unsupported version kind')

    const versionId = req.body?.versionId || null
    if (versionId) {
      const version = await Database.mediaVersionModel.findByPk(versionId)
      if (!version || version.libraryItemId !== libraryItem.id || version.kind !== kind) {
        return res.status(404).send('Version not found')
      }
    }

    await mediaVersions.setSelection(req.user, libraryItem.id, kind, versionId)
    SocketAuthority.clientEmitter(req.user.id, 'user_updated', req.user.toOldJSONForBrowser())
    res.json({ selected: { audio: mediaVersions.getSelectedAudioVersionId(req.user, libraryItem.id) } })
  }

  /**
   * @param {LibraryItemControllerRequest} req
   * @returns {Promise<import('../models/MediaVersion')|null>}
   */
  static async findItemVersion(req) {
    const version = await Database.mediaVersionModel.findByPk(req.params.versionId)
    if (!version || version.libraryItemId !== req.libraryItem.id) return null
    return version
  }

  /**
   * Tell clients the version list of an item changed (they refetch it).
   *
   * @param {string} libraryItemId
   */
  static emitItemVersionsUpdated(libraryItemId) {
    SocketAuthority.emitter('item_versions_updated', { libraryItemId })
  }
}
module.exports = new MediaVersionController()
module.exports.MediaVersionController = MediaVersionController
