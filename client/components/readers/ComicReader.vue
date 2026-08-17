<template>
  <div class="w-full h-full">
    <div v-show="showPageMenu" v-click-outside="clickOutside" class="pagemenu absolute top-9 left-4 sm:left-8 rounded-md overflow-y-auto bg-bg shadow-lg z-20 border border-gray-400" :style="{ width: pageMenuWidth + 'px' }">
      <div v-for="(file, index) in cleanedPageNames" :key="index" class="w-full cursor-pointer hover:bg-black-200 px-2 py-1" :class="page === index + 1 ? 'bg-black-200' : ''" @click="setPage(index + 1)">
        <p class="text-sm truncate">{{ index + 1 }}. {{ file }}</p>
      </div>
    </div>
    <div v-show="showInfoMenu" v-click-outside="clickOutside" class="pagemenu absolute top-9 left-16 sm:left-20 rounded-md overflow-y-auto bg-bg shadow-lg z-20 border border-gray-400 w-96">
      <div v-for="key in comicMetadataKeys" :key="key" class="w-full px-2 py-1">
        <p class="text-xs">
          <strong>{{ key }}</strong
          >: {{ comicMetadata[key] }}
        </p>
      </div>
    </div>
    <div v-show="showOptionsMenu" v-click-outside="clickOutside" class="pagemenu absolute top-9 left-28 sm:left-32 rounded-md overflow-y-auto bg-bg shadow-lg z-20 border border-gray-400 w-52">
      <p class="text-xs uppercase text-gray-400 px-3 pt-2 pb-1">Fit</p>
      <div v-for="opt in fitModeOptions" :key="opt.value" class="w-full cursor-pointer hover:bg-black-200 px-3 py-1" :class="fitMode === opt.value ? 'bg-black-200' : ''" @click="setFitMode(opt.value)">
        <p class="text-sm truncate">{{ opt.label }}</p>
      </div>
      <p class="text-xs uppercase text-gray-400 px-3 pt-2 pb-1">Background</p>
      <div v-for="opt in backgroundOptions" :key="opt.value" class="w-full cursor-pointer hover:bg-black-200 px-3 py-1" :class="background === opt.value ? 'bg-black-200' : ''" @click="setBackground(opt.value)">
        <p class="text-sm">{{ opt.label }}</p>
      </div>
      <p class="text-xs uppercase text-gray-400 px-3 pt-2 pb-1">Behavior</p>
      <div class="w-full cursor-pointer hover:bg-black-200 px-3 py-1" :class="scrollToTopOnPageChange ? 'bg-black-200' : ''" @click="toggleScrollToTopOnPageChange">
        <p class="text-sm">Scroll to top on page change</p>
      </div>
    </div>
    <div v-show="showFileMenu" v-click-outside="clickOutside" class="pagemenu absolute top-9 right-4 sm:right-8 rounded-md overflow-y-auto bg-bg shadow-lg z-20 border border-gray-400 w-72 sm:w-96">
      <div v-for="(file, index) in comicFiles" :key="file.ino" class="w-full cursor-pointer hover:bg-black-200 px-2 py-1" :class="index === currentFileIndex ? 'bg-black-200' : ''" @click="jumpToFile(index)">
        <p class="text-sm truncate">{{ index + 1 }}. {{ file.metadata.filename }}</p>
      </div>
    </div>

    <div class="absolute top-0 left-4 sm:left-8 z-20 flex items-center gap-2">
      <div v-if="numPages" class="bg-bg text-gray-100 border-b border-l border-r border-gray-400 hover:bg-black-200 cursor-pointer rounded-b-md px-3 h-9 flex items-center justify-center text-center" @mousedown.prevent @click.stop.prevent="clickShowPageMenu">
        <p class="font-mono text-xs sm:text-sm">{{ page }} / {{ numPages }}</p>
      </div>
      <div v-if="comicMetadata" class="bg-bg text-gray-100 border-b border-l border-r border-gray-400 hover:bg-black-200 cursor-pointer rounded-b-md w-10 h-9 flex items-center justify-center text-center" @mousedown.prevent @click.stop.prevent="clickShowInfoMenu">
        <span class="material-symbols text-xl">more</span>
      </div>
      <div v-if="numPages" class="bg-bg text-gray-100 border-b border-l border-r border-gray-400 hover:bg-black-200 cursor-pointer rounded-b-md w-10 h-9 flex items-center justify-center text-center" @mousedown.prevent @click.stop.prevent="clickShowOptionsMenu">
        <span class="material-symbols text-xl">tune</span>
      </div>
    </div>

    <div class="absolute top-0 right-14 sm:right-16 z-20 flex items-center gap-2">
      <div v-if="mainImg && fitMode === 'custom'" class="bg-bg text-gray-100 border-b border-l border-r border-gray-400 rounded-b-md px-2 h-9 flex items-center text-center">
        <ui-icon-btn icon="zoom_out" :size="8" :disabled="!canScaleDown" borderless class="mr-px" @click="zoomOut" />
        <span class="font-mono text-xs w-12 text-center">{{ scale }}%</span>
        <ui-icon-btn icon="zoom_in" :size="8" :disabled="!canScaleUp" borderless class="ml-px" @click="zoomIn" />
      </div>
      <div v-if="numPages && comicFiles.length > 1" class="bg-bg text-gray-100 border-b border-l border-r border-gray-400 hover:bg-black-200 cursor-pointer rounded-b-md px-3 h-9 flex items-center text-center" :title="currentFileTitle" @mousedown.prevent @click.stop.prevent="clickShowFileMenu">
        <p class="font-mono text-xs sm:text-sm">{{ currentFileIndex + 1 }} / {{ comicFiles.length }}</p>
      </div>
    </div>

    <div class="w-full h-full relative" :style="{ backgroundColor: backgroundColor }">
      <div v-show="canGoPrev" ref="prevButton" class="absolute top-0 left-0 h-full w-1/2 lg:w-1/3 hover:opacity-100 opacity-0 z-10 cursor-pointer" @click.stop.prevent="prev" @mousedown.prevent>
        <div class="flex items-center justify-center h-full w-1/2">
          <span v-show="loadedFirstPage" class="material-symbols text-5xl text-white/30 cursor-pointer hover:text-white/90">arrow_back_ios</span>
        </div>
      </div>
      <div v-show="canGoNext" ref="nextButton" class="absolute top-0 right-0 h-full w-1/2 lg:w-1/3 hover:opacity-100 opacity-0 z-10 cursor-pointer" @click.stop.prevent="next" @mousedown.prevent>
        <div class="flex items-center justify-center h-full w-1/2 ml-auto">
          <span v-show="loadedFirstPage" class="material-symbols text-5xl text-white/30 cursor-pointer hover:text-white/90">arrow_forward_ios</span>
        </div>
      </div>
      <div ref="imageContainer" class="w-full h-full relative overflow-auto">
        <div class="flex" :class="imageWrapperClass">
          <img v-if="mainImg" :style="imageStyle" :src="mainImg" class="object-contain m-auto" @load="handleImageLoad" />
        </div>
      </div>
      <div v-show="loading" class="w-full h-full absolute top-0 left-0 flex items-center justify-center z-10">
        <ui-loading-indicator />
      </div>
    </div>
  </div>
</template>

<script>
// This is % with respect to the screen width
const MAX_SCALE = 400
const MIN_SCALE = 10

export default {
  props: {
    libraryItem: {
      type: Object,
      default: () => {}
    },
    playerOpen: Boolean,
    keepProgress: Boolean,
    fileId: String
  },
  data() {
    return {
      loading: false,
      pages: [],
      mainImg: null,
      page: 0,
      numPages: 0,
      pageMenuWidth: 256,
      showPageMenu: false,
      showInfoMenu: false,
      showOptionsMenu: false,
      showFileMenu: false,
      loadTimeout: null,
      loadedFirstPage: false,
      comicMetadata: null,
      scale: 100,
      manifestRevision: null,
      pageImageUrls: Object.create(null),
      fitMode: 'fitScreen',
      background: 'black',
      scrollToTopOnPageChange: true,
      containerSize: { width: 0, height: 0 },
      imageNaturalSize: { width: 0, height: 0 },
      resizeObserver: null,
      // The file currently being read. Starts out resolved from the fileId prop / saved
      // progress, then moves as the user navigates to sibling comic files (see switchFile).
      currentFileIno: this.resolveInitialFileIno(),
      // 'start' | 'end' | null - which page to land on once the manifest for a file switch loads
      pendingLandOn: null
    }
  },
  watch: {
    manifestUrl: {
      immediate: true,
      handler(newUrl) {
        this.resetState()
        if (newUrl) {
          this.loadManifest()
        }
      }
    }
  },
  computed: {
    libraryItemId() {
      return this.libraryItem?.id
    },
    ebookBaseUrl() {
      if (!this.libraryItemId) return null
      const baseUrl = `/api/items/${this.libraryItemId}/ebook`
      return this.currentFileIno ? `${baseUrl}/${this.currentFileIno}` : baseUrl
    },
    manifestUrl() {
      return this.ebookBaseUrl ? `${this.ebookBaseUrl}/pages` : null
    },
    pageImageBaseUrl() {
      return this.ebookBaseUrl ? `${this.ebookBaseUrl}/pages` : null
    },
    comicMetadataKeys() {
      return this.comicMetadata ? Object.keys(this.comicMetadata) : []
    },
    // Sibling comic (cbz/cbr) files on this library item, in their configured order
    comicFiles() {
      return (this.libraryItem?.libraryFiles || []).filter((lf) => lf.fileType === 'ebook' && this.isComicFile(lf))
    },
    currentFileIndex() {
      return this.comicFiles.findIndex((lf) => this.sameIno(lf.ino, this.currentFileIno))
    },
    hasNextFile() {
      return this.currentFileIndex >= 0 && this.currentFileIndex < this.comicFiles.length - 1
    },
    hasPrevFile() {
      return this.currentFileIndex > 0
    },
    nextFile() {
      return this.hasNextFile ? this.comicFiles[this.currentFileIndex + 1] : null
    },
    prevFile() {
      return this.hasPrevFile ? this.comicFiles[this.currentFileIndex - 1] : null
    },
    currentFileTitle() {
      const file = this.comicFiles[this.currentFileIndex]
      return file?.metadata?.filename || null
    },
    canGoNext() {
      return this.page < this.numPages || this.hasNextFile
    },
    canGoPrev() {
      return this.page > 1 || this.hasPrevFile
    },
    userMediaProgress() {
      if (!this.libraryItemId) return
      return this.$store.getters['user/getUserMediaProgress'](this.libraryItemId)
    },
    // Whether userMediaProgress.ebookLocation belongs to the file currently being read.
    // Progress saved before per-file tracking existed has no ebookFileIno - trust it only
    // for the primary ebook file so older progress isn't silently lost.
    isSavedProgressForCurrentFile() {
      const savedIno = this.userMediaProgress?.ebookFileIno
      if (savedIno) return this.sameIno(savedIno, this.currentFileIno)
      return this.sameIno(this.currentFileIno, this.libraryItem?.media?.ebookFile?.ino)
    },
    savedPage() {
      if (!this.keepProgress) return 0
      if (!this.userMediaProgress?.ebookLocation || isNaN(this.userMediaProgress.ebookLocation)) return 0
      if (!this.isSavedProgressForCurrentFile) return 0
      return Number(this.userMediaProgress.ebookLocation)
    },
    cleanedPageNames() {
      return (
        this.pages?.map((page) => {
          const name = page.displayName || page.name || page.path || ''
          if (name.length > 50) {
            const firstHalf = name.slice(0, 22)
            const lastHalf = name.slice(name.length - 23)
            return `${firstHalf} ... ${lastHalf}`
          }
          return name
        }) || []
      )
    },
    canScaleUp() {
      return this.scale < MAX_SCALE
    },
    canScaleDown() {
      return this.scale > MIN_SCALE
    },
    fitModeOptions() {
      return [
        { value: 'fitWidth', label: 'Fit to width' },
        { value: 'fitScreen', label: 'Fit to screen' },
        { value: 'custom', label: 'Custom zoom' }
      ]
    },
    backgroundOptions() {
      return [
        { value: 'black', label: 'Black' },
        { value: 'dark', label: 'Dark gray' },
        { value: 'white', label: 'White' }
      ]
    },
    backgroundColor() {
      if (this.background === 'white') return '#ffffff'
      if (this.background === 'dark') return '#1a1a1a'
      return '#000000'
    },
    imageStyle() {
      const { width: cw, height: ch } = this.containerSize
      const { width: nw, height: nh } = this.imageNaturalSize
      if (this.fitMode === 'custom') {
        if (!cw) return {}
        return { width: Math.round((cw * this.scale) / 100) + 'px' }
      }
      if (!cw || !ch || !nw || !nh) return {}
      const factor = this.fitMode === 'fitScreen' ? Math.min(cw / nw, ch / nh) : cw / nw
      return { width: Math.round(nw * factor) + 'px' }
    },
    imageWrapperClass() {
      return 'min-w-full min-h-full flex items-center justify-center'
    }
  },
  methods: {
    resetState() {
      this.pages = []
      this.mainImg = null
      this.page = 0
      this.numPages = 0
      this.pageMenuWidth = 256
      this.showPageMenu = false
      this.showInfoMenu = false
      this.showOptionsMenu = false
      this.showFileMenu = false
      this.loadedFirstPage = false
      this.comicMetadata = null
      this.manifestRevision = null
      this.clearPageImageUrls()
      this.clearLoadTimeout()
      this.loading = false
    },
    async loadManifest() {
      if (!this.manifestUrl) return
      this.loading = true
      try {
        const manifest = await this.$axios.$get(this.manifestUrl, { progress: false })
        this.pages = manifest.pages || []
        this.numPages = manifest.pageCount || this.pages.length
        this.manifestRevision = manifest.revision || null
        this.comicMetadata = manifest.metadata || null
        this.calculatePageMenuWidth()

        if (this.numPages > 0) {
          this.loading = false
          let startPage
          if (this.pendingLandOn === 'end') {
            startPage = this.numPages
          } else if (this.pendingLandOn === 'start') {
            startPage = 1
          } else {
            startPage = this.savedPage > 0 && this.savedPage <= this.numPages ? this.savedPage : 1
          }
          this.setPage(startPage)
        } else {
          this.loading = false
          this.$toast.error('Unable to load pages from comic')
        }
      } catch (error) {
        console.error('ComicReader.loadManifest failed:', error)
        this.$toast.error('Failed to load comic pages')
        this.loading = false
      } finally {
        this.pendingLandOn = null
      }
    },
    calculatePageMenuWidth() {
      if (typeof document === 'undefined') return
      const largestFilename = this.cleanedPageNames.slice().sort((a, b) => a.length - b.length).pop()
      if (!largestFilename) return
      const pEl = document.createElement('p')
      pEl.innerText = largestFilename
      pEl.style.fontSize = '0.875rem'
      pEl.style.opacity = 0
      pEl.style.position = 'absolute'
      document.body.appendChild(pEl)
      const textWidth = pEl.getBoundingClientRect()?.width
      if (textWidth) {
        this.pageMenuWidth = textWidth + (16 + 5 + 2 + 5)
      }
      pEl.remove()
    },
    clickShowPageMenu() {
      this.showInfoMenu = false
      this.showOptionsMenu = false
      this.showFileMenu = false
      this.showPageMenu = !this.showPageMenu
    },
    clickShowInfoMenu() {
      this.showPageMenu = false
      this.showOptionsMenu = false
      this.showFileMenu = false
      this.showInfoMenu = !this.showInfoMenu
    },
    clickShowOptionsMenu() {
      this.showPageMenu = false
      this.showInfoMenu = false
      this.showFileMenu = false
      this.showOptionsMenu = !this.showOptionsMenu
    },
    clickShowFileMenu() {
      this.showPageMenu = false
      this.showInfoMenu = false
      this.showOptionsMenu = false
      this.showFileMenu = !this.showFileMenu
    },
    jumpToFile(index) {
      this.showFileMenu = false
      const file = this.comicFiles[index]
      if (!file || index === this.currentFileIndex) return
      this.switchFile(file.ino, 'start')
    },
    setFitMode(value) {
      this.fitMode = value
      this.showOptionsMenu = false
    },
    setBackground(value) {
      this.background = value
      this.showOptionsMenu = false
    },
    toggleScrollToTopOnPageChange() {
      this.scrollToTopOnPageChange = !this.scrollToTopOnPageChange
      this.showOptionsMenu = false
    },
    scrollToTop() {
      if (!this.scrollToTopOnPageChange) return
      const imageContainer = this.$refs.imageContainer
      if (imageContainer) {
        imageContainer.scrollTop = 0
        imageContainer.scrollLeft = 0
      }
    },
    updateProgress() {
      if (!this.keepProgress || !this.numPages || !this.libraryItemId) return
      if (this.savedPage === this.page) {
        return
      }
      const payload = {
        ebookLocation: this.page,
        ebookProgress: Math.max(0, Math.min(1, (Number(this.page) - 1) / Number(this.numPages))),
        ebookFileIno: this.currentFileIno
      }
      this.$axios.$patch(`/api/me/progress/${this.libraryItemId}`, payload, { progress: false }).catch((error) => {
        console.error('ComicReader.updateProgress failed:', error)
      })
    },
    clickOutside() {
      if (this.showPageMenu) this.showPageMenu = false
      if (this.showInfoMenu) this.showInfoMenu = false
      if (this.showOptionsMenu) this.showOptionsMenu = false
      if (this.showFileMenu) this.showFileMenu = false
    },
    next() {
      if (this.page < this.numPages) {
        this.setPage(this.page + 1)
      } else if (this.hasNextFile) {
        this.switchFile(this.nextFile.ino, 'start')
      }
    },
    prev() {
      if (this.page > 1) {
        this.setPage(this.page - 1)
      } else if (this.hasPrevFile) {
        this.switchFile(this.prevFile.ino, 'end')
      }
    },
    switchFile(ino, landOn) {
      this.showPageMenu = false
      this.showInfoMenu = false
      this.showFileMenu = false
      this.pendingLandOn = landOn
      this.currentFileIno = ino
    },
    isComicFile(libraryFile) {
      const ext = (libraryFile?.metadata?.ext || '').toLowerCase()
      return ext === '.cbz' || ext === '.cbr'
    },
    sameIno(a, b) {
      return a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b)
    },
    resolveInitialFileIno() {
      if (this.fileId) return this.fileId
      if (this.keepProgress) {
        const savedIno = this.$store.getters['user/getUserMediaProgress'](this.libraryItem?.id)?.ebookFileIno
        const isSiblingComicFile = (this.libraryItem?.libraryFiles || []).some((lf) => lf.fileType === 'ebook' && this.isComicFile(lf) && this.sameIno(lf.ino, savedIno))
        if (savedIno && isSiblingComicFile) return savedIno
      }
      return this.libraryItem?.media?.ebookFile?.ino ?? null
    },
    setPage(pageNumber) {
      if (pageNumber <= 0 || pageNumber > this.numPages) return
      const selectedPage = this.pages?.[pageNumber - 1]
      if (!selectedPage) return
      this.showPageMenu = false
      this.showInfoMenu = false
      this.showFileMenu = false
      this.page = pageNumber
      this.updateProgress()
      this.displayPage(pageNumber)
      this.preloadPage(pageNumber + 1)
    },
    displayPage(pageNumber) {
      this.scrollToTop()
      const cachedUrl = this.pageImageUrls[pageNumber]
      if (cachedUrl) {
        this.clearLoadTimeout()
        this.loading = false
        this.mainImg = cachedUrl
        return
      }
      this.setLoadTimeout()
      this.fetchPageImage(pageNumber)
    },
    buildPageImageUrl(pageNumber) {
      if (!this.pageImageBaseUrl) return null
      const versionQuery = this.manifestRevision ? `?v=${this.manifestRevision}` : ''
      return `${this.pageImageBaseUrl}/${pageNumber}${versionQuery}`
    },
    async fetchPageImage(pageNumber) {
      const url = this.buildPageImageUrl(pageNumber)
      if (!url) return
      try {
        // Fetch through $axios so the Bearer token (and 401 refresh) are applied
        const blob = await this.$axios.$get(url, { responseType: 'blob', progress: false })
        const objectUrl = URL.createObjectURL(blob)
        const previousUrl = this.pageImageUrls[pageNumber]
        if (previousUrl) URL.revokeObjectURL(previousUrl)
        this.pageImageUrls[pageNumber] = objectUrl
        // Page changed while loading - keep the image for later, don't display it
        if (this.page !== pageNumber) return
        this.mainImg = objectUrl
      } catch (error) {
        console.error(`ComicReader failed to load page ${pageNumber}:`, error)
        this.$toast.error('Failed to load page image')
      } finally {
        if (this.page === pageNumber) {
          this.clearLoadTimeout()
          this.loading = false
        }
      }
    },
    clearPageImageUrls() {
      Object.values(this.pageImageUrls).forEach((url) => URL.revokeObjectURL(url))
      this.pageImageUrls = Object.create(null)
    },
    setLoadTimeout() {
      this.clearLoadTimeout()
      this.loadTimeout = setTimeout(() => {
        this.loading = true
      }, 150)
    },
    clearLoadTimeout() {
      if (this.loadTimeout) {
        clearTimeout(this.loadTimeout)
        this.loadTimeout = null
      }
    },
    handleImageLoad(event) {
      this.clearLoadTimeout()
      this.loading = false
      this.loadedFirstPage = true
      const img = event?.target
      if (img && img.naturalWidth) {
        this.imageNaturalSize = { width: img.naturalWidth, height: img.naturalHeight }
      }
    },
    async preloadPage(pageNumber) {
      if (!this.pageImageBaseUrl || pageNumber <= 0 || pageNumber > this.numPages) return
      if (this.pageImageUrls[pageNumber]) return
      const url = this.buildPageImageUrl(pageNumber)
      if (!url) return
      try {
        const blob = await this.$axios.$get(url, { responseType: 'blob', progress: false })
        if (this.pageImageUrls[pageNumber]) return
        this.pageImageUrls[pageNumber] = URL.createObjectURL(blob)
      } catch (error) {
        console.error(`ComicReader failed to preload page ${pageNumber}:`, error)
      }
    },
    zoomIn() {
      this.scale += 10
    },
    zoomOut() {
      this.scale -= 10
    },
    scroll(event) {
      const imageContainer = this.$refs.imageContainer
      imageContainer.scrollBy({
        top: event.deltaY,
        left: event.deltaX,
        behavior: 'auto'
      })
    },
    wheelZoom(event) {
      // In custom zoom mode the wheel adjusts the zoom; otherwise it scrolls the container
      if (this.fitMode !== 'custom' || !this.mainImg) return
      event.preventDefault()
      const delta = event.deltaY < 0 ? 10 : -10
      this.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, this.scale + delta))
    }
  },
  mounted() {
    const prevButton = this.$refs.prevButton
    const nextButton = this.$refs.nextButton
    if (prevButton) prevButton.addEventListener('wheel', this.scroll, { passive: false })
    if (nextButton) nextButton.addEventListener('wheel', this.scroll, { passive: false })

    const imageContainer = this.$refs.imageContainer
    if (imageContainer) {
      const updateSize = () => {
        const rect = imageContainer.getBoundingClientRect()
        this.containerSize = { width: rect.width, height: rect.height }
      }
      updateSize()
      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(updateSize)
        this.resizeObserver.observe(imageContainer)
      } else {
        window.addEventListener('resize', updateSize)
        this.resizeObserver = { disconnect: () => window.removeEventListener('resize', updateSize) }
      }
      imageContainer.addEventListener('wheel', this.wheelZoom, { passive: false })
    }
  },
  beforeDestroy() {
    const prevButton = this.$refs.prevButton
    const nextButton = this.$refs.nextButton
    if (prevButton) prevButton.removeEventListener('wheel', this.scroll, { passive: false })
    if (nextButton) nextButton.removeEventListener('wheel', this.scroll, { passive: false })
    const imageContainer = this.$refs.imageContainer
    if (imageContainer) imageContainer.removeEventListener('wheel', this.wheelZoom, { passive: false })
    if (this.resizeObserver) this.resizeObserver.disconnect()
    this.clearPageImageUrls()
  }
}
</script>

<style scoped>
.pagemenu {
  max-height: calc(100% - 48px);
}
</style>
