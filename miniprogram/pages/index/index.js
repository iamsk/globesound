/**
 * globesound 主页逻辑
 * 
 * 功能：
 * 1. 通过 BLE 连接 BWT901BLECL IMU 传感器
 * 2. 实时解析传感器数据包，静止时计算球顶读数点经纬度
 * 3. 卫星/标准地图展示读数位置
 * 4. 双模式支持：
 *    - 📻 环球电台：自动锁定播放离读数点最近的电台，支持同城电台切换及曲风筛选
 *    - 🐼 萌宝环球乐园：专为幼儿设计，超高容错（按大洲、大洋与大省区磁吸），萌趣音效与短对话
 */

const app = getApp()
const {
  StillDetector,
  Calibration,
  latlonToVec,
  vecToLatlon,
  dot,
  norm,
  angleDeg
} = require('../../utils/geo')
const synth = require('../../utils/synth')

// ===== 常量 =====
const LOCK_DEG = 3.0          // 电台读数点 3° 范围内没有电台则不锁定
const CITY_KM = 30.0          // 距离最近电台 30km 内归为"同城"
const LIVE_SMOOTH = 0.3       // 实时方向一阶低通滤波系数
const MAX_FIXES = 4           // 最近读数记录条数
const CONNECT_TIMEOUT_MS = 10000 // 电台音频连接超时时间（毫秒）

/**
 * 格式化经纬度字符串：例如 22.5°N  114.1°E
 */
function fmtCoord(lat, lon) {
  if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) return '—'
  const latStr = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`
  const lonStr = `${Math.abs(lon).toFixed(1)}°${lon >= 0 ? 'E' : 'W'}`
  return `${latStr}  ${lonStr}`
}

/**
 * 格式化时间 HH:MM:SS
 */
function fmtTime(d = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

Page({
  data: {
    // 模式切换：'radio' (环球电台) 或 'kids' (萌宝乐园)
    currentMode: 'kids',

    // 连接状态
    bleConnected: false,
    bleConnecting: false,
    statusText: '未连接',
    statusClass: '', // '', 'moving', 'still'

    // 坐标展示
    coordText: '—',
    sourceText: '连接蓝牙传感器开始使用',
    lat: 30.57,
    lon: 104.06,

    // 地图设置
    mapLat: 30.57,
    mapLon: 104.06,
    scale: 4,
    allMarkers: [],
    following: true,
    satelliteOn: true,

    // ===== 萌宝乐园数据 =====
    currentKidsZone: null,
    kidsCandidates: [],

    // ===== 电台模式数据 =====
    stations: [],
    visibleStations: [],
    currentStation: null,
    stationName: '把地球仪上的地点转到最高点',
    stationMeta: '球停稳约 1 秒，就会锁定离读数点最近的电台',
    kickerText: '电台目录加载中',
    kickerClass: '',
    isPlaying: false,
    audioUnlocked: false,
    group: [],
    groupIdx: 0,
    groupCountText: '',

    // 曲风筛选
    genres: [],
    currentGenre: '全部',

    // 读数历史
    fixes: [],

    // 标定状态
    isCalibrated: false,
  },

  onLoad() {
    this.detector = new StillDetector(5.0, 0.15, 6)
    this.liveVec = null
    this.targetVec = null
    this.lastStill = false
    this.lastPreviewTime = 0
    this.lastLiveSetDataTime = 0
    this.connectTimer = null
    this.failStreak = 0

    // 初始化音频与合成器
    this._initAudio()

    // 加载萌宝乐园数据
    this.loadKidsZones()

    // 加载电台数据
    this.loadStations()

    // 检查标定数据
    this._syncCalibration()

    // 绑定 BLE 监听
    this._bindBLE()
  },

  onShow() {
    this._syncCalibration()
    if (this.ble) {
      this.setData({
        bleConnected: this.ble.connected
      })
    }
  },

  onUnload() {
    if (this.ble && this._onPacketBound) {
      this.ble.removePacketListener(this._onPacketBound)
    }
    if (this.ble && this._onConnBound) {
      this.ble.removeConnectionListener(this._onConnBound)
    }
    this._destroyAudio()
  },

  // ===== 模式切换 =====
  onSwitchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.currentMode) return

    this.setData({ currentMode: mode })

    if (mode === 'kids') {
      // 切换到萌宝模式：暂停电台
      if (this.audio) {
        this.audio.pause()
      }
      this.setData({ isPlaying: false })

      // 立即对准当前位置的萌宝
      const v = this.targetVec || latlonToVec(this.data.lat, this.data.lon)
      const { best } = this.matchKidsZone(v)
      if (best) {
        this.lockKidsZone(best, true)
      }
    } else {
      // 切换到电台模式
      if (this.targetVec) {
        this.lockAt(this.targetVec)
      } else {
        this.setData({
          allMarkers: this.buildMarkers(this.data.lat, this.data.lon, this.data.statusClass)
        })
      }
    }
  },

  // ===== 萌宝乐园核心逻辑 =====

  loadKidsZones() {
    try {
      const kidsList = require('../../data/kids_zones.json')
      this.kidsZones = kidsList.map(z => ({
        ...z,
        v: latlonToVec(z.lat, z.lon)
      }))

      // 默认选中第一只萌友 (大熊猫)
      const defaultZone = this.kidsZones[0]
      this.setData({
        currentKidsZone: defaultZone,
        kidsCandidates: this.kidsZones.slice(0, 4),
        allMarkers: this.buildMarkers(defaultZone.lat, defaultZone.lon, 'still')
      })
    } catch (e) {
      console.warn('加载萌宝数据失败:', e)
    }
  },

  /**
   * 超高容错的萌宝区域磁吸算法
   * 计算与全球各动物大区的球面角距离，按最近邻自动吸附，并提取前4个最近萌友作为候选
   */
  matchKidsZone(v) {
    if (!v || !this.kidsZones || this.kidsZones.length === 0) {
      return { best: null, candidates: [] }
    }

    const list = this.kidsZones.map(z => {
      const d = dot(z.v, v)
      const deg = Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI
      return {
        ...z,
        distDeg: deg
      }
    })

    list.sort((a, b) => a.distDeg - b.distDeg)

    const best = list[0]
    const candidates = list.slice(0, 4)

    return { best, candidates }
  },

  lockKidsZone(zone, playSound = true) {
    if (!zone) return

    const v = latlonToVec(zone.lat, zone.lon)
    const { candidates } = this.matchKidsZone(this.targetVec || v)

    this.setData({
      currentKidsZone: zone,
      kidsCandidates: candidates,
      allMarkers: this.buildMarkers(this.data.lat, this.data.lon, this.data.statusClass)
    })

    if (playSound) {
      // 播放超高品质 edge-tts 故事语音
      synth.playZoneAudio(zone.id)
      try {
        wx.vibrateShort({ type: 'medium' })
      } catch (e) {
        // ignore
      }
    }
  },

  onKidsPlaySound() {
    const cur = this.data.currentKidsZone
    if (!cur) return

    // 播放该生态区的真人故事讲解
    synth.playZoneAudio(cur.id)
    try {
      wx.vibrateShort({ type: 'medium' })
    } catch (e) {
      // ignore
    }

    wx.showToast({
      title: cur.action || '嗷呜~',
      icon: 'none',
      duration: 1500
    })
  },

  onSelectKidsCandidate(e) {
    const id = e.currentTarget.dataset.id
    if (!id || !this.kidsZones) return
    const target = this.kidsZones.find(z => z.id === id)
    if (target) {
      this.lockKidsZone(target, true)
    }
  },

  // ===== BLE 管理与数据接入 =====

  _bindBLE() {
    this.ble = app.globalData.ble
    if (!this.ble) return

    this._onPacketBound = (pkt) => this.onBlePacket(pkt)
    this._onConnBound = (connected) => this.onBleConnectionChange(connected)

    this.ble.addPacketListener(this._onPacketBound)
    this.ble.addConnectionListener(this._onConnBound)

    this.setData({
      bleConnected: this.ble.connected
    })
  },

  _syncCalibration() {
    const cal = app.globalData.calibration
    if (cal) {
      this.calibration = cal
      this.setData({
        isCalibrated: true,
        sourceText: this.ble && this.ble.connected ? '数据来源：BWT901BLECL' : '标定已就绪，请连接蓝牙'
      })
    } else {
      this.calibration = null
      this.setData({
        isCalibrated: false,
        sourceText: '未标定，连接蓝牙后进行标定'
      })
    }
  },

  async onConnectBLE() {
    if (this.data.bleConnecting) return

    if (this.data.bleConnected) {
      wx.showModal({
        title: '断开蓝牙',
        content: '确定要断开当前传感器的连接吗？',
        success: async (res) => {
          if (res.confirm && this.ble) {
            await this.ble.disconnect()
            this.setData({
              bleConnected: false,
              statusText: '未连接',
              statusClass: '',
              sourceText: '蓝牙已断开'
            })
          }
        }
      })
      return
    }

    this.setData({
      bleConnecting: true,
      statusText: '初始化蓝牙…'
    })

    try {
      await this.ble.init()
      this.setData({ statusText: '扫描传感器…' })

      const devices = await this.ble.scan(6000)
      if (!devices || devices.length === 0) {
        throw new Error('未发现 WitMotion 传感器，请确认传感器开机且未被手机连接')
      }

      let selectedDevice = devices[0]
      if (devices.length > 1) {
        const names = devices.map(d => `${d.name || '未知设备'} (${d.RSSI}dBm)`)
        const res = await new Promise((resolve, reject) => {
          wx.showActionSheet({
            itemList: names,
            success: resolve,
            fail: reject
          })
        })
        selectedDevice = devices[res.tapIndex]
      }

      this.setData({ statusText: '正在连接…' })
      await this.ble.connect(selectedDevice.deviceId, selectedDevice.name)

      this.setData({
        bleConnected: true,
        bleConnecting: false,
        statusText: '已连接·转动中',
        statusClass: 'moving',
        sourceText: '数据来源：' + (selectedDevice.name || 'BWT901BLECL')
      })

      if (!this.calibration) {
        wx.showModal({
          title: '首次使用请先标定',
          content: '通过 4 个已知点标定地球仪姿态后即可精准读数。现在开始标定？',
          confirmText: '去标定',
          cancelText: '稍后',
          success: (r) => {
            if (r.confirm) {
              wx.navigateTo({ url: '/pages/calibrate/calibrate' })
            }
          }
        })
      }
    } catch (err) {
      console.error('[Index] 蓝牙连接失败:', err)
      this.setData({
        bleConnecting: false,
        statusText: '连接失败',
        statusClass: ''
      })
      const msg = err.errMsg || err.message || '连接失败'
      wx.showToast({ title: msg, icon: 'none', duration: 2500 })
    }
  },

  onBleConnectionChange(connected) {
    this.setData({
      bleConnected: connected,
      statusText: connected ? '已连接·转动中' : '未连接',
      statusClass: connected ? 'moving' : '',
      sourceText: connected ? '传感器已就绪' : '蓝牙连接已断开'
    })
    if (!connected) {
      this.liveVec = null
      this.targetVec = null
      this.detector.reset()
      this.lastStill = false
    }
  },

  onBlePacket(pkt) {
    if (!pkt || !pkt.acc) return

    // 1. 静止检测
    const up = this.detector.update(pkt.acc, pkt.gyro)

    // 2. 实时加速度滤波
    const n = norm(pkt.acc)
    if (n > 0.6 && n < 1.4) {
      const v = [pkt.acc[0] / n, pkt.acc[1] / n, pkt.acc[2] / n]
      if (!this.liveVec) {
        this.liveVec = v
      } else {
        this.liveVec = [
          this.liveVec[0] + LIVE_SMOOTH * (v[0] - this.liveVec[0]),
          this.liveVec[1] + LIVE_SMOOTH * (v[1] - this.liveVec[1]),
          this.liveVec[2] + LIVE_SMOOTH * (v[2] - this.liveVec[2])
        ]
      }
    }

    // 3. 计算读数点经纬度（带未标定自动几何兜底）
    const curSensorVec = up || this.liveVec
    if (!curSensorVec) return

    let currentLat, currentLon
    if (this.calibration) {
      const res = this.calibration.toLatlon(curSensorVec)
      currentLat = res.lat
      currentLon = res.lon
    } else {
      // 未完成 4 点标定时的粗略方位映射，确保转动时也能实时感应与切卡
      const res = vecToLatlon(curSensorVec)
      currentLat = res.lat
      currentLon = res.lon
    }

    this.targetVec = latlonToVec(currentLat, currentLon)

    if (up) {
      this.onStillReading(currentLat, currentLon)
    } else {
      this.onLiveReading(currentLat, currentLon)
    }

    // 4. 静止判断状态转换触发
    const isStill = !!up
    if (isStill && !this.lastStill) {
      // 刚刚停稳
      if (this.data.currentMode === 'kids') {
        const { best } = this.matchKidsZone(this.targetVec)
        if (best) {
          this.lockKidsZone(best, true) // 停稳后播放高品质 edge-tts 故事语音！
        }
      } else {
        if (this.targetVec) {
          this.lockAt(this.targetVec)
        }
      }
    } else if (!isStill && this.targetVec) {
      // 转动中实时响应：每 250ms 检查一次当前所在区域
      const now = Date.now()
      if (now - this.lastPreviewTime > 250) {
        this.lastPreviewTime = now
        if (this.data.currentMode === 'kids') {
          // 转动跨越大区时，实时联动卡片与萌宠切换，防止界面停留在初始熊猫
          const { best, candidates } = this.matchKidsZone(this.targetVec)
          if (best && (!this.data.currentKidsZone || this.data.currentKidsZone.id !== best.id)) {
            this.setData({
              currentKidsZone: best,
              kidsCandidates: candidates
            })
          }
        } else if (this.data.currentMode === 'radio') {
          this.previewAt(this.targetVec)
        }
      }
    }
    this.lastStill = isStill
  },

  onStillReading(lat, lon) {
    const coordText = fmtCoord(lat, lon)
    this.addFix(lat, lon)

    const update = {
      coordText,
      lat,
      lon,
      statusText: '静止 · 已读数',
      statusClass: 'still',
      sourceText: this.calibration ? '数据来源：BWT901BLECL' : '未标定（默认方位，可去标定页校准）'
    }

    if (this.data.following) {
      update.mapLat = lat
      update.mapLon = lon
    }

    update.allMarkers = this.buildMarkers(lat, lon, 'still')
    this.setData(update)
  },

  onLiveReading(lat, lon) {
    // 功耗与CPU优化：节流控制，限制转动渲染频率最多 ~7Hz，杜绝频繁 setData 导致的发热耗电
    const now = Date.now()
    if (now - this.lastLiveSetDataTime < 140) {
      return
    }
    this.lastLiveSetDataTime = now

    const coordText = fmtCoord(lat, lon)
    const update = {
      coordText,
      lat,
      lon,
      statusText: '转动中',
      statusClass: 'moving',
      sourceText: this.calibration ? '数据来源：BWT901BLECL' : '未标定（默认方位，可去标定页校准）'
    }

    if (this.data.following) {
      update.mapLat = lat
      update.mapLon = lon
    }

    update.allMarkers = this.buildMarkers(lat, lon, 'moving')
    this.setData(update)
  },

  addFix(lat, lon) {
    const fixes = this.data.fixes
    const last = fixes[0]
    if (last && Math.abs(last.lat - lat) < 0.15 && Math.abs(last.lon - lon) < 0.15) {
      return
    }

    const newFixes = [
      { lat, lon, coordText: fmtCoord(lat, lon), timeText: fmtTime() },
      ...fixes
    ].slice(0, MAX_FIXES)

    this.setData({ fixes: newFixes })
  },

  buildMarkers(lat, lon, state) {
    const isStill = state === 'still'
    const isKids = this.data.currentMode === 'kids'
    const curZone = this.data.currentKidsZone

    const calloutText = isKids && curZone
      ? `${curZone.emoji} ${curZone.animal}`
      : fmtCoord(lat, lon)

    const borderColor = isKids
      ? (curZone ? curZone.badgeColor || '#48bb78' : '#48bb78')
      : (isStill ? '#ffb547' : '#4fd1c5')

    const markers = [
      {
        id: 1,
        latitude: lat,
        longitude: lon,
        width: 26,
        height: 26,
        iconPath: isStill ? '/images/marker-amber.png' : '/images/marker-cyan.png',
        anchor: { x: 0.5, y: 0.5 },
        callout: {
          content: calloutText,
          color: '#ffffff',
          bgColor: '#0e121c',
          borderRadius: 8,
          borderColor: borderColor,
          borderWidth: 2,
          padding: 6,
          fontSize: isKids ? 13 : 12,
          display: 'ALWAYS'
        }
      }
    ]

    if (isKids && curZone) {
      markers.push({
        id: 2,
        latitude: curZone.lat,
        longitude: curZone.lon,
        width: 22,
        height: 22,
        iconPath: '/images/marker-play.png',
        anchor: { x: 0.5, y: 0.5 },
        callout: {
          content: `${curZone.emoji} ${curZone.name}`,
          color: '#ffffff',
          bgColor: '#1a202c',
          borderRadius: 6,
          borderColor: curZone.badgeColor || '#ffb547',
          borderWidth: 1,
          padding: 4,
          fontSize: 11,
          display: 'BYCLICK'
        }
      })
    } else if (!isKids) {
      const cur = this.data.currentStation
      if (cur && cur.lat != null && cur.lon != null) {
        markers.push({
          id: 2,
          latitude: cur.lat,
          longitude: cur.lon,
          width: 20,
          height: 20,
          iconPath: '/images/marker-play.png',
          anchor: { x: 0.5, y: 0.5 },
          callout: {
            content: cur.name,
            color: '#ff6b4a',
            bgColor: '#0e121c',
            borderRadius: 6,
            borderColor: '#ff6b4a',
            borderWidth: 1,
            padding: 4,
            fontSize: 11,
            display: 'BYCLICK'
          }
        })
      }
    }

    return markers
  },

  // ===== 电台模式逻辑 =====

  loadStations() {
    let list = []
    try {
      list = require('../../data/stations.json')
    } catch (e) {
      try {
        list = require('../../data/stations_extra.json')
      } catch (e2) {
        console.warn('加载本地电台失败:', e2)
      }
    }

    this.allStations = list.map(s => ({
      ...s,
      v: latlonToVec(s.lat, s.lon)
    }))

    this.renderGenres()
    this.applyGenreFilter()
    this.setData({
      kickerText: `${this.allStations.length} 个电台已就绪`
    })

    this.fetchOnlineStations()
  },

  fetchOnlineStations() {
    wx.request({
      url: 'https://de1.api.radio-browser.info/json/stations/search?has_geo_info=true&hidebroken=true&limit=1000',
      method: 'GET',
      header: { 'User-Agent': 'globesound/0.1' },
      success: (res) => {
        if (res.statusCode === 200 && Array.isArray(res.data)) {
          const online = res.data
            .filter(s => s.geo_lat != null && s.geo_long != null && (s.url_resolved || s.url))
            .map(s => {
              const lat = parseFloat(s.geo_lat)
              const lon = parseFloat(s.geo_long)
              return {
                name: (s.name || '').trim() || '未命名电台',
                url: s.url_resolved || s.url,
                lat,
                lon,
                country: s.country || '',
                cc: s.countrycode || '',
                genre: this.classifyGenre(s.tags || ''),
                lang: (s.language || '').split(',')[0].trim(),
                bitrate: parseInt(s.bitrate || 0),
                codec: s.codec || '',
                clicks: parseInt(s.clickcount || 0),
                v: latlonToVec(lat, lon)
              }
            })

          const existingUrls = new Set(this.allStations.map(s => s.url))
          const additions = online.filter(s => !existingUrls.has(s.url))
          this.allStations = [...this.allStations, ...additions]

          this.renderGenres()
          this.applyGenreFilter()
          this.setData({
            kickerText: `${this.allStations.length} 个电台已就绪`
          })
        }
      },
      fail: (e) => {
        // continue with bundled list
      }
    })
  },

  classifyGenre(tags) {
    const t = (tags || '').toLowerCase()
    const GENRES = [
      ['宗教', ['christian', 'gospel', 'religi', 'catholic', 'worship', 'islam', 'quran', 'church', 'bible']],
      ['新闻·谈话', ['news', 'talk', 'noticias', 'información', 'informacion', 'sport', 'deportes', 'nachrichten']],
      ['古典', ['classical', 'clásica', 'clasica', 'klassik', 'baroque', 'opera', 'symphon']],
      ['爵士·蓝调', ['jazz', 'blues', 'soul', 'swing']],
      ['电子', ['electronic', 'dance', 'house', 'techno', 'trance', 'edm', 'lounge', 'chill', 'ambient']],
      ['嘻哈', ['hip hop', 'hip-hop', 'hiphop', 'rap', 'r&b', 'rnb']],
      ['摇滚', ['rock', 'metal', 'punk', 'alternative', 'indie']],
      ['乡村·民谣', ['country', 'folk', 'bluegrass']],
      ['流行', ['pop', 'hits', 'top 40', 'top40', '80s', '90s', 'oldies', 'charts']]
    ]
    for (const [genre, keys] of GENRES) {
      if (keys.some(k => t.includes(k))) return genre
    }
    return '综合'
  },

  renderGenres() {
    const counts = {}
    for (const s of this.allStations) {
      counts[s.genre] = (counts[s.genre] || 0) + 1
    }
    const list = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(e => e[0])
    this.setData({
      genres: list
    })
  },

  applyGenreFilter() {
    const g = this.data.currentGenre
    const visible = g === '全部'
      ? this.allStations
      : this.allStations.filter(s => s.genre === g)

    this.visibleStations = visible
    this.setData({
      visibleStations: visible
    })
  },

  onGenreFilter(e) {
    const g = e.currentTarget.dataset.genre
    this.setData({ currentGenre: g })
    this.applyGenreFilter()
    if (this.lastStill && this.targetVec) {
      this.lockAt(this.targetVec)
    }
  },

  groupAt(v) {
    if (!v || !this.visibleStations || this.visibleStations.length === 0) return []

    let maxDot = -2
    for (const s of this.visibleStations) {
      const d = dot(s.v, v)
      if (d > maxDot) {
        maxDot = d
      }
    }

    if (maxDot < -1) return []

    const distRad = Math.acos(Math.max(-1, Math.min(1, maxDot)))
    const distDegVal = distRad * 180 / Math.PI
    if (distDegVal > LOCK_DEG) return []

    const best = this.visibleStations.find(s => dot(s.v, v) === maxDot)
    if (!best) return []

    const cosCity = Math.cos(CITY_KM / 6371.0)
    const group = this.visibleStations
      .filter(s => dot(s.v, best.v) >= cosCity)
      .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))

    return group
  },

  lockAt(v) {
    const g = this.groupAt(v)
    if (!g.length) {
      this.setData({
        stationName: '这里附近没有找到电台',
        stationMeta: `3° 范围内无 ${this.data.currentGenre === '全部' ? '' : this.data.currentGenre} 电台`,
        kickerText: '换个地点或换个曲风试试',
        kickerClass: '',
        group: [],
        groupCountText: ''
      })
      return
    }

    const cur = this.data.currentStation
    if (cur && g.some(s => s.url === cur.url)) {
      const idx = g.findIndex(s => s.url === cur.url)
      this.setData({
        group: g,
        groupIdx: idx,
        groupCountText: g.length > 1 ? `同城 ${idx + 1} / ${g.length}` : '附近只有这一个',
        kickerText: '已锁定',
        kickerClass: 'locked'
      })
      return
    }

    this.failStreak = 0
    this.setData({
      group: g,
      groupIdx: 0
    })
    this.playStation(0)
  },

  previewAt(v) {
    const g = this.groupAt(v)
    if (g.length > 0) {
      this.setData({
        kickerText: `预览 · ${g[0].genre}`,
        kickerClass: ''
      })
    }
  },

  // ===== 音频播放控制 =====

  _initAudio() {
    this.audio = wx.createInnerAudioContext()
    this.audio.obeyMuteSwitch = false

    this.audio.onPlay(() => {
      this._clearConnectTimer()
      this.failStreak = 0
      this.setData({
        isPlaying: true,
        kickerText: '正在播放',
        kickerClass: 'playing'
      })
    })

    this.audio.onPause(() => {
      this.setData({
        isPlaying: false,
        kickerText: '已暂停',
        kickerClass: ''
      })
    })

    this.audio.onError((err) => {
      console.warn('[Audio] 播放错误:', err)
      this._clearConnectTimer()
      this._handleStreamFailure()
    })

    this.audio.onEnded(() => {
      this.onNextStation()
    })
  },

  _clearConnectTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer)
      this.connectTimer = null
    }
  },

  _handleStreamFailure() {
    const group = this.data.group
    const cur = this.data.currentStation
    if (!cur || !group || group.length === 0) return

    this.failStreak++
    if (this.failStreak < group.length) {
      this.setData({
        isPlaying: false,
        kickerText: `${cur.name} 连不上，换同城下一个…`,
        kickerClass: 'error'
      })
      setTimeout(() => {
        this.onNextStation()
      }, 500)
    } else {
      this.setData({
        isPlaying: false,
        kickerText: '这一带的电台都连不上，换个地方试试',
        kickerClass: 'error'
      })
    }
  },

  _destroyAudio() {
    this._clearConnectTimer()
    if (this.audio) {
      try {
        this.audio.stop()
        this.audio.destroy()
      } catch (e) {
        // ignore
      }
      this.audio = null
    }
  },

  playStation(index) {
    const group = this.data.group
    if (!group || !group.length) return

    const idx = (index + group.length) % group.length
    const cur = group[idx]

    const metaParts = [
      cur.country,
      cur.genre,
      cur.lang,
      cur.bitrate ? `${cur.bitrate} kbps` : '',
      cur.codec
    ].filter(Boolean).join(' · ')

    this.setData({
      groupIdx: idx,
      currentStation: cur,
      stationName: cur.name,
      stationMeta: metaParts || '网络电台',
      groupCountText: group.length > 1 ? `同城 ${idx + 1} / ${group.length}` : '附近只有这一个',
      allMarkers: this.buildMarkers(this.data.lat, this.data.lon, this.data.statusClass)
    })

    if (!this.data.audioUnlocked) {
      this.setData({
        kickerText: '已锁定 · 点击下方开始收听',
        kickerClass: 'locked'
      })
      return
    }

    this.setData({
      kickerText: '连接中……',
      kickerClass: 'locked'
    })

    this._clearConnectTimer()
    if (!this.audio) this._initAudio()

    this.audio.src = cur.url
    this.audio.play()

    this.connectTimer = setTimeout(() => {
      if (this.audio && !this.data.isPlaying) {
        console.warn('[Audio] 连接超时')
        this._handleStreamFailure()
      }
    }, CONNECT_TIMEOUT_MS)
  },

  onStartListen() {
    this.setData({ audioUnlocked: true })
    if (this.data.currentStation) {
      this.playStation(this.data.groupIdx)
    } else if (this.data.group.length > 0) {
      this.playStation(0)
    } else {
      wx.showToast({ title: '转动地球仪定位电台', icon: 'none' })
    }
  },

  onTogglePlay() {
    if (!this.audio) this._initAudio()
    if (this.data.isPlaying) {
      this.audio.pause()
    } else {
      if (this.audio.src) {
        this.audio.play()
      } else if (this.data.currentStation) {
        this.playStation(this.data.groupIdx)
      }
    }
  },

  onPrevStation() {
    this.failStreak = 0
    this.playStation(this.data.groupIdx - 1)
  },

  onNextStation() {
    this.failStreak = 0
    this.playStation(this.data.groupIdx + 1)
  },

  // ===== 界面操作 =====

  onFollowBack() {
    this.setData({
      following: true,
      mapLat: this.data.lat,
      mapLon: this.data.lon
    })
  },

  onMapMove(e) {
    if (e.type === 'regionchange' || (e.detail && e.detail.type === 'end')) {
      if (e.causedBy === 'gesture' || (e.detail && e.detail.causedBy === 'gesture')) {
        this.setData({ following: false })
      }
    }
  },

  onToggleSatellite() {
    this.setData({ satelliteOn: !this.data.satelliteOn })
  },

  onRecalibrate() {
    wx.navigateTo({ url: '/pages/calibrate/calibrate' })
  },

  onOpenSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' })
  }
})
