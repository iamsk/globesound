/**
 * synth.js — 微信小程序轻量萌趣音效合成器
 * 
 * 采用双重容灾架构：
 * 1. 首选引擎：在客户端即时生成 16-bit PCM WAV 二进制缓冲，写入本地用户文件系统，
 *    通过原生 wx.createInnerAudioContext 播放（100% 兼容微信开发者工具模拟器、iOS 静音开关及 Android 真机）。
 * 2. 备用引擎：wx.createWebAudioContext 底层振荡器合成（在支持的环境下即时补充）。
 */

const SAMPLE_RATE = 22050

function createWavBuffer(sampleRate, samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  function writeStr(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)             // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true)              // AudioFormat (1 for PCM)
  view.setUint16(22, 1, true)              // NumChannels (1 mono)
  view.setUint32(24, sampleRate, true)     // SampleRate
  view.setUint32(28, sampleRate * 2, true) // ByteRate
  view.setUint16(32, 2, true)              // BlockAlign
  view.setUint16(34, 16, true)             // BitsPerSample
  writeStr(36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
  }
  return buffer
}

// 7 大萌宝动作拟音波形发生器
const SOUND_GENERATORS = {
  // 1. 欢呼音阶 (Ta-da! C5 - E5 - G5 - C6)
  cheer() {
    const dur = 0.6
    const total = Math.floor(SAMPLE_RATE * dur)
    const s = new Float32Array(total)
    const notes = [523.25, 659.25, 783.99, 1046.50]
    const step = Math.floor(SAMPLE_RATE * 0.12)
    notes.forEach((f, idx) => {
      const st = idx * step
      for (let i = 0; i < Math.floor(SAMPLE_RATE * 0.25) && (st + i) < total; i++) {
        const t = i / SAMPLE_RATE
        const env = Math.exp(-t * 9)
        s[st + i] += (Math.sin(2 * Math.PI * f * t) * 0.5 + Math.sin(4 * Math.PI * f * t) * 0.2) * env
      }
    })
    return createWavBuffer(SAMPLE_RATE, s)
  },

  // 2. 弹簧跳跃 (Boing!)
  boing() {
    const dur = 0.45
    const total = Math.floor(SAMPLE_RATE * dur)
    const s = new Float32Array(total)
    for (let i = 0; i < total; i++) {
      const t = i / SAMPLE_RATE
      const f = 180 + 520 * Math.sin(Math.min(1, t / 0.22) * Math.PI * 0.5)
      const wobble = 1 + 0.1 * Math.sin(2 * Math.PI * 25 * t)
      const env = Math.exp(-t * 6.5)
      s[i] = Math.sin(2 * Math.PI * f * wobble * t) * 0.7 * env
    }
    return createWavBuffer(SAMPLE_RATE, s)
  },

  // 3. 咀嚼吃竹子 (Munch! 咔嚓咔嚓)
  munch() {
    const dur = 0.42
    const total = Math.floor(SAMPLE_RATE * dur)
    const s = new Float32Array(total)
    for (let b = 0; b < 3; b++) {
      const st = Math.floor(b * SAMPLE_RATE * 0.12)
      const len = Math.floor(SAMPLE_RATE * 0.09)
      for (let i = 0; i < len && (st + i) < total; i++) {
        const t = i / SAMPLE_RATE
        const noise = (Math.random() * 2 - 1) * 0.45
        const tone = Math.sin(2 * Math.PI * (450 - b * 70) * t) * 0.35
        const env = Math.exp(-t * 32)
        s[st + i] += (tone + noise) * env
      }
    }
    return createWavBuffer(SAMPLE_RATE, s)
  },

  // 4. 马蹄快跑 (Gallop! 嗒嗒嗒嗒)
  gallop() {
    const dur = 0.6
    const total = Math.floor(SAMPLE_RATE * dur)
    const s = new Float32Array(total)
    const steps = [0, 0.13, 0.26, 0.39]
    steps.forEach((offset, idx) => {
      const st = Math.floor(offset * SAMPLE_RATE)
      const len = Math.floor(SAMPLE_RATE * 0.08)
      const baseF = idx % 2 === 0 ? 580 : 420
      for (let i = 0; i < len && (st + i) < total; i++) {
        const t = i / SAMPLE_RATE
        const env = Math.exp(-t * 40)
        s[st + i] += Math.sin(2 * Math.PI * baseF * t) * 0.6 * env
      }
    })
    return createWavBuffer(SAMPLE_RATE, s)
  },

  // 5. 八音盒铃铛 (Bell / Chime)
  bell() {
    const dur = 0.7
    const total = Math.floor(SAMPLE_RATE * dur)
    const s = new Float32Array(total)
    for (let i = 0; i < total; i++) {
      const t = i / SAMPLE_RATE
      const env = Math.exp(-t * 4.5)
      s[i] = (Math.sin(2 * Math.PI * 880 * t) * 0.5 + Math.sin(2 * Math.PI * 1760 * t) * 0.25) * env
    }
    return createWavBuffer(SAMPLE_RATE, s)
  },

  // 6. 海浪波涛 (Wave)
  wave() {
    const dur = 0.75
    const total = Math.floor(SAMPLE_RATE * dur)
    const s = new Float32Array(total)
    for (let i = 0; i < total; i++) {
      const t = i / SAMPLE_RATE
      const f = 140 + 120 * Math.sin(t / dur * Math.PI)
      const noise = (Math.random() * 2 - 1) * 0.18
      const env = Math.sin(t / dur * Math.PI)
      s[i] = (Math.sin(2 * Math.PI * f * t) * 0.45 + noise) * env
    }
    return createWavBuffer(SAMPLE_RATE, s)
  },

  // 7. 狮子/猛兽萌萌吼 (Roar)
  roar() {
    const dur = 0.65
    const total = Math.floor(SAMPLE_RATE * dur)
    const s = new Float32Array(total)
    for (let i = 0; i < total; i++) {
      const t = i / SAMPLE_RATE
      const vibrato = 1 + 0.25 * Math.sin(2 * Math.PI * 35 * t)
      const f = (160 - 40 * (t / dur)) * vibrato
      const env = Math.sin(t / dur * Math.PI)
      const noise = (Math.random() * 2 - 1) * 0.2
      s[i] = (Math.sin(2 * Math.PI * f * t) * 0.5 + noise) * env
    }
    return createWavBuffer(SAMPLE_RATE, s)
  }
}

class SoundSynth {
  constructor() {
    this.fs = null
    this.fileCache = {}
    this.player = null
    this.webCtx = null
    this._init()
  }

  _init() {
    if (typeof wx === 'undefined') return

    // 1. 设置原生音频模式：解除 iOS 静音开关静音限制
    try {
      if (wx.setInnerAudioOption) {
        wx.setInnerAudioOption({
          obeyMuteSwitch: false,
          mixWithOther: true
        })
      }
    } catch (e) {
      // ignore
    }

    // 2. 初始化文件系统管理器
    try {
      if (wx.getFileSystemManager) {
        this.fs = wx.getFileSystemManager()
      }
    } catch (e) {
      console.warn('[SoundSynth] FileSystemManager 不可用:', e)
    }

    // 3. 初始化 InnerAudioContext 专用音效播放器
    try {
      if (wx.createInnerAudioContext) {
        this.player = wx.createInnerAudioContext()
        this.player.obeyMuteSwitch = false
        this.player.autoplay = false
        this.player.onError(err => {
          console.warn('[SoundSynth] InnerAudio 播放失败:', err)
        })
      }
    } catch (e) {
      console.warn('[SoundSynth] InnerAudioContext 不可用:', e)
    }

    // 4. 尝试初始化 WebAudioContext 作为备用
    try {
      if (wx.createWebAudioContext) {
        this.webCtx = wx.createWebAudioContext()
      }
    } catch (e) {
      // ignore
    }
  }

  /**
   * 获取或即时生成本地 WAV 音频路径
   */
  _getAudioFilePath(key) {
    if (!this.fs || !wx.env || !wx.env.USER_DATA_PATH) return null
    if (this.fileCache[key]) return this.fileCache[key]

    const gen = SOUND_GENERATORS[key] || SOUND_GENERATORS.cheer
    const buffer = gen()
    const filePath = `${wx.env.USER_DATA_PATH}/sfx_${key}.wav`

    try {
      this.fs.writeFileSync(filePath, buffer)
      this.fileCache[key] = filePath
      return filePath
    } catch (err) {
      console.warn(`[SoundSynth] 写入本地音效缓存失败 (${key}):`, err)
      return null
    }
  }

  /**
   * 播放生态大区的超高品质 edge-tts 故事语音 (zh-CN-XiaoxiaoNeural)
   * 真实人声绘本级播报，彻底告别单调假音！
   * @param {string} zoneId - 例如 sichuan_panda, australia_kangaroo 等
   */
  playZoneAudio(zoneId) {
    if (!zoneId) return

    try {
      if (wx.setInnerAudioOption) {
        wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: false })
      }
    } catch (e) {}

    const audioPath = `/audio/kids/${zoneId}.mp3`
    if (!this.player) {
      try {
        this.player = wx.createInnerAudioContext()
        this.player.obeyMuteSwitch = false
      } catch (e) {}
    }

    if (this.player) {
      try {
        this.player.stop()
        this.player.src = audioPath
        this.player.play()
        console.log(`[SoundSynth] ✓ 正在播放 edge-tts 语音: ${audioPath}`)
        return
      } catch (err) {
        console.warn('[SoundSynth] 播放 edge-tts MP3 异常，降级使用拟音:', err)
      }
    }

    // 备用兜底
    this.playByKey('cheer')
  }

  /**
   * 按动作标识播放对应音效
   * @param {string} key - cheer | boing | munch | gallop | bell | wave | roar
   */
  playByKey(key = 'cheer') {
    // 规范化 key
    if (!SOUND_GENERATORS[key]) {
      if (key === 'lion') key = 'roar'
      else key = 'cheer'
    }

    // 确保取消 iOS 静音
    try {
      if (wx.setInnerAudioOption) {
        wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: true })
      }
    } catch (e) {}

    // 尝试方式一：原生 InnerAudioContext 播放本地 PCM WAV
    const filePath = this._getAudioFilePath(key)
    if (filePath && this.player) {
      try {
        this.player.stop()
        this.player.src = filePath
        this.player.play()
        console.log(`[SoundSynth] ✓ 已播放 WAV 音效: ${key} (${filePath})`)
        return
      } catch (err) {
        console.warn('[SoundSynth] 原生播放器调用异常，尝试 WebAudio 备用:', err)
      }
    }

    // 尝试方式二：WebAudioContext 备用发生器
    if (this.webCtx) {
      try {
        if (this.webCtx.state === 'suspended') {
          this.webCtx.resume().then(() => this._playWebAudio(key))
        } else {
          this._playWebAudio(key)
        }
      } catch (e) {
        console.warn('[SoundSynth] WebAudio 备用播放失败:', e)
      }
    }
  }

  _playWebAudio(key) {
    if (!this.webCtx) return
    const now = this.webCtx.currentTime
    const osc = this.webCtx.createOscillator()
    const gain = this.webCtx.createGain()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(440, now)
    gain.gain.setValueAtTime(0.3, now)
    gain.gain.linearRampToValueAtTime(0.001, now + 0.35)
    osc.connect(gain)
    gain.connect(this.webCtx.destination)
    osc.start(now)
    osc.stop(now + 0.35)
  }

  // 快捷方法
  playCheer() { this.playByKey('cheer') }
  playBoing() { this.playByKey('boing') }
  playMunch() { this.playByKey('munch') }
  playGallop() { this.playByKey('gallop') }
  playBell() { this.playByKey('bell') }
  playWave() { this.playByKey('wave') }
  playRoar() { this.playByKey('roar') }
}

module.exports = new SoundSynth()
