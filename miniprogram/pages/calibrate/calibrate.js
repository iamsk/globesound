/**
 * globesound 标定页
 * 引导用户完成 4 点标定，计算地球仪坐标系到传感器坐标系的旋转矩阵
 *
 * 标定流程：
 *  1. 依次显示 4 个已知坐标点
 *  2. 用户将地球仪转到对应位置后点击"确认"
 *  3. 等待传感器静止（约 1 秒），记录"up"向量
 *  4. 完成后运行 Wahba/SVD 求解旋转矩阵
 *  5. 显示 RMS 残差，保存到本地存储
 */

const app = getApp()
const { CALIBRATION_POINTS, RMS_WARN_DEG, calibrate, StillDetector, Calibration } = require('../../utils/geo')

/**
 * 将十进制度数格式化为 度°分′ 格式
 * @param {number} deg - 十进制度数
 * @param {boolean} isLat - 是否为纬度
 * @returns {string} 格式化后的坐标字符串
 */
function formatCoord(deg, isLat) {
  const abs = Math.abs(deg)
  const d = Math.floor(abs)
  const m = ((abs - d) * 60).toFixed(1)
  const suffix = isLat
    ? (deg >= 0 ? 'N' : 'S')
    : (deg >= 0 ? 'E' : 'W')
  return `${d}°${m}′${suffix}`
}

Page({
  data: {
    step: 0,           // 0-3 对应 4 个标定点，4 为结果
    totalSteps: 4,
    currentPoint: null, // { name, lat, lon }
    pointLat: 0,
    pointLon: 0,
    pointLatText: '',
    pointLonText: '',
    statusText: '',
    waiting: false,     // 正在等待传感器静止
    recording: false,   // 正在记录静止向量
    recorded: false,    // 当前步骤已记录

    // 标定结果
    done: false,
    rmsDeg: 0,
    rmsWarn: false,

    // 地图标记
    markers: [],
  },

  /**
   * 页面加载 — BLE 连接已由主页建立
   */
  onLoad(options) {
    this.detector = new StillDetector()
    this.ups = []  // 每个标定点录到的 up 向量
    this.waitingForStill = false

    // 注册 BLE 数据监听
    this.setupBLEListener()

    // 显示第一个标定点
    this.showStep(0)
  },

  /**
   * 监听全局 BLE 数据包
   * BLE 连接由主页或全局管理，此页面挂载监听器
   */
  setupBLEListener() {
    this.ble = app.globalData.ble
    this._onBlePacket = (pkt) => this.onPacket(pkt)
    if (this.ble) {
      this.ble.addPacketListener(this._onBlePacket)
    }
  },

  /**
   * 显示指定步骤的标定点信息
   * @param {number} step - 步骤索引 (0-3)
   */
  showStep(step) {
    const point = CALIBRATION_POINTS[step]
    this.setData({
      step,
      currentPoint: point,
      pointLat: point.lat,
      pointLon: point.lon,
      pointLatText: formatCoord(point.lat, true),
      pointLonText: formatCoord(point.lon, false),
      statusText: `把「${point.name}」转到子午圈最高点的正下方，松手后点击确认`,
      waiting: false,
      recorded: false,
      markers: [{
        id: 0,
        latitude: point.lat,
        longitude: point.lon,
        width: 24,
        height: 24,
        iconPath: '/images/marker-target.png',
        callout: {
          content: point.name,
          display: 'ALWAYS',
          fontSize: 12,
          borderRadius: 4,
          padding: 6,
          bgColor: '#ffb547',
          color: '#05070d'
        }
      }]
    })
    this.detector.reset()
  },

  /**
   * 用户点击"确认"按钮 — 开始等待传感器静止
   */
  onConfirm() {
    this.setData({
      waiting: true,
      statusText: '等待静止……'
    })
    this.waitingForStill = true
  },

  /**
   * 处理传感器数据包
   * 在等待静止状态时，将加速度和陀螺仪数据传入静止检测器
   * @param {object} pkt - 解析后的数据包 { acc: [x,y,z], gyro: [x,y,z] }
   */
  onPacket(pkt) {
    if (!this.waitingForStill) return

    const up = this.detector.update(pkt.acc, pkt.gyro)
    if (up) {
      // 检测到静止，记录 up 向量
      this.waitingForStill = false
      this.ups.push(up)

      const nextStep = this.data.step + 1
      if (nextStep < CALIBRATION_POINTS.length) {
        // 还有下一个点，短暂显示成功后跳转
        this.setData({
          recorded: true,
          waiting: false,
          statusText: '已记录 ✓'
        })
        setTimeout(() => this.showStep(nextStep), 800)
      } else {
        // 所有点都记录完毕，执行标定计算
        this.finishCalibration()
      }
    }
  },

  /**
   * 完成标定 — 运行 Wahba/SVD 算法并保存结果
   */
  finishCalibration() {
    const latlons = CALIBRATION_POINTS.map(p => ({ lat: p.lat, lon: p.lon }))
    const cal = calibrate(this.ups, latlons)

    // 构建 Calibration 实例并保存
    const calObj = new Calibration(cal.rotation, cal.sign, cal.rmsDeg)
    app.saveCalibration(calObj)

    const rmsDegStr = cal.rmsDeg.toFixed(2)
    const isWarn = cal.rmsDeg > RMS_WARN_DEG

    this.setData({
      done: true,
      step: CALIBRATION_POINTS.length,
      rmsDeg: rmsDegStr,
      rmsWarn: isWarn,
      waiting: false,
      recorded: false,
      statusText: isWarn
        ? `残差 ${rmsDegStr}°，超过 ${RMS_WARN_DEG}°，可能有标定点没放准`
        : `标定完成，残差 ${rmsDegStr}°`
    })
  },

  /**
   * 点击"开始使用" — 返回上一页
   */
  onStartUse() {
    wx.navigateBack()
  },

  /**
   * 点击"重新标定" — 重置所有数据，从头开始
   */
  onRecalibrate() {
    this.ups = []
    this.detector.reset()
    this.waitingForStill = false
    this.showStep(0)
    this.setData({ done: false })
  },

  /**
   * 页面卸载 — 移除 BLE 监听器，不断开连接
   */
  onUnload() {
    this.waitingForStill = false
    if (this.ble && this._onBlePacket) {
      this.ble.removePacketListener(this._onBlePacket)
    }
  }
})
