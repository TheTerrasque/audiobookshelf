<template>
  <div class="w-full my-2">
    <div class="w-full bg-primary px-4 md:px-6 py-2 flex items-center cursor-pointer" @click.stop="clickBar">
      <p class="pr-2 md:pr-4">{{ $strings.HeaderEbookFiles }}</p>
      <div class="h-5 md:h-7 w-5 md:w-7 rounded-full bg-white/10 flex items-center justify-center">
        <span class="text-sm font-mono">{{ ebookFiles.length }}</span>
      </div>
      <div class="grow" />
      <ui-btn v-if="canReorder && !reordering" small color="bg-primary" class="mr-2 hidden md:block" @click.stop="startReorder">{{ $strings.ButtonReorder }}</ui-btn>
      <ui-btn v-if="userIsAdmin" small :color="showFullPath ? 'bg-gray-600' : 'bg-primary'" class="mr-2 hidden md:block" @click.stop="toggleFullPath">{{ $strings.ButtonFullPath }}</ui-btn>
      <div class="cursor-pointer h-10 w-10 rounded-full hover:bg-black-400 flex justify-center items-center duration-500" :class="showFiles ? 'transform rotate-180' : ''">
        <span class="material-symbols text-4xl">&#xe313;</span>
      </div>
    </div>
    <transition name="slide">
      <div class="w-full" v-show="showFiles">
        <div v-if="reordering" class="w-full px-4 py-2 flex items-center bg-primary/40 text-sm">
          <p class="grow">{{ $strings.MessageDragFilesIntoEbookOrder }}</p>
          <ui-btn small color="bg-primary" class="mr-2" :disabled="!selectedInos.length" @click.stop="moveSelectedToTop">{{ $strings.ButtonMoveToTop }}</ui-btn>
          <ui-btn small color="bg-primary" class="mr-2" :disabled="!selectedInos.length" @click.stop="moveSelectedToBottom">{{ $strings.ButtonMoveToBottom }}</ui-btn>
          <ui-btn small color="bg-primary" class="mr-2" :disabled="savingOrder" @click.stop="cancelReorder">{{ $strings.ButtonCancel }}</ui-btn>
          <ui-btn small color="bg-success" :loading="savingOrder" @click.stop="saveOrder">{{ $strings.ButtonSaveOrder }}</ui-btn>
        </div>
        <table v-if="!reordering" class="text-sm tracksTable">
          <tr>
            <th class="text-left px-4">{{ $strings.LabelPath }}</th>
            <th class="text-left w-24 min-w-24">{{ $strings.LabelSize }}</th>
            <th class="text-left px-4 w-24">
              {{ $strings.LabelRead }} <ui-tooltip :text="$strings.LabelReadEbookWithoutProgress" direction="top" class="inline-block"><span class="material-symbols text-sm align-middle">info</span></ui-tooltip>
            </th>
            <th v-if="showMoreColumn" class="text-center w-16"></th>
          </tr>
          <template v-for="file in ebookFiles">
            <tables-ebook-files-table-row :key="file.path" :libraryItemId="libraryItemId" :showFullPath="showFullPath" :file="file" @read="readEbook" />
          </template>
        </table>
        <table v-else class="text-sm tracksTable">
          <tr>
            <th class="w-10"></th>
            <th class="w-10 text-center"><input type="checkbox" :checked="allSelected" @change="toggleSelectAll" /></th>
            <th class="text-left px-4">{{ $strings.LabelPath }}</th>
          </tr>
          <draggable v-model="reorderFiles" v-bind="dragOptions" tag="tbody">
            <tr v-for="file in reorderFiles" :key="file.ino" class="list-group-item">
              <td class="text-center w-10"><span class="material-symbols drag-handle align-middle text-lg text-gray-400 hover:text-gray-50">reorder</span></td>
              <td class="text-center w-10"><input type="checkbox" :checked="selectedInos.includes(file.ino)" @change="toggleSelected(file.ino)" @click.stop /></td>
              <td class="px-4 truncate">{{ showFullPath ? file.metadata.path : file.metadata.relPath }}</td>
            </tr>
          </draggable>
        </table>
      </div>
    </transition>
  </div>
</template>

<script>
import draggable from 'vuedraggable'

export default {
  components: {
    draggable
  },
  props: {
    libraryItem: {
      type: Object,
      default: () => {}
    }
  },
  data() {
    return {
      showFiles: false,
      showFullPath: false,
      reordering: false,
      savingOrder: false,
      reorderFiles: [],
      selectedInos: [],
      dragOptions: {
        animation: 200,
        ghostClass: 'ghost',
        handle: '.drag-handle'
      }
    }
  },
  computed: {
    libraryItemId() {
      return this.libraryItem.id
    },
    userCanDownload() {
      return this.$store.getters['user/getUserCanDownload']
    },
    userCanDelete() {
      return this.$store.getters['user/getUserCanDelete']
    },
    userCanUpdate() {
      return this.$store.getters['user/getUserCanUpdate']
    },
    userIsAdmin() {
      return this.$store.getters['user/getIsAdminOrUp']
    },
    libraryIsAudiobooksOnly() {
      return this.$store.getters['libraries/getLibraryIsAudiobooksOnly']
    },
    showMoreColumn() {
      return this.userCanDelete || this.userCanDownload || (this.userCanUpdate && !this.libraryIsAudiobooksOnly)
    },
    canReorder() {
      return this.userCanUpdate && !this.libraryIsAudiobooksOnly && this.ebookFiles.length > 1
    },
    ebookFiles() {
      return (this.libraryItem.libraryFiles || []).filter((lf) => lf.fileType === 'ebook')
    },
    allSelected() {
      return !!this.reorderFiles.length && this.selectedInos.length === this.reorderFiles.length
    }
  },
  methods: {
    toggleFullPath() {
      this.showFullPath = !this.showFullPath
      localStorage.setItem('showFullPath', this.showFullPath ? 1 : 0)
    },
    readEbook(fileIno) {
      this.$store.commit('showEReader', { libraryItem: this.libraryItem, keepProgress: false, fileId: fileIno })
    },
    clickBar() {
      this.showFiles = !this.showFiles
    },
    startReorder() {
      this.reorderFiles = this.ebookFiles.slice()
      this.selectedInos = []
      this.reordering = true
      this.showFiles = true
    },
    cancelReorder() {
      this.reordering = false
      this.reorderFiles = []
      this.selectedInos = []
    },
    toggleSelected(ino) {
      if (this.selectedInos.includes(ino)) {
        this.selectedInos = this.selectedInos.filter((i) => i !== ino)
      } else {
        this.selectedInos = [...this.selectedInos, ino]
      }
    },
    toggleSelectAll() {
      this.selectedInos = this.allSelected ? [] : this.reorderFiles.map((file) => file.ino)
    },
    moveSelectedToTop() {
      const selected = this.reorderFiles.filter((file) => this.selectedInos.includes(file.ino))
      const rest = this.reorderFiles.filter((file) => !this.selectedInos.includes(file.ino))
      this.reorderFiles = [...selected, ...rest]
    },
    moveSelectedToBottom() {
      const selected = this.reorderFiles.filter((file) => this.selectedInos.includes(file.ino))
      const rest = this.reorderFiles.filter((file) => !this.selectedInos.includes(file.ino))
      this.reorderFiles = [...rest, ...selected]
    },
    saveOrder() {
      const orderedFileData = this.reorderFiles.map((file) => ({ ino: file.ino }))
      this.savingOrder = true
      this.$axios
        .$patch(`/api/items/${this.libraryItemId}/ebook`, { orderedFileData })
        .then(() => {
          this.$toast.success('Ebook order updated')
          this.reordering = false
          this.reorderFiles = []
          this.selectedInos = []
        })
        .catch((error) => {
          console.error('Failed to update ebook order', error)
          this.$toast.error('Failed to update ebook order')
        })
        .finally(() => {
          this.savingOrder = false
        })
    }
  },
  mounted() {
    if (this.userIsAdmin) {
      this.showFullPath = !!Number(localStorage.getItem('showFullPath') || 0)
    }
  }
}
</script>
