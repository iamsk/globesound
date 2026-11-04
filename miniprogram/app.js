const BLEManager = require('./utils/ble')
const { Calibration } = require('./utils/geo')

/**
 * globesound 小程序入口
 * 地球仪蓝牙音频项目 —— 通过 BLE IMU 传感器读取地球仪朝向，播放对应位置的电台
 */
App({
  globalData: {
    /** @type {Calibration|null} 校准数据 */
    calibration: null,
    /** @type {BLEManager} 全局BLE管理器 */
    ble: null,
    /** @type {number|null} 传感器电量 */
    batteryLevel: null,
    /** @type {string} 当前坐标文本 */
    coordText: '—',
    /** @type {string} 数据源文本 */
    sourceText: '未连接',
    /** @type {Array} 最近读数记录 */
    fixes: []
  },

  /**
   * 小程序启动时，从本地存储恢复校准数据并创建全局 BLE 管理器
   */
  onLaunch() {
    // 解除 iOS 静音开关静音，允许媒体在任何模式下发声
    try {
      if (wx.setInnerAudioOption) {
        wx.setInnerAudioOption({
          obeyMuteSwitch: false,
          mixWithOther: true
        })
      }
    } catch (e) {
      console.warn('[App] 设置音频选项异常:', e)
    }

    this.globalData.ble = new BLEManager()

    try {
      const calData = wx.getStorageSync('globe_calib')
      if (calData) {
        this.globalData.calibration = Calibration.fromJSON(calData)
        console.log('[App] 已从本地存储恢复校准数据')
      }
    } catch (e) {
      console.warn('[App] 恢复校准数据失败:', e)
    }
  },

  /**
   * 保存校准数据到本地存储和 globalData
   * @param {object} cal - Calibration 实例
   */
  saveCalibration(cal) {
    this.globalData.calibration = cal
    try {
      wx.setStorageSync('globe_calib', cal.toJSON())
      console.log('[App] 校准数据已保存')
    } catch (e) {
      console.error('[App] 保存校准数据失败:', e)
    }
  },

  /**
   * 清除校准数据
   */
  clearCalibration() {
    this.globalData.calibration = null
    try {
      wx.removeStorageSync('globe_calib')
      console.log('[App] 校准数据已清除')
    } catch (e) {
      console.error('[App] 清除校准数据失败:', e)
    }
  }
})
