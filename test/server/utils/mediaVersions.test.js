const { expect } = require('chai')
const { Sequelize } = require('sequelize')
const sinon = require('sinon')
const Path = require('path')
const os = require('os')
const fs = require('fs')

const Database = require('../../../server/Database')
const Logger = require('../../../server/Logger')
const mediaVersions = require('../../../server/utils/mediaVersions')

describe('mediaVersions', () => {
  let library, folder, libraryItem, otherItem, user, user2, tmpRoot, prevVersionsPath

  const makeFile = (ino, name, duration) => ({ ino, index: 1, metadata: { filename: name, path: `/v/${name}`, size: 1000 }, duration, mimeType: 'audio/mp4' })

  async function makeVersion(item, { label = 'v', files, duration, dirPath } = {}) {
    const id = require('crypto').randomUUID()
    files = files || [makeFile(mediaVersions.makeVersionFileIno(id, 1), 'a.m4b', 100), makeFile(mediaVersions.makeVersionFileIno(id, 2), 'b.m4b', 50)]
    return Database.mediaVersionModel.create({
      id,
      libraryItemId: item.id,
      kind: 'audio',
      label,
      tool: 'encode-m4b',
      options: {},
      dirPath: dirPath || Path.join(tmpRoot, 'x', id),
      files,
      duration: duration ?? files.reduce((s, f) => s + f.duration, 0),
      chapters: [],
      size: 2000
    })
  }

  async function makeItem(title, relPath, extra = {}) {
    const book = await Database.bookModel.create({
      title,
      audioFiles: [{ ino: '111', index: 1, metadata: { filename: 'orig.mp3', path: `/lib/${title}/orig.mp3`, size: 5 }, duration: 10, mimeType: 'audio/mpeg' }],
      tags: [],
      narrators: [],
      genres: [],
      chapters: []
    })
    const li = await Database.libraryItemModel.create({ libraryFiles: [], mediaId: book.id, mediaType: 'book', libraryId: library.id, libraryFolderId: folder.id, path: `/lib/${relPath}`, relPath, ...extra })
    return Database.libraryItemModel.getExpandedById(li.id)
  }

  beforeEach(async () => {
    global.ServerSettings = {}
    Database.sequelize = new Sequelize({ dialect: 'sqlite', storage: ':memory:', logging: false })
    Database.sequelize.uppercaseFirst = (str) => (str ? `${str[0].toUpperCase()}${str.substr(1)}` : '')
    await Database.buildModels()
    sinon.stub(Logger, 'info')
    sinon.stub(Logger, 'warn')
    sinon.stub(Logger, 'error')

    prevVersionsPath = global.VersionsPath
    tmpRoot = fs.mkdtempSync(Path.join(os.tmpdir(), 'abs-versions-'))
    global.VersionsPath = tmpRoot

    library = await Database.libraryModel.create({ name: 'My: Lib', mediaType: 'book' })
    folder = await Database.libraryFolderModel.create({ path: '/lib', libraryId: library.id })
    libraryItem = await makeItem('Book One', 'Author/Book One')
    otherItem = await makeItem('Book Two', 'Author/Book Two')
    user = await Database.userModel.create({ username: 'u1', type: 'user', isActive: true, permissions: {}, extraData: {} })
    user2 = await Database.userModel.create({ username: 'u2', type: 'user', isActive: true, permissions: {}, extraData: {} })
  })

  afterEach(async () => {
    sinon.restore()
    global.VersionsPath = prevVersionsPath
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    await Database.sequelize.sync({ force: true })
  })

  describe('version file inos', () => {
    it('makes ver_ prefixed inos that are never numeric', () => {
      const ino = mediaVersions.makeVersionFileIno('123e4567-e89b-12d3-a456-426614174000', 3)
      expect(ino).to.equal('ver_123e4567e89b_3')
      expect(ino.startsWith('ver_')).to.be.true
      expect(/^\d+$/.test(ino)).to.be.false
    })

    it('isVersionFileIno only accepts ver_ strings', () => {
      expect(mediaVersions.isVersionFileIno('ver_abc_1')).to.be.true
      expect(mediaVersions.isVersionFileIno('123456')).to.be.false
      expect(mediaVersions.isVersionFileIno(123456)).to.be.false
      expect(mediaVersions.isVersionFileIno(undefined)).to.be.false
    })
  })

  describe('setSelection', () => {
    it('sets and persists a selection', async () => {
      await mediaVersions.setSelection(user, libraryItem.id, 'audio', 'vid-1')
      const reloaded = await Database.userModel.findByPk(user.id)
      expect(reloaded.extraData.mediaVersions).to.deep.equal({ [libraryItem.id]: { audio: 'vid-1' } })
      expect(mediaVersions.getSelectedAudioVersionId(reloaded, libraryItem.id)).to.equal('vid-1')
    })

    it('clearing removes the item key', async () => {
      await mediaVersions.setSelection(user, libraryItem.id, 'audio', 'vid-1')
      await mediaVersions.setSelection(user, otherItem.id, 'audio', 'vid-2')
      await mediaVersions.setSelection(user, libraryItem.id, 'audio', null)
      const reloaded = await Database.userModel.findByPk(user.id)
      expect(reloaded.extraData.mediaVersions).to.deep.equal({ [otherItem.id]: { audio: 'vid-2' } })
    })

    it('rejects unsupported kinds', async () => {
      let err
      try {
        await mediaVersions.setSelection(user, libraryItem.id, 'ebook', 'x')
      } catch (e) {
        err = e
      }
      expect(err).to.be.an('error')
    })
  })

  describe('getSelectedAudioVersion', () => {
    it('returns null without a selection', async () => {
      await makeVersion(libraryItem)
      expect(await mediaVersions.getSelectedAudioVersion(user, libraryItem)).to.be.null
    })

    it('returns the selected version', async () => {
      const version = await makeVersion(libraryItem)
      await mediaVersions.setSelection(user, libraryItem.id, 'audio', version.id)
      const selected = await mediaVersions.getSelectedAudioVersion(user, libraryItem)
      expect(selected.id).to.equal(version.id)
    })

    it('returns null when the selected version was deleted', async () => {
      const version = await makeVersion(libraryItem)
      await mediaVersions.setSelection(user, libraryItem.id, 'audio', version.id)
      await version.destroy()
      expect(await mediaVersions.getSelectedAudioVersion(user, libraryItem)).to.be.null
    })

    it('returns null when the version belongs to another item', async () => {
      const version = await makeVersion(otherItem)
      await mediaVersions.setSelection(user, libraryItem.id, 'audio', version.id)
      expect(await mediaVersions.getSelectedAudioVersion(user, libraryItem)).to.be.null
    })
  })

  describe('getAudioView', () => {
    it('returns null for originals', async () => {
      expect(await mediaVersions.getAudioView(user, libraryItem)).to.be.null
    })

    it('returns version files as tracks with offsets and duration', async () => {
      const version = await makeVersion(libraryItem)
      await mediaVersions.setSelection(user, libraryItem.id, 'audio', version.id)
      const view = await mediaVersions.getAudioView(user, libraryItem)
      expect(view.duration).to.equal(150)
      expect(view.tracks).to.have.length(2)
      expect(view.tracks[0].contentUrl).to.equal(`/api/items/${libraryItem.id}/file/${version.files[0].ino}`)
      expect(view.tracks[1].contentUrl).to.equal(`/api/items/${libraryItem.id}/file/${version.files[1].ino}`)
      expect(view.tracks.map((t) => t.startOffset)).to.deep.equal([0, 100])
      expect(view.audioFiles).to.have.length(2)
    })
  })

  describe('applyToExpandedItemJson', () => {
    it('adds versions and selectedVersions but leaves files alone without a selection', async () => {
      const version = await makeVersion(libraryItem)
      const json = libraryItem.toOldJSONExpanded()
      const origInos = json.media.audioFiles.map((f) => f.ino)
      await mediaVersions.applyToExpandedItemJson(json, user, libraryItem)
      expect(json.media.versions).to.have.length(1)
      expect(json.media.versions[0].id).to.equal(version.id)
      expect(json.media.selectedVersions).to.deep.equal({ audio: null })
      expect(json.media.audioFiles.map((f) => f.ino)).to.deep.equal(origInos)
    })

    it('swaps in version files only for the user with a selection', async () => {
      const version = await makeVersion(libraryItem)
      await mediaVersions.setSelection(user, libraryItem.id, 'audio', version.id)

      const json1 = libraryItem.toOldJSONExpanded()
      await mediaVersions.applyToExpandedItemJson(json1, user, libraryItem)
      expect(json1.media.selectedVersions).to.deep.equal({ audio: version.id })
      expect(json1.media.audioFiles.map((f) => f.ino)).to.deep.equal(version.files.map((f) => f.ino))
      expect(json1.media.tracks.map((t) => t.ino)).to.deep.equal(version.files.map((f) => f.ino))
      expect(json1.media.duration).to.equal(150)

      const json2 = libraryItem.toOldJSONExpanded()
      await mediaVersions.applyToExpandedItemJson(json2, user2, libraryItem)
      expect(json2.media.selectedVersions).to.deep.equal({ audio: null })
      expect(json2.media.audioFiles.map((f) => f.ino)).to.deep.equal(['111'])
      expect(json2.media.versions).to.have.length(1)
    })
  })

  describe('findVersionFileByIno', () => {
    it('finds a version file', async () => {
      const version = await makeVersion(libraryItem)
      const found = await mediaVersions.findVersionFileByIno(libraryItem.id, version.files[1].ino)
      expect(found.version.id).to.equal(version.id)
      expect(found.file.ino).to.equal(version.files[1].ino)
    })

    it('returns null for unknown or non-version inos', async () => {
      await makeVersion(libraryItem)
      expect(await mediaVersions.findVersionFileByIno(libraryItem.id, 'ver_nope_1')).to.be.null
      expect(await mediaVersions.findVersionFileByIno(libraryItem.id, '111')).to.be.null
    })

    it('does not find files of another item', async () => {
      const version = await makeVersion(otherItem)
      expect(await mediaVersions.findVersionFileByIno(libraryItem.id, version.files[0].ino)).to.be.null
    })
  })

  describe('getNewVersionDir', () => {
    it('mirrors the library layout and sanitizes names', async () => {
      const dir = (await mediaVersions.getNewVersionDir(libraryItem, 'm4b: 64k/?')).split(Path.sep).join('/')
      const expected = Path.join(tmpRoot, 'My - Lib', 'Author', 'Book One', 'm4b - 64k').split(Path.sep).join('/')
      expect(dir).to.equal(expected)
    })

    it('adds a numeric suffix when the directory exists', async () => {
      const first = await mediaVersions.getNewVersionDir(libraryItem, 'enc')
      fs.mkdirSync(first, { recursive: true })
      const second = await mediaVersions.getNewVersionDir(libraryItem, 'enc')
      expect(second).to.equal(`${first} (2)`)
      fs.mkdirSync(second, { recursive: true })
      expect(await mediaVersions.getNewVersionDir(libraryItem, 'enc')).to.equal(`${first} (3)`)
    })

    it('falls back to a default label and strips the extension for single-file items', async () => {
      const fileItem = await makeItem('Solo', 'Solo Book.m4b', { isFile: true })
      const dir = (await mediaVersions.getNewVersionDir(fileItem, '')).split(Path.sep).join('/')
      expect(dir.endsWith('/Solo Book/version')).to.be.true
    })
  })

  describe('deleteVersion', () => {
    it('removes the directory, the row and users selections', async () => {
      const dirPath = Path.join(tmpRoot, 'lib', 'item', 'v1')
      fs.mkdirSync(dirPath, { recursive: true })
      fs.writeFileSync(Path.join(dirPath, 'a.m4b'), 'x')
      const version = await makeVersion(libraryItem, { dirPath })
      await mediaVersions.setSelection(user, libraryItem.id, 'audio', version.id)

      const changed = await mediaVersions.deleteVersion(version)

      expect(fs.existsSync(dirPath)).to.be.false
      expect(await Database.mediaVersionModel.findByPk(version.id)).to.be.null
      expect(changed.map((u) => u.id)).to.deep.equal([user.id])
      const reloaded = await Database.userModel.findByPk(user.id)
      expect(reloaded.extraData.mediaVersions).to.deep.equal({})
    })

    it('never removes a directory outside VersionsPath', async () => {
      const outside = fs.mkdtempSync(Path.join(os.tmpdir(), 'abs-outside-'))
      try {
        fs.writeFileSync(Path.join(outside, 'keep.txt'), 'x')
        const version = await makeVersion(libraryItem, { dirPath: outside })
        await mediaVersions.deleteVersion(version)
        expect(fs.existsSync(Path.join(outside, 'keep.txt'))).to.be.true
        expect(await Database.mediaVersionModel.findByPk(version.id)).to.be.null
      } finally {
        fs.rmSync(outside, { recursive: true, force: true })
      }
    })
  })

  describe('createAudioVersion', () => {
    it('probes files, assigns synthetic inos and saves the row and manifest', async () => {
      const AudioFileScanner = require('../../../server/scanner/AudioFileScanner')
      const dirPath = Path.join(tmpRoot, 'new-version')
      fs.mkdirSync(dirPath, { recursive: true })
      const f1 = Path.join(dirPath, 'one.m4b')
      const f2 = Path.join(dirPath, 'two.m4b')
      fs.writeFileSync(f1, 'aaaa')
      fs.writeFileSync(f2, 'bbbbbb')

      const durations = { 'one.m4b': 30, 'two.m4b': 12.5 }
      const sizes = { 'one.m4b': 4, 'two.m4b': 6 }
      sinon.stub(AudioFileScanner, 'scan').callsFake(async (_type, libraryFile) => ({
        toJSON: () => {
          const filename = libraryFile.metadata.filename
          return { metadata: { filename, size: sizes[filename], path: libraryFile.metadata.path }, duration: durations[filename], mimeType: 'audio/mp4' }
        }
      }))

      const version = await mediaVersions.createAudioVersion({ libraryItem, dirPath, filePaths: [f1, f2], label: 'Test enc', tool: 'encode-m4b', options: { bitrate: '64k' } })

      expect(version.files).to.have.length(2)
      expect(version.files.map((f) => f.ino)).to.deep.equal([mediaVersions.makeVersionFileIno(version.id, 1), mediaVersions.makeVersionFileIno(version.id, 2)])
      expect(version.files.map((f) => f.index)).to.deep.equal([1, 2])
      expect(version.files.every((f) => f.exclude === false)).to.be.true
      expect(version.duration).to.equal(42.5)
      expect(Number(version.size)).to.equal(10)

      const row = await Database.mediaVersionModel.findByPk(version.id)
      expect(row.label).to.equal('Test enc')
      expect(row.kind).to.equal('audio')
      expect(row.libraryItemId).to.equal(libraryItem.id)
      expect(row.options).to.deep.equal({ bitrate: '64k' })

      const manifest = JSON.parse(fs.readFileSync(Path.join(dirPath, 'version.json'), 'utf8'))
      expect(manifest.versionId).to.equal(version.id)
      expect(manifest.files.map((f) => f.filename)).to.deep.equal(['one.m4b', 'two.m4b'])
    })

    it('throws when a file cannot be probed', async () => {
      const AudioFileScanner = require('../../../server/scanner/AudioFileScanner')
      const f1 = Path.join(tmpRoot, 'bad.m4b')
      fs.writeFileSync(f1, 'x')
      sinon.stub(AudioFileScanner, 'scan').resolves(null)
      let err
      try {
        await mediaVersions.createAudioVersion({ libraryItem, dirPath: tmpRoot, filePaths: [f1], label: 'x', tool: 't' })
      } catch (e) {
        err = e
      }
      expect(err).to.be.an('error')
      expect(await Database.mediaVersionModel.count()).to.equal(0)
    })
  })
})
