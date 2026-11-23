const { expect } = require('chai')
const { Sequelize } = require('sequelize')
const sinon = require('sinon')
const Path = require('path')
const os = require('os')
const fs = require('fs')

const Database = require('../../../server/Database')
const Logger = require('../../../server/Logger')
const SocketAuthority = require('../../../server/SocketAuthority')
const MediaVersionController = require('../../../server/controllers/MediaVersionController')

describe('MediaVersionController', () => {
  let library, folder, item, otherItem, admin, user, tmpRoot, prevVersionsPath

  async function makeItem(title) {
    const book = await Database.bookModel.create({ title, audioFiles: [], tags: [], narrators: [], genres: [], chapters: [] })
    const li = await Database.libraryItemModel.create({ libraryFiles: [], mediaId: book.id, mediaType: 'book', libraryId: library.id, libraryFolderId: folder.id, path: `/lib/${title}`, relPath: title })
    return Database.libraryItemModel.getExpandedById(li.id)
  }

  const makeVersion = (li, label = 'v1') =>
    Database.mediaVersionModel.create({ libraryItemId: li.id, kind: 'audio', label, tool: 'encode-m4b', options: {}, dirPath: Path.join(tmpRoot, 'dir', label), files: [{ ino: 'ver_x_1', metadata: { filename: 'a.m4b' }, duration: 5 }], duration: 5, chapters: [], size: 1 })

  const makeRes = () => {
    const send = sinon.spy()
    return { json: sinon.spy(), sendStatus: sinon.spy(), status: sinon.stub().returns({ send }), send }
  }

  beforeEach(async () => {
    global.ServerSettings = {}
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    Database.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')
    await Database.buildModels()
    sinon.stub(Logger, 'info')
    sinon.stub(Logger, 'warn')
    sinon.stub(Logger, 'error')
    sinon.stub(SocketAuthority, 'clientEmitter')
    sinon.stub(SocketAuthority, 'emitter')

    prevVersionsPath = global.VersionsPath
    tmpRoot = fs.mkdtempSync(Path.join(os.tmpdir(), 'abs-versions-ctl-'))
    global.VersionsPath = tmpRoot

    library = await Database.libraryModel.create({ name: 'Lib', mediaType: 'book' })
    folder = await Database.libraryFolderModel.create({ path: '/lib', libraryId: library.id })
    item = await makeItem('One')
    otherItem = await makeItem('Two')
    const perms = { accessAllLibraries: true, accessAllTags: true, accessExplicitContent: true }
    admin = await Database.userModel.create({ username: 'admin', type: 'admin', isActive: true, permissions: perms, extraData: {} })
    user = await Database.userModel.create({ username: 'user', type: 'user', isActive: true, permissions: perms, extraData: {} })
  })

  afterEach(async () => {
    sinon.restore()
    global.VersionsPath = prevVersionsPath
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    await Database.sequelize.sync({ force: true })
  })

  describe('setUserVersion', () => {
    it('404 for an unknown version', async () => {
      const res = makeRes()
      await MediaVersionController.setUserVersion({ params: { id: item.id }, body: { versionId: require('crypto').randomUUID() }, user }, res)
      expect(res.status.calledWith(404)).to.be.true
    })

    it('404 for a version of another item', async () => {
      const v = await makeVersion(otherItem)
      const res = makeRes()
      await MediaVersionController.setUserVersion({ params: { id: item.id }, body: { versionId: v.id }, user }, res)
      expect(res.status.calledWith(404)).to.be.true
      expect(user.extraData.mediaVersions).to.be.undefined
    })

    it('404 for an unknown item', async () => {
      const res = makeRes()
      await MediaVersionController.setUserVersion({ params: { id: require('crypto').randomUUID() }, body: {}, user }, res)
      expect(res.sendStatus.calledWith(404)).to.be.true
    })

    it('400 for an unsupported kind', async () => {
      const res = makeRes()
      await MediaVersionController.setUserVersion({ params: { id: item.id }, body: { kind: 'ebook', versionId: null }, user }, res)
      expect(res.status.calledWith(400)).to.be.true
    })

    it('sets the selection and notifies the user', async () => {
      const v = await makeVersion(item)
      const res = makeRes()
      await MediaVersionController.setUserVersion({ params: { id: item.id }, body: { kind: 'audio', versionId: v.id }, user }, res)
      expect(res.json.calledWith({ selected: { audio: v.id } })).to.be.true
      const reloaded = await Database.userModel.findByPk(user.id)
      expect(reloaded.extraData.mediaVersions[item.id].audio).to.equal(v.id)
      expect(SocketAuthority.clientEmitter.calledWith(user.id, 'user_updated')).to.be.true
    })

    it('null clears the selection', async () => {
      const v = await makeVersion(item)
      await MediaVersionController.setUserVersion({ params: { id: item.id }, body: { versionId: v.id }, user }, makeRes())
      const res = makeRes()
      await MediaVersionController.setUserVersion({ params: { id: item.id }, body: { versionId: null }, user }, res)
      expect(res.json.calledWith({ selected: { audio: null } })).to.be.true
      const reloaded = await Database.userModel.findByPk(user.id)
      expect(reloaded.extraData.mediaVersions).to.deep.equal({})
    })
  })

  describe('getVersions', () => {
    it('returns versions and the user selection', async () => {
      const v = await makeVersion(item)
      await MediaVersionController.setUserVersion({ params: { id: item.id }, body: { versionId: v.id }, user }, makeRes())
      const res = makeRes()
      await MediaVersionController.getVersions({ libraryItem: item, user }, res)
      const payload = res.json.firstCall.args[0]
      expect(payload.versions.map((x) => x.id)).to.deep.equal([v.id])
      expect(payload.selected).to.deep.equal({ audio: v.id })
    })
  })

  describe('deleteVersion', () => {
    it('403 for a non-admin', async () => {
      const v = await makeVersion(item)
      const res = makeRes()
      await MediaVersionController.deleteVersion({ libraryItem: item, params: { versionId: v.id }, user }, res)
      expect(res.sendStatus.calledWith(403)).to.be.true
      expect(await Database.mediaVersionModel.findByPk(v.id)).to.not.be.null
    })

    it('404 for a version of another item', async () => {
      const v = await makeVersion(otherItem)
      const res = makeRes()
      await MediaVersionController.deleteVersion({ libraryItem: item, params: { versionId: v.id }, user: admin }, res)
      expect(res.sendStatus.calledWith(404)).to.be.true
    })

    it('admin deletes and affected users are notified', async () => {
      const v = await makeVersion(item)
      await MediaVersionController.setUserVersion({ params: { id: item.id }, body: { versionId: v.id }, user }, makeRes())
      SocketAuthority.clientEmitter.resetHistory()
      const res = makeRes()
      await MediaVersionController.deleteVersion({ libraryItem: item, params: { versionId: v.id }, user: admin }, res)
      expect(res.sendStatus.calledWith(200)).to.be.true
      expect(await Database.mediaVersionModel.findByPk(v.id)).to.be.null
      expect(SocketAuthority.clientEmitter.calledWith(user.id, 'user_updated')).to.be.true
      expect(SocketAuthority.emitter.calledWith('item_versions_updated', { libraryItemId: item.id })).to.be.true
    })
  })

  describe('updateVersion', () => {
    it('403 for a non-admin', async () => {
      const v = await makeVersion(item)
      const res = makeRes()
      await MediaVersionController.updateVersion({ libraryItem: item, params: { versionId: v.id }, body: { label: 'x' }, user }, res)
      expect(res.sendStatus.calledWith(403)).to.be.true
    })

    it('renames a version (admin)', async () => {
      const v = await makeVersion(item)
      const res = makeRes()
      await MediaVersionController.updateVersion({ libraryItem: item, params: { versionId: v.id }, body: { label: '  Renamed  ' }, user: admin }, res)
      expect(res.json.calledOnce).to.be.true
      expect(res.json.firstCall.args[0].label).to.equal('Renamed')
      const reloaded = await Database.mediaVersionModel.findByPk(v.id)
      expect(reloaded.label).to.equal('Renamed')
      expect(SocketAuthority.emitter.calledWith('item_versions_updated')).to.be.true
    })

    it('400 on an empty label', async () => {
      const v = await makeVersion(item)
      const res = makeRes()
      await MediaVersionController.updateVersion({ libraryItem: item, params: { versionId: v.id }, body: { label: '   ' }, user: admin }, res)
      expect(res.status.calledWith(400)).to.be.true
      expect((await Database.mediaVersionModel.findByPk(v.id)).label).to.equal('v1')
    })
  })
})
