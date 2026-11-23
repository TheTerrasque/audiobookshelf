<template>
  <modals-modal ref="modal" v-model="show" name="quick-connect" :width="480" :height="'unset'">
    <template #outer>
      <div class="absolute top-0 left-0 p-5 w-2/3 overflow-hidden">
        <p class="text-3xl text-white truncate">{{ $strings.HeaderConnectMobileApp }}</p>
      </div>
    </template>
    <div class="px-4 w-full text-sm py-6 rounded-lg bg-bg shadow-lg border border-black-300 overflow-y-auto overflow-x-hidden" style="max-height: 80vh">
      <div class="w-full px-2 sm:px-4">
        <p class="text-base text-gray-200 mb-4">{{ $strings.MessageQuickConnectHelp }}</p>

        <div class="flex justify-center mb-4">
          <div class="bg-white p-2 rounded-md">
            <img v-if="qrDataUrl" :src="qrDataUrl" :alt="$strings.HeaderConnectMobileApp" class="block" style="width: 240px; height: 240px" />
            <div v-else style="width: 240px; height: 240px" />
          </div>
        </div>

        <ui-text-input-with-label v-model="address" :label="$strings.LabelQuickConnectAddress" class="mb-2" @input="addressChanged" />
        <p v-if="addressError" class="text-error text-xs px-1 mb-2">{{ addressError }}</p>
        <p v-else-if="isLocalOnlyAddress" class="text-warning text-xs px-1 mb-2">{{ $strings.MessageQuickConnectLocalhostWarning }}</p>

        <div class="flex items-center mt-4">
          <ui-btn small @click="resetAddress">{{ $strings.ButtonReset }}</ui-btn>
          <div class="grow" />
          <ui-btn color="bg-primary" @click="show = false">{{ $strings.ButtonClose }}</ui-btn>
        </div>
      </div>
    </div>
  </modals-modal>
</template>

<script>
import QRCode from 'qrcode'

const ADDRESS_STORAGE_KEY = 'quickConnectAddress'

export default {
  props: {
    value: Boolean
  },
  data() {
    return {
      address: '',
      qrDataUrl: null,
      addressError: null
    }
  },
  watch: {
    show(newVal) {
      if (newVal) this.init()
    }
  },
  computed: {
    show: {
      get() {
        return this.value
      },
      set(val) {
        this.$emit('input', val)
      }
    },
    username() {
      return this.$store.state.user.user?.username || ''
    },
    defaultAddress() {
      // The server accepts requests with or without the router base path, so the plain origin
      // works for the default base path. A custom base path may be how a reverse proxy routes
      // to this server, so keep it in that case.
      const basePath = this.$config.routerBasePath || ''
      if (!basePath || basePath === '/audiobookshelf') return window.location.origin
      return window.location.origin + basePath
    },
    normalizedAddress() {
      try {
        const url = new URL(this.address.trim())
        if (!['http:', 'https:'].includes(url.protocol)) return null
        return url.href.replace(/\/+$/, '')
      } catch {
        return null
      }
    },
    isLocalOnlyAddress() {
      if (!this.normalizedAddress) return false
      const hostname = new URL(this.normalizedAddress).hostname
      return hostname === 'localhost' || hostname === '[::1]' || hostname.startsWith('127.')
    },
    quickConnectLink() {
      if (!this.normalizedAddress) return null
      const params = new URLSearchParams()
      params.set('address', this.normalizedAddress)
      if (this.username) params.set('username', this.username)
      return `audiobookshelf://connect?${params.toString()}`
    }
  },
  methods: {
    init() {
      let saved = null
      try {
        saved = localStorage.getItem(ADDRESS_STORAGE_KEY)
      } catch {}
      this.address = saved || this.defaultAddress
      this.renderQr()
    },
    addressChanged() {
      try {
        if (this.address && this.address.trim() !== this.defaultAddress) localStorage.setItem(ADDRESS_STORAGE_KEY, this.address.trim())
        else localStorage.removeItem(ADDRESS_STORAGE_KEY)
      } catch {}
      this.renderQr()
    },
    resetAddress() {
      this.address = this.defaultAddress
      this.addressChanged()
    },
    async renderQr() {
      const link = this.quickConnectLink
      if (!link) {
        this.addressError = this.$strings.MessageQuickConnectInvalidAddress
        this.qrDataUrl = null
        return
      }
      this.addressError = null
      try {
        const dataUrl = await QRCode.toDataURL(link, { margin: 1, width: 480, errorCorrectionLevel: 'M' })
        // Ignore stale renders if the address changed while this one was generating
        if (link === this.quickConnectLink) this.qrDataUrl = dataUrl
      } catch (error) {
        console.error('[QuickConnectModal] Failed to generate QR code', error)
        this.qrDataUrl = null
      }
    }
  },
  mounted() {
    if (this.show) this.init()
  }
}
</script>
