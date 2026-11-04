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
    this.player = null
    this.webCtx = null
    this._lastZoneId = null
    this._currentFallbackSfx = null
    this._onAudioEndCallback = null
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

    // 3. 初始化 WebAudioContext（底层内存解码与纯音合成器，零域名白名单依赖）
    try {
      if (wx.createWebAudioContext) {
        this.webCtx = wx.createWebAudioContext()
      }
    } catch (e) {
      // ignore
    }

    // 4. 初始化 InnerAudioContext
    this._ensurePlayer()
  }

  _ensurePlayer() {
    if (this.player) return this.player
    if (typeof wx === 'undefined' || !wx.createInnerAudioContext) return null

    try {
      // 必须使用原生标准的 InnerAudioContext，避免 useWebAudioImplement 导致 iOS 格式解码失败或静音开关冲突
      const p = wx.createInnerAudioContext()
      p.obeyMuteSwitch = false
      p.autoplay = false

      p.onError(err => {
        console.warn('[SoundSynth] InnerAudio 播放失败, 尝试路径备用与降级 WebAudio 内存解码:', err)
        const zoneId = this._lastZoneId
        const fallback = this._currentFallbackSfx
        this._currentFallbackSfx = null

        // 尝试切换路径形式重试
        if (zoneId && p.src) {
          if (!p.src.startsWith('/') && !p._hasTriedSlash) {
            p._hasTriedSlash = true
            p.src = `/audio/kids/${zoneId}.mp3`
            p.play()
            return
          }
        }

        // 降级 WebAudio 二进制解码播放
        if (zoneId) {
          this._playByWebAudioDecode(zoneId, fallback)
        } else if (fallback) {
          this.playByKey(fallback)
        }
      })

      p.onPlay(() => {
        this._currentFallbackSfx = null
      })

      p.onEnded(() => {
        if (typeof this._onAudioEndCallback === 'function') {
          this._onAudioEndCallback()
        }
      })

      this.player = p
      return this.player
    } catch (e) {
      console.warn('[SoundSynth] InnerAudioContext 不可用:', e)
      return null
    }
  }

  setOnAudioEnd(cb) {
    this._onAudioEndCallback = cb
  }

  stop() {
    if (this.player) {
      try {
        this.player.stop()
      } catch (e) {}
    }
    if (typeof this._onAudioEndCallback === 'function') {
      this._onAudioEndCallback()
    }
  }

  /**
   * 播放生态大区的超高品质 edge-tts 故事语音 (zh-CN-XiaoxiaoNeural)
   * 采用纯内存与小程序项目资产路径，完全不请求任何外部网络，零白名单限制！
   * 
   * 三重容灾流：
   * 1. 首选：InnerAudioContext 播放项目内标准相对路径 audio/kids/${zoneId}.mp3
   * 2. 备用：WebAudioContext.decodeAudioData 直接从代码包二进制 ArrayBuffer 内存硬解播放
   * 3. 兜底：客户端即时合成 PCM WAV 动作拟音（竹子咀嚼/小马奔跑/海浪）
   */
  playZoneAudio(zoneId, fallbackSfx = 'cheer') {
    if (!zoneId) return

    try {
      if (wx.setInnerAudioOption) {
        wx.setInnerAudioOption({ obeyMuteSwitch: false, mixWithOther: false })
      }
    } catch (e) {}

    this._lastZoneId = zoneId
    this._currentFallbackSfx = fallbackSfx

    // 方案一：优先通过原生 InnerAudioContext 播放
    const player = this._ensurePlayer()
    if (player) {
      try {
        player.stop()
        player._hasTriedSlash = false
        player.src = `audio/kids/${zoneId}.mp3`
        player.play()
        console.log(`[SoundSynth] ✓ 正在通过 InnerAudio 播放故事语音: audio/kids/${zoneId}.mp3`)
        return
      } catch (err) {
        console.warn('[SoundSynth] InnerAudio 同步播放异常, 切换 WebAudio decode:', err)
      }
    }

    // 方案二：备用原生 WebAudio 二进制解码播放（100% 内存直读，彻底脱离 URL 与白名单）
    this._playByWebAudioDecode(zoneId, fallbackSfx)
  }

  /**
   * 通过 WebAudioContext 直接将代码包内二进制 MP3 解码并播放
   * 绝对不发起任何网络请求，不经过任何 URL 协议，零域名白名单依赖
   */
  _playByWebAudioDecode(zoneId, fallbackSfx = 'cheer') {
    if (!this.webCtx || !this.fs) {
      this.playByKey(fallbackSfx)
      return
    }

    try {
      if (this.webCtx.state === 'suspended') {
        this.webCtx.resume()
      }
    } catch (e) {}

    const candidatePaths = [
      `audio/kids/${zoneId}.mp3`,
      `/audio/kids/${zoneId}.mp3`
    ]
    let buf = null
    for (const p of candidatePaths) {
      try {
        buf = this.fs.readFileSync(p)
        if (buf && (buf.byteLength > 0 || buf.length > 0)) break
      } catch (e) {}
    }

    if (!buf) {
      console.warn(`[SoundSynth] 代码包内未读取到 MP3: ${zoneId}，降级拟音`)
      this.playByKey(fallbackSfx)
      return
    }

    try {
      this.webCtx.decodeAudioData(
        buf,
        (audioBuffer) => {
          const src = this.webCtx.createBufferSource()
          src.buffer = audioBuffer
          src.connect(this.webCtx.destination)
          src.start(0)
          console.log(`[SoundSynth] ✓ WebAudioContext 原生内存解码播放成功: ${zoneId}`)
        },
        (err) => {
          console.warn('[SoundSynth] WebAudio decode 失败，降级拟音:', err)
          this.playByKey(fallbackSfx)
        }
      )
    } catch (err) {
      console.warn('[SoundSynth] decodeAudioData 调用异常:', err)
      this.playByKey(fallbackSfx)
    }
  }

  /**
   * 按动作标识播放对应音效
   * 纯内存即时解码播放，彻底杜绝写入临时文件与 http:// 域名拦截
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

    // 优先使用 WebAudioContext 在纯内存中即时解码播放（零文件写入，零白名单）
    if (this.webCtx) {
      try {
        if (this.webCtx.state === 'suspended') {
          this.webCtx.resume()
        }
        const gen = SOUND_GENERATORS[key] || SOUND_GENERATORS.cheer
        const wavBuf = gen()
        this.webCtx.decodeAudioData(
          wavBuf,
          (audioBuffer) => {
            const src = this.webCtx.createBufferSource()
            src.buffer = audioBuffer
            src.connect(this.webCtx.destination)
            src.start(0)
            console.log(`[SoundSynth] ✓ WebAudio 已播放内存合成拟音: ${key}`)
          },
          () => {
            this._playOscillator(key)
          }
        )
        return
      } catch (e) {
        console.warn('[SoundSynth] WebAudio 内存解码失败:', e)
      }
    }

    // 终极备用：振荡器合成
    this._playOscillator(key)
  }

  _playOscillator(key) {
    if (!this.webCtx) return
    try {
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
    } catch (e) {}
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
