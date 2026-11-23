const { expect } = require('chai')
const { Sequelize } = require('sequelize')
const sinon = require('sinon')

const Database = require('../../../server/Database')
const Logger = require('../../../server/Logger')
const SocketAuthority = require('../../../server/SocketAuthority')
const mediaVersions = require('../../../server/utils/mediaVersions')
const MeController = require('../../../server/controllers/MeController')
const PlaybackSessionManager = require('../../../server/managers/PlaybackSessionManager')
const ToolsController = require('../../../server/controllers/ToolsController')

describe('version time scale in controllers and managers', () => {
  let library, folder, item, user

  const makeManager = () => {
    const prev = global.MetadataPath
    global.MetadataPath = global.MetadataPath || 'meta'
    try {
      return new PlaybackSessionManager()
    } finally {
      global.MetadataPath = prev
    }
  }

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

    library = await Database.libraryModel.create({ name: 'Lib', mediaType: 'book' })
    folder = await Database.libraryFolderModel.create({ path: '/lib', libraryId: library.id })
    const book = await Database.bookModel.create({ title: 'One', audioFiles: [], tags: [], narrators: [], genres: [], chapters: [] })
    const li = await Database.libraryItemModel.create({ libraryFiles: [], mediaId: book.id, mediaType: 'book', libraryId: library.id, libraryFolderId: folder.id, path: '/lib/One', relPath: 'One' })
    item = await Database.libraryItemModel.getExpandedById(li.id)
    const perms = { accessAllLibraries: true, accessAllTags: true, accessExplicitContent: true }
    user = await Database.userModel.create({ username: 'user', type: 'user', isActive: true, permissions: perms, extraData: {}, bookmarks: [] })
    await mediaVersions.setSelection(user, item.id, 'audio', 'vid-1', 0.8)
  })

  afterEach(async () => {
    sinon.restore()
    await Database.sequelize.sync({ force: true })
  })

  describe('MeController bookmarks', () => {
    it('createBookmark stores original time and returns the user time', async () => {
      const res = makeRes()
      await MeController.createBookmark({ params: { id: item.id }, body: { time: 80, title: 'bm' }, user }, res)
      expect(user.bookmarks).to.have.length(1)
      expect(user.bookmarks[0].time).to.be.closeTo(100, 1e-9)
      const returned = res.json.firstCall.args[0]
      expect(returned.time).to.be.closeTo(80, 1e-9)
      expect(returned.title).to.equal('bm')
      // user_updated payload shows user time too
      const payload = SocketAuthority.clientEmitter.firstCall.args[2]
      expect(payload.bookmarks[0].time).to.be.closeTo(80, 1e-9)
    })

    it('updateBookmark finds the bookmark by user time', async () => {
      await user.createBookmark(item.id, 100, 'old')
      const res = makeRes()
      await MeController.updateBookmark({ params: { id: item.id }, body: { time: 80, title: 'new' }, user }, res)
      expect(res.sendStatus.called).to.be.false
      expect(user.bookmarks[0].title).to.equal('new')
      expect(res.json.firstCall.args[0].time).to.be.closeTo(80, 1e-9)
    })

    it('removeBookmark removes by user time', async () => {
      await user.createBookmark(item.id, 100, 'bm')
      const res = makeRes()
      await MeController.removeBookmark({ params: { id: item.id, time: '80' }, user }, res)
      expect(res.sendStatus.calledWith(200)).to.be.true
      expect(user.bookmarks).to.have.length(0)
      const reloaded = await Database.userModel.findByPk(user.id)
      expect(reloaded.bookmarks).to.have.length(0)
    })

    it('removeBookmark returns 404 when nothing matches', async () => {
      await user.createBookmark(item.id, 100, 'bm')
      const res = makeRes()
      await MeController.removeBookmark({ params: { id: item.id, time: '50' }, user }, res)
      expect(res.sendStatus.calledWith(404)).to.be.true
      expect(user.bookmarks).to.have.length(1)
    })
  })

  describe('User.findBookmark', () => {
    it('matches within 0.001 tolerance', async () => {
      await user.createBookmark(item.id, 100, 'bm')
      expect(user.findBookmark(item.id, 100.0005)).to.exist
      expect(user.findBookmark(item.id, 100.01)).to.not.exist
      expect(await user.removeBookmark(item.id, 99.9995)).to.be.true
      expect(user.bookmarks).to.have.length(0)
    })
  })

  describe('PlaybackSessionManager.syncSession', () => {
    it('divides incoming times by the session time scale', async () => {
      const manager = makeManager()
      sinon.stub(manager, 'saveSession')
      const fakeUser = { id: 'u1', createUpdateMediaProgressFromPayload: sinon.stub().resolves({ mediaProgress: null }) }
      const session = { id: 's1', libraryItemId: item.id, episodeId: null, timeScale: 0.8, duration: 80, progress: 0.1, deviceDescription: 'd', addListeningTime: sinon.spy() }

      const ok = await manager.syncSession(fakeUser, session, { currentTime: 80, duration: 160, timeListened: 5 })

      expect(ok).to.be.true
      expect(session.currentTime).to.equal(80)
      const payload = fakeUser.createUpdateMediaProgressFromPayload.firstCall.args[0]
      expect(payload.currentTime).to.be.closeTo(100, 1e-9)
      expect(payload.duration).to.be.closeTo(200, 1e-9)
    })

    it('leaves times alone without a time scale', async () => {
      const manager = makeManager()
      sinon.stub(manager, 'saveSession')
      const fakeUser = { id: 'u1', createUpdateMediaProgressFromPayload: sinon.stub().resolves({ mediaProgress: null }) }
      const session = { id: 's1', libraryItemId: item.id, episodeId: null, duration: 80, deviceDescription: 'd', addListeningTime: sinon.spy() }
      await manager.syncSession(fakeUser, session, { currentTime: 80, timeListened: 5 })
      const payload = fakeUser.createUpdateMediaProgressFromPayload.firstCall.args[0]
      expect(payload.currentTime).to.equal(80)
      expect(payload.duration).to.equal(80)
    })
  })

  describe('ToolsController.encodeM4b', () => {
    const makeReq = (query) => ({ params: { id: 'x' }, query, user: { id: 'u' }, libraryItem: { id: 'x', isMissing: false, isInvalid: false, isBook: true, hasAudioTracks: true, media: { title: 't' } } })
    const makeCtx = () => ({ abMergeManager: { getPendingTaskByLibraryItemId: sinon.stub().returns(null), startAudiobookMerge: sinon.spy() } })

    it('returns 400 for invalid processing options', async () => {
      const ctx = makeCtx()
      const res = makeRes()
      await ToolsController.encodeM4b.call(ctx, makeReq({ speed: '9' }), res)
      expect(res.status.calledWith(400)).to.be.true
      expect(ctx.abMergeManager.startAudiobookMerge.called).to.be.false
    })

    it('returns 400 for codec copy combined with processing', async () => {
      const ctx = makeCtx()
      const res = makeRes()
      await ToolsController.encodeM4b.call(ctx, makeReq({ codec: 'copy', normalize: '1' }), res)
      expect(res.status.calledWith(400)).to.be.true
      expect(ctx.abMergeManager.startAudiobookMerge.called).to.be.false
    })

    it('starts the merge for valid options', async () => {
      const ctx = makeCtx()
      const res = makeRes()
      await ToolsController.encodeM4b.call(ctx, makeReq({ codec: 'aac', speed: '1.25' }), res)
      expect(ctx.abMergeManager.startAudiobookMerge.calledOnce).to.be.true
      expect(res.sendStatus.calledWith(200)).to.be.true
    })

    it('allows codec copy without processing', async () => {
      const ctx = makeCtx()
      const res = makeRes()
      await ToolsController.encodeM4b.call(ctx, makeReq({ codec: 'copy' }), res)
      expect(res.sendStatus.calledWith(200)).to.be.true
    })
  })
})
