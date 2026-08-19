const { expect } = require('chai')
const os = require('os')
const Path = require('path')
const sinon = require('sinon')
const fsExtra = require('../../../server/libs/fsExtra')
const realFs = require('fs')
const unrar = require('node-unrar-js')
const comicBookExtractors = require('../../../server/utils/comicBookExtractors')
const { createComicBookExtractor, sanitizeArchiveEntryName } = comicBookExtractors

describe('comicBookExtractors', () => {
  describe('sanitizeArchiveEntryName', () => {
    it('should keep plain file names unchanged', () => {
      expect(sanitizeArchiveEntryName('001.png')).to.equal('001.png')
      expect(sanitizeArchiveEntryName('ComicInfo.xml')).to.equal('ComicInfo.xml')
    })

    it('should keep subfolder entries', () => {
      expect(sanitizeArchiveEntryName('ch1/001.png')).to.equal(Path.join('ch1', '001.png'))
    })

    it('should normalize backslash separators (RAR archives made on Windows)', () => {
      expect(sanitizeArchiveEntryName('ch1\\001.png')).to.equal(Path.join('ch1', '001.png'))
    })

    it('should drop .. segments so the path cannot escape the target directory', () => {
      expect(sanitizeArchiveEntryName('../../evil.png')).to.equal('evil.png')
      expect(sanitizeArchiveEntryName('a/../../../b/../../c.png')).to.equal(Path.join('a', 'b', 'c.png'))
      expect(sanitizeArchiveEntryName('..\\..\\evil.png')).to.equal('evil.png')
    })

    it('should drop . segments and empty segments', () => {
      expect(sanitizeArchiveEntryName('a/./b.png')).to.equal(Path.join('a', 'b.png'))
      expect(sanitizeArchiveEntryName('/a//b.png')).to.equal(Path.join('a', 'b.png'))
    })

    it('should return an empty string when no safe segments remain', () => {
      expect(sanitizeArchiveEntryName('..')).to.equal('')
      expect(sanitizeArchiveEntryName('../..')).to.equal('')
      expect(sanitizeArchiveEntryName('')).to.equal('')
      expect(sanitizeArchiveEntryName('.')).to.equal('')
    })
  })

  describe('CbrComicBookExtractor', () => {
    let tmpDir
    let cbrPath
    let originalMetadataPath
    let createExtractorStub
    let createOptions

    // Emulates node-unrar-js: writes each matched entry to join(targetPath, filenameTransform(name)),
    // which is what ExtractorFile.create() does in the real library (synchronously)
    const makeFakeArchive = (fileHeaders, targetPath, filenameTransform) => ({
      getFileList: () => ({ arcHeader: {}, fileHeaders }),
      extract: ({ files }) => {
        const matched = fileHeaders.filter((fh) => !fh.flags.directory && files.includes(fh.name))
        for (const fh of matched) {
          const fullpath = Path.join(targetPath, filenameTransform(fh.name))
          realFs.mkdirSync(Path.dirname(fullpath), { recursive: true })
          realFs.writeFileSync(fullpath, fh.content)
        }
        return { arcHeader: {}, files: matched.map((fh) => ({ fileHeader: fh })) }
      },
      close: () => {}
    })

    const header = (name, content, directory = false) => ({
      name,
      content,
      flags: { directory }
    })

    beforeEach(async () => {
      originalMetadataPath = global.MetadataPath
      tmpDir = await fsExtra.mkdtemp(Path.join(os.tmpdir(), 'abs-cbr-extractor-test-'))
      global.MetadataPath = tmpDir
      cbrPath = Path.join(tmpDir, 'test.cbr')
      await fsExtra.writeFile(cbrPath, Buffer.from('fake rar data'))

      createOptions = null
      createExtractorStub = sinon.stub(unrar, 'createExtractorFromFile')
    })

    afterEach(async () => {
      createExtractorStub.restore()
      if (originalMetadataPath === undefined) delete global.MetadataPath
      else global.MetadataPath = originalMetadataPath
      await fsExtra.remove(tmpDir)
    })

    const openWithHeaders = async (fileHeaders) => {
      createExtractorStub.callsFake(async (options) => {
        createOptions = options
        return makeFakeArchive(fileHeaders, options.targetPath, options.filenameTransform)
      })
      const extractor = createComicBookExtractor(cbrPath)
      await extractor.open()
      return extractor
    }

    it('should pass a filenameTransform that contains traversal inside the temp directory', async () => {
      const extractor = await openWithHeaders([header('001.png', Buffer.from('a'))])
      expect(createOptions.targetPath).to.equal(Path.join(tmpDir, 'tmp'))
      expect(createOptions.filenameTransform('../../evil.png')).to.equal('evil.png')
      expect(createOptions.filenameTransform('a/../../b.png')).to.equal(Path.join('a', 'b.png'))
      expect(createOptions.filenameTransform('..')).to.equal('unnamed')
      extractor.close()
    })

    it('should exclude traversal-only and control-character entry names from getFilePaths', async () => {
      const extractor = await openWithHeaders([header('01.png', Buffer.from('a')), header('sub/02.png', Buffer.from('b')), header('win\\dir\\03.png', Buffer.from('c')), header('../../evil.png', Buffer.from('x')), header('..\\..\\evil2.png', Buffer.from('x')), header('..', Buffer.from('x')), header('bad\u0000name.png', Buffer.from('x')), header('somedir', Buffer.from(''), true)])

      const filePaths = await extractor.getFilePaths()
      // raw names are preserved (needed for node-unrar entry matching); only unsafe ones are dropped
      expect(filePaths).to.deep.equal(['01.png', 'sub/02.png', 'win\\dir\\03.png'])
      extractor.close()
    })

    it('should read back a traversal entry from inside the temp directory', async () => {
      const content = Buffer.from('traversal page data')
      const extractor = await openWithHeaders([header('001.png', Buffer.from('normal')), header('../../evil.png', content)])

      const data = await extractor.extractToBuffer('../../evil.png')
      expect(data).to.deep.equal(content)

      // Nothing may have been created outside the temp directory
      expect(await fsExtra.pathExists(Path.join(tmpDir, 'evil.png'))).to.be.false
      const metadataContents = await fsExtra.readdir(tmpDir)
      expect(metadataContents).to.deep.equal(['test.cbr', 'tmp'])
      extractor.close()
    })

    it('should still extract legitimate subfolder entries', async () => {
      const content = Buffer.from('nested page')
      const extractor = await openWithHeaders([header(Path.join('sub', '001.png'), content)])

      const data = await extractor.extractToBuffer(Path.join('sub', '001.png'))
      expect(data).to.deep.equal(content)
      extractor.close()
    })

    it('should return null when the entry does not exist in the archive', async () => {
      const extractor = await openWithHeaders([header('001.png', Buffer.from('a'))])
      expect(await extractor.extractToBuffer('999.png')).to.be.null
      extractor.close()
    })

    it('should extractToFile without writing outside the temp directory', async () => {
      const content = Buffer.from('cover data')
      const extractor = await openWithHeaders([header('../../cover.png', content)])
      const outputPath = Path.join(tmpDir, 'covers', 'cover.png')

      const ok = await extractor.extractToFile('../../cover.png', outputPath)
      expect(ok).to.be.true
      expect(await fsExtra.readFile(outputPath)).to.deep.equal(content)

      expect(await fsExtra.pathExists(Path.join(tmpDir, 'cover.png'))).to.be.false
      const metadataContents = await fsExtra.readdir(tmpDir)
      expect(metadataContents).to.deep.equal(['covers', 'test.cbr', 'tmp'])
      extractor.close()
    })

    it('should return false when the entry does not exist in the archive', async () => {
      const extractor = await openWithHeaders([header('001.png', Buffer.from('a'))])
      expect(await extractor.extractToFile('999.png', Path.join(tmpDir, 'out.png'))).to.be.false
      extractor.close()
    })

    it('should only remove empty directories inside the temp directory', async () => {
      const extractor = await openWithHeaders([header('001.png', Buffer.from('a'))])
      const subDir = Path.join(extractor.tmpDir, 'sub')
      await fsExtra.ensureDir(subDir)
      await fsExtra.writeFile(Path.join(subDir, '001.png'), Buffer.from('page'))
      // extractToBuffer removes the extracted file before calling removeEmptyParentDirs
      await fsExtra.remove(Path.join(subDir, '001.png'))

      // "../../sub/001.png" sanitizes to "sub/001.png"; only tmp/sub may be removed
      await extractor.removeEmptyParentDirs('../../sub/001.png')
      expect(await fsExtra.pathExists(subDir)).to.be.false
      expect(await fsExtra.pathExists(extractor.tmpDir)).to.be.true
      expect(await fsExtra.pathExists(tmpDir)).to.be.true
      extractor.close()
    })
  })
})
