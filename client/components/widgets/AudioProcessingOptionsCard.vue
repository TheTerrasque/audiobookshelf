<template>
  <div class="w-full py-2">
    <div class="px-4 py-2 border border-black-200 rounded-t-md bg-primary/70">
      <p class="text-sm">{{ $strings.HeaderAudioProcessing }}</p>
    </div>
    <div class="p-4 md:p-6 border border-t-0 border-black-200 rounded-b-md bg-bg space-y-5">
      <!-- Loudness normalization -->
      <div>
        <div class="flex items-center">
          <ui-toggle-switch v-model="normalize" :disabled="disabled" :label="$strings.LabelNormalizeVolume" />
          <p class="pl-3 text-sm">{{ $strings.LabelNormalizeVolume }}</p>
        </div>
        <p class="text-xs text-gray-300 mt-1">{{ $strings.LabelNormalizeVolumeHelp }}</p>
        <div v-if="normalize" class="flex flex-wrap gap-4 mt-2">
          <div class="w-40">
            <ui-text-input-with-label v-model="loudnessTarget" type="number" :label="$strings.LabelLoudnessTarget" :disabled="disabled" />
          </div>
          <div class="w-40">
            <ui-text-input-with-label v-model="truePeak" type="number" :label="$strings.LabelTruePeak" :disabled="disabled" />
          </div>
          <div class="w-40">
            <ui-text-input-with-label v-model="loudnessRange" type="number" :label="$strings.LabelLoudnessRange" :disabled="disabled" />
          </div>
        </div>
      </div>

      <!-- Compression -->
      <div>
        <p class="text-sm mb-2">{{ $strings.LabelDynamicRangeCompression }}</p>
        <ui-toggle-btns v-model="compress" :items="presetItems" :disabled="disabled" />
        <p class="text-xs text-gray-300 mt-1">{{ $strings.LabelDynamicRangeCompressionHelp }}</p>
      </div>

      <!-- Voice EQ -->
      <div>
        <div class="flex items-center">
          <ui-toggle-switch v-model="voiceEq" :disabled="disabled" :label="$strings.LabelVoiceClarity" />
          <p class="pl-3 text-sm">{{ $strings.LabelVoiceClarity }}</p>
        </div>
        <p class="text-xs text-gray-300 mt-1">{{ $strings.LabelVoiceClarityHelp }}</p>
      </div>

      <!-- Noise reduction -->
      <div>
        <p class="text-sm mb-2">{{ $strings.LabelNoiseReduction }}</p>
        <ui-toggle-btns v-model="denoise" :items="presetItems" :disabled="disabled" />
        <p class="text-xs text-gray-300 mt-1">{{ $strings.LabelNoiseReductionHelp }}</p>
      </div>

      <!-- Speed -->
      <div>
        <p class="text-sm mb-2">{{ $strings.LabelPlaybackSpeedChange }}</p>
        <div class="flex flex-wrap items-center gap-3">
          <ui-toggle-btns v-model="speedPreset" :items="speedItems" :disabled="disabled" />
          <div v-if="speedPreset === 'custom'" class="w-28">
            <ui-text-input v-model="customSpeed" type="number" min="0.5" max="3" :disabled="disabled" />
          </div>
        </div>
        <p class="text-xs text-gray-300 mt-1">{{ $strings.LabelPlaybackSpeedChangeHelp }}</p>
      </div>

    </div>
  </div>
</template>

<script>
export default {
  props: {
    disabled: {
      type: Boolean,
      default: false
    }
  },
  data() {
    return {
      normalize: false,
      loudnessTarget: -16,
      truePeak: -1.5,
      loudnessRange: 11,
      compress: 'off',
      voiceEq: false,
      denoise: 'off',
      speedPreset: '1',
      customSpeed: 1.25
    }
  },
  computed: {
    presetItems() {
      return [
        { text: this.$strings.LabelPresetOff, value: 'off' },
        { text: this.$strings.LabelPresetLight, value: 'light' },
        { text: this.$strings.LabelPresetMedium, value: 'medium' },
        { text: this.$strings.LabelPresetStrong, value: 'strong' }
      ]
    },
    speedItems() {
      return [
        { text: '1×', value: '1' },
        { text: '1.1×', value: '1.1' },
        { text: '1.25×', value: '1.25' },
        { text: '1.5×', value: '1.5' },
        { text: this.$strings.LabelPresetCustom, value: 'custom' }
      ]
    },
    speed() {
      const value = this.speedPreset === 'custom' ? Number(this.customSpeed) : Number(this.speedPreset)
      return Number.isFinite(value) && value > 0 ? value : 1
    },
    hasProcessing() {
      return this.normalize || this.compress !== 'off' || this.voiceEq || this.denoise !== 'off' || this.speed !== 1
    }
  },
  methods: {
    /**
     * Query params for POST /api/tools/item/:id/encode-m4b (only the options that are on)
     */
    getOptions() {
      const options = {}
      if (this.normalize) {
        options.normalize = '1'
        options.loudnessTarget = String(this.loudnessTarget)
        options.truePeak = String(this.truePeak)
        options.loudnessRange = String(this.loudnessRange)
      }
      if (this.compress !== 'off') options.compress = this.compress
      if (this.voiceEq) options.voiceEq = '1'
      if (this.denoise !== 'off') options.denoise = this.denoise
      if (this.speed !== 1) options.speed = String(this.speed)
      return options
    }
  }
}
</script>
