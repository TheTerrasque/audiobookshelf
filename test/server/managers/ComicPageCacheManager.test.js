const { expect } = require('chai')
const os = require('os')
const Path = require('path')
const fsExtra = require('../../../server/libs/fsExtra')
const archiver = require('../../../server/libs/archiver')
const ComicPageCacheManager = require('../../../server/managers/ComicPageCacheManager')

// 1x1 transparent PNG
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==', 'base64')

const COMIC_INFO_XML = `<?xml version="1.0" encoding="utf-8"?>
<ComicInfo xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <Title>Test Issue</Title>
  <Series>Test Series</Series>
  <Number>3</Number>
  <Summary>A test comic summary</Summary>
</ComicInfo>`

/**
 * Create a CBZ (zip) file at filePath with the given { name: Buffer } entries
 */
const createCbz = (filePath, files) => {
  return new Promise((resolve, reject) => {
    const output = fsExtra.createWriteStream(filePath)
    const archive = archiver('zip', { zlib: { level: 0 } })
    output.on('close', () => resolve())
    archive.on('error', (error) => reject(error))
    archive.pipe(output)
    for (const [name, data] of Object.entries(files)) {
      archive.append(data, { name })
    }
    archive.finalize()
  })
}

describe('ComicPageCacheManager', () => {
  let tmpDir
  let cbzPath

  beforeEach(async () => {
    ComicPageCacheManager.clear()
    tmpDir = await fsExtra.mkdtemp(Path.join(os.tmpdir(), 'abs-comic-test-'))
    cbzPath = Path.join(tmpDir, 'test.cbz')
  })

  afterEach(async () => {
    ComicPageCacheManager.clear()
    await fsExtra.remove(tmpDir)
  })

  describe('getManifest', () => {
    it('should return pages sorted numerically with mime types', async () => {
      await createCbz(cbzPath, {
        '10.png': PNG_1x1,
        '02.png': PNG_1x1,
        '01.png': PNG_1x1,
        'ComicInfo.xml': Buffer.from(COMIC_INFO_XML)
      })

      const manifest = await ComicPageCacheManager.getManifest(cbzPath)

      expect(manifest.pageCount).to.equal(3)
      expect(manifest.pages.map((p) => p.name)).to.deep.equal(['01.png', '02.png', '10.png'])
      expect(manifest.pages.map((p) => p.index)).to.deep.equal([1, 2, 3])
      expect(manifest.pages.every((p) => p.mime === 'image/png')).to.be.true
      expect(manifest.revision).to.be.a('string')
    })

    it('should parse ComicInfo.xml into flat metadata', async () => {
      await createCbz(cbzPath, {
        '01.png': PNG_1x1,
        'ComicInfo.xml': Buffer.from(COMIC_INFO_XML)
      })

      const manifest = await ComicPageCacheManager.getManifest(cbzPath)

      // parseComicInfoMetadata builds the title from Series + Number
      expect(manifest.metadata).to.deep.equal({
        Title: 'Test Series 3',
        Series: 'Test Series',
        Issue: '3',
        Description: 'A test comic summary'
      })
    })

    it('should return null metadata when no ComicInfo.xml is present', async () => {
      await createCbz(cbzPath, {
        '01.png': PNG_1x1
      })

      const manifest = await ComicPageCacheManager.getManifest(cbzPath)

      expect(manifest.metadata).to.be.null
    })

    it('should cache the manifest and rebuild when the file changes', async () => {
      await createCbz(cbzPath, {
        '01.png': PNG_1x1
      })
      const first = await ComicPageCacheManager.getManifest(cbzPath)
      const cached = await ComicPageCacheManager.getManifest(cbzPath)
      expect(cached).to.equal(first)

      // Rebuild the file with an extra page
      await createCbz(cbzPath, {
        '01.png': PNG_1x1,
        '02.png': PNG_1x1
      })
      const rebuilt = await ComicPageCacheManager.getManifest(cbzPath)
      expect(rebuilt).to.not.equal(first)
      expect(rebuilt.pageCount).to.equal(2)
      expect(rebuilt.revision).to.not.equal(first.revision)
    })
  })

  describe('getPageImage', () => {
    it('should return the page image buffer and cache it', async () => {
      await createCbz(cbzPath, {
        '01.png': PNG_1x1,
        '02.png': PNG_1x1
      })

      const manifest = await ComicPageCacheManager.getManifest(cbzPath)
      const buffer = await ComicPageCacheManager.getPageImage(cbzPath, manifest.pages[0].path, manifest.pages[0].extension, manifest.revision)

      expect(buffer).to.be.an.instanceof(Buffer)
      expect(buffer.equals(PNG_1x1)).to.be.true

      // Second call should be served from the page cache (same buffer instance)
      const cached = await ComicPageCacheManager.getPageImage(cbzPath, manifest.pages[0].path, manifest.pages[0].extension, manifest.revision)
      expect(cached).to.equal(buffer)
    })

    it('should throw for a missing page path', async () => {
      await createCbz(cbzPath, {
        '01.png': PNG_1x1
      })

      const manifest = await ComicPageCacheManager.getManifest(cbzPath)
      let rejected = false
      try {
        await ComicPageCacheManager.getPageImage(cbzPath, 'does-not-exist.png', 'png', manifest.revision)
      } catch (error) {
        rejected = true
      }
      expect(rejected).to.be.true
    })
  })
})
