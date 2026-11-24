<template>
  <div v-if="audioVersions.length" class="w-full my-2">
    <div class="w-full bg-primary px-4 md:px-6 py-2 flex items-center cursor-pointer" @click.stop="showVersions = !showVersions">
      <p class="pr-2 md:pr-4">{{ $strings.HeaderVersions }}</p>
      <div class="h-5 md:h-7 w-5 md:w-7 rounded-full bg-white/10 flex items-center justify-center">
        <span class="text-sm font-mono">{{ audioVersions.length + 1 }}</span>
      </div>
      <p v-if="selectedVersion" class="text-sm text-gray-300 pl-4 truncate">{{ $strings.LabelVersionInUse }}: {{ selectedVersion.label }}</p>
      <div class="grow" />
      <div class="cursor-pointer h-10 w-10 rounded-full hover:bg-black-400 flex justify-center items-center duration-500" :class="showVersions ? 'transform rotate-180' : ''">
        <span class="material-symbols text-4xl">&#xe313;</span>
      </div>
    </div>
    <transition name="slide">
      <div class="w-full" v-show="showVersions">
        <p class="text-xs text-gray-300 px-4 py-2">{{ $strings.MessageVersionsInfo }}</p>
        <table class="text-sm tracksTable">
          <tr>
            <th class="text-left px-4">{{ $strings.LabelName }}</th>
            <th class="text-left w-24 min-w-24 hidden md:table-cell">{{ $strings.LabelDuration }}</th>
            <th class="text-left w-24 min-w-24">{{ $strings.LabelSize }}</th>
            <th class="text-left w-36 hidden md:table-cell">{{ $strings.LabelCreatedAt }}</th>
            <th class="text-center w-24"></th>
            <th v-if="userIsAdmin" class="text-center w-24"></th>
          </tr>
          <tr>
            <td class="px-4">{{ $strings.LabelVersionOriginal }}</td>
            <td class="hidden md:table-cell">{{ $elapsedPretty(originalDuration) }}</td>
            <td>{{ $bytesPretty(originalSize) }}</td>
            <td class="hidden md:table-cell"></td>
            <td class="text-center">
              <span v-if="!selectedVersionId" class="text-success text-xs">{{ $strings.LabelVersionInUse }}</span>
              <ui-btn v-else small :loading="processingId === 'original'" @click.stop="selectVersion(null)">{{ $strings.ButtonUseVersion }}</ui-btn>
            </td>
            <td v-if="userIsAdmin"></td>
          </tr>
          <tr v-for="version in audioVersions" :key="version.id">
            <td class="px-4">
              <p class="truncate">{{ version.label }}</p>
              <p class="text-xs text-gray-400">{{ toolLabel(version.tool) }}<span v-if="version.numFiles > 1"> · {{ version.numFiles }} files</span><span v-if="processingSummary(version)"> · {{ processingSummary(version) }}</span></p>
            </td>
            <td class="hidden md:table-cell">{{ $elapsedPretty(version.duration) }}</td>
            <td>{{ $bytesPretty(version.size) }}</td>
            <td class="hidden md:table-cell">{{ $formatJsDatetime(new Date(version.createdAt), dateFormat, timeFormat) }}</td>
            <td class="text-center">
              <span v-if="selectedVersionId === version.id" class="text-success text-xs">{{ $strings.LabelVersionInUse }}</span>
              <ui-btn v-else small :loading="processingId === version.id" @click.stop="selectVersion(version.id)">{{ $strings.ButtonUseVersion }}</ui-btn>
            </td>
            <td v-if="userIsAdmin" class="text-center whitespace-nowrap">
              <ui-icon-btn icon="edit" :size="7" borderless :aria-label="$strings.ButtonRenameVersion" class="inline-flex" @click.stop="renameVersion(version)" />
              <ui-icon-btn icon="delete" :size="7" borderless bg-color="bg-error" :aria-label="$strings.ButtonDelete" class="inline-flex" @click.stop="deleteVersion(version)" />
            </td>
          </tr>
        </table>
      </div>
    </transition>
  </div>
</template>

<script>
/**
 * Fork: file versions (e.g. m4b re-encodes) stored outside the library folder.
 * Each user picks which version they play; the server then hands out that version's files.
 */
export default {
  props: {
    libraryItem: {
      type: Object,
      default: () => {}
    }
  },
  data() {
    return {
      showVersions: false,
      versions: [],
      selectedVersionId: null,
      processingId: null,
      versionsOriginalDuration: 0
    }
  },
  computed: {
    libraryItemId() {
      return this.libraryItem?.id
    },
    userIsAdmin() {
      return this.$store.getters['user/getIsAdminOrUp']
    },
    dateFormat() {
      return this.$store.state.serverSettings.dateFormat
    },
    timeFormat() {
      return this.$store.state.serverSettings.timeFormat
    },
    audioVersions() {
      return this.versions.filter((v) => v.kind === 'audio')
    },
    selectedVersion() {
      return this.audioVersions.find((v) => v.id === this.selectedVersionId) || null
    },
    originalAudioFiles() {
      // When a version is in use the item's audioFiles are the version's, so use the library files
      return (this.libraryItem?.libraryFiles || []).filter((lf) => lf.fileType === 'audio')
    },
    originalSize() {
      return this.originalAudioFiles.reduce((sum, lf) => sum + (lf.metadata?.size || 0), 0)
    },
    originalDuration() {
      if (!this.selectedVersionId) return this.libraryItem?.media?.duration || 0
      return this.versionsOriginalDuration || 0
    }
  },
  methods: {
    processingSummary(version) {
      const o = version.options || {}
      const parts = []
      if (o.speed && o.speed !== 1) parts.push(`${o.speed}×`)
      if (o.normalize) parts.push(`${this.$strings.LabelNormalizeVolume} ${o.normalize.target} LUFS`)
      if (o.compress) parts.push(`${this.$strings.LabelDynamicRangeCompression}: ${o.compress}`)
      if (o.voiceEq) parts.push(this.$strings.LabelVoiceClarity)
      if (o.denoise) parts.push(`${this.$strings.LabelNoiseReduction}: ${o.denoise}`)
      if (o.parts) parts.push(this.$getString('LabelPartsCount', [o.parts]))
      return parts.join(' · ')
    },
    toolLabel(tool) {
      if (tool === 'encode-m4b') return this.$strings.LabelVersionToolEncodeM4b
      if (tool === 'embed-metadata') return this.$strings.LabelVersionToolEmbedMetadata
      return tool || ''
    },
    async fetchVersions() {
      if (!this.libraryItemId) return
      const data = await this.$axios.$get(`/api/items/${this.libraryItemId}/versions`).catch((error) => {
        console.error('Failed to fetch versions', error)
        return null
      })
      if (!data) return
      this.versions = data.versions || []
      this.selectedVersionId = data.selected?.audio || null
      this.versionsOriginalDuration = data.originalDuration
    },
    async selectVersion(versionId) {
      this.processingId = versionId || 'original'
      try {
        const data = await this.$axios.$patch(`/api/me/item/${this.libraryItemId}/version`, { kind: 'audio', versionId })
        this.selectedVersionId = data?.selected?.audio || null
        this.$emit('changed')
      } catch (error) {
        console.error('Failed to select version', error)
        this.$toast.error(this.$strings.ToastVersionSelectFailed)
      } finally {
        this.processingId = null
      }
    },
    async renameVersion(version) {
      const label = window.prompt(this.$strings.ButtonRenameVersion, version.label)
      if (!label || !label.trim() || label.trim() === version.label) return
      try {
        await this.$axios.$patch(`/api/items/${this.libraryItemId}/versions/${version.id}`, { label: label.trim() })
        await this.fetchVersions()
      } catch (error) {
        console.error('Failed to rename version', error)
        this.$toast.error(this.$strings.ToastVersionRenameFailed)
      }
    },
    deleteVersion(version) {
      const payload = {
        message: this.$getString('MessageConfirmDeleteVersion', [version.label]),
        callback: async (confirmed) => {
          if (!confirmed) return
          this.processingId = version.id
          try {
            const wasSelected = this.selectedVersionId === version.id
            await this.$axios.$delete(`/api/items/${this.libraryItemId}/versions/${version.id}`)
            await this.fetchVersions()
            if (wasSelected) this.$emit('changed')
          } catch (error) {
            console.error('Failed to delete version', error)
            this.$toast.error(this.$strings.ToastVersionDeleteFailed)
          } finally {
            this.processingId = null
          }
        },
        type: 'yesNo'
      }
      this.$store.commit('globals/setConfirmPrompt', payload)
    },
    itemVersionsUpdated(data) {
      if (data?.libraryItemId === this.libraryItemId) this.fetchVersions()
    }
  },
  watch: {
    libraryItemId() {
      this.fetchVersions()
    }
  },
  mounted() {
    this.fetchVersions()
    this.$root.socket?.on('item_versions_updated', this.itemVersionsUpdated)
  },
  beforeDestroy() {
    this.$root.socket?.off('item_versions_updated', this.itemVersionsUpdated)
  }
}
</script>
