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

  describe('concurrency', () => {
    const comicBookExtractors = require('../../../server/utils/comicBookExtractors')

    /**
     * Wrap createComicBookExtractor so tests can count opens/closes and delay extraction
     */
    const instrumentExtractors = (sinon, { extractDelayMs = 0 } = {}) => {
      const stats = { opens: 0, closes: 0, closedWhileExtracting: 0 }
      const original = comicBookExtractors.createComicBookExtractor
      sinon.stub(comicBookExtractors, 'createComicBookExtractor').callsFake((path) => {
        const extractor = original(path)
        let extracting = 0
        let closed = false
        const origOpen = extractor.open.bind(extractor)
        const origExtract = extractor.extractToBuffer.bind(extractor)
        const origClose = extractor.close.bind(extractor)
        extractor.open = async () => {
          stats.opens++
          await new Promise((resolve) => setTimeout(resolve, 5))
          return origOpen()
        }
        extractor.extractToBuffer = async (file) => {
          extracting++
          try {
            await new Promise((resolve) => setTimeout(resolve, extractDelayMs))
            if (closed) throw new Error('extractor closed during extraction')
            return await origExtract(file)
          } finally {
            extracting--
          }
        }
        extractor.close = () => {
          stats.closes++
          if (extracting > 0) stats.closedWhileExtracting++
          closed = true
          return origClose()
        }
        return extractor
      })
      return stats
    }

    let sinon
    beforeEach(() => {
      sinon = require('sinon').createSandbox()
    })
    afterEach(() => {
      sinon.restore()
    })

    // ComicPageCacheManager captured createComicBookExtractor at require time, so load a fresh
    // instance after stubbing
    const freshManager = () => {
      const modulePath = require.resolve('../../../server/managers/ComicPageCacheManager')
      delete require.cache[modulePath]
      const manager = require(modulePath)
      delete require.cache[modulePath]
      return manager
    }

    it('should open the archive only once for concurrent requests', async () => {
      await createCbz(cbzPath, { '01.png': PNG_1x1, '02.png': PNG_1x1 })
      const stats = instrumentExtractors(sinon)
      const manager = freshManager()

      const [m1, m2] = await Promise.all([manager.getManifest(cbzPath), manager.getManifest(cbzPath)])
      expect(m1).to.equal(m2)
      const buffers = await Promise.all([1, 2, 1, 2].map((p) => manager.getPageImage(cbzPath, m1.pages[p - 1].path, 'png', m1.revision)))
      expect(buffers.every((b) => b.equals(PNG_1x1))).to.be.true
      expect(stats.opens).to.equal(1)
      manager.clear()
    })

    it('should not close an extractor evicted from the pool while it is still extracting', async () => {
      const otherCbzPath = Path.join(tmpDir, 'other.cbz')
      await createCbz(cbzPath, { '01.png': PNG_1x1 })
      await createCbz(otherCbzPath, { '01.png': PNG_1x1 })
      process.env.COMIC_EXTRACTOR_POOL_MAX = '1'
      let manager
      try {
        const stats = instrumentExtractors(sinon, { extractDelayMs: 30 })
        manager = freshManager()
        const manifest = await manager.getManifest(cbzPath)
        const otherManifest = await manager.getManifest(otherCbzPath)
        manager.pageCache.clear()

        // Start a slow page extraction on the first file, then evict its extractor by using the second file
        const slowPage = manager.getPageImage(cbzPath, manifest.pages[0].path, 'png', manifest.revision)
        await new Promise((resolve) => setTimeout(resolve, 10))
        await manager.getPageImage(otherCbzPath, otherManifest.pages[0].path, 'png', otherManifest.revision)

        expect((await slowPage).equals(PNG_1x1)).to.be.true
        expect(stats.closedWhileExtracting).to.equal(0)
        expect(stats.closes).to.be.greaterThan(0)
      } finally {
        delete process.env.COMIC_EXTRACTOR_POOL_MAX
        manager?.clear()
      }
    })

    it('evictPath should drop the manifest, cached pages and extractors for a file', async () => {
      await createCbz(cbzPath, { '01.png': PNG_1x1 })
      const manager = freshManager()
      const manifest = await manager.getManifest(cbzPath)
      await manager.getPageImage(cbzPath, manifest.pages[0].path, 'png', manifest.revision)
      expect(manager.manifestCache.size).to.equal(1)
      expect(manager.pageCache.size).to.equal(1)
      expect(manager.extractorPool.size).to.equal(1)

      manager.evictPath(cbzPath)

      expect(manager.manifestCache.size).to.equal(0)
      expect(manager.pageCache.size).to.equal(0)
      expect(manager.extractorPool.size).to.equal(0)
    })
  })
})
