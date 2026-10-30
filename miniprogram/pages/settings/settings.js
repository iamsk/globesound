/**
 * globesound 设置页逻辑
 */

const app = getApp()

Page({
  data: {
    bleConnected: false,
    deviceName: '',
    deviceId: '',
    isCalibrated: false,
    rmsDeg: '0.00'
  },

  onLoad() {
    this.ble = app.globalData.ble
    this._onConnChange = (connected) => {
      this.setData({
        bleConnected: connected,
        deviceName: this.ble ? this.ble.deviceName || '' : '',
        deviceId: this.ble ? this.ble.deviceId || '' : ''
      })
    }
    if (this.ble) {
      this.ble.addConnectionListener(this._onConnChange)
    }
  },

  onShow() {
    this._syncState()
  },

  onUnload() {
    if (this.ble && this._onConnChange) {
      this.ble.removeConnectionListener(this._onConnChange)
    }
  },

  _syncState() {
    const ble = app.globalData.ble
    const cal = app.globalData.calibration

    this.setData({
      bleConnected: ble ? ble.connected : false,
      deviceName: ble ? ble.deviceName || '' : '',
      deviceId: ble ? ble.deviceId || '' : '',
      isCalibrated: !!cal,
      rmsDeg: cal && cal.rmsDeg != null ? cal.rmsDeg.toFixed(2) : '0.00'
    })
  },

  async onToggleBLE() {
    const ble = app.globalData.ble
    if (!ble) return

    if (this.data.bleConnected) {
      await ble.disconnect()
      this._syncState()
      wx.showToast({ title: '已断开连接', icon: 'none' })
    } else {
      wx.navigateBack() // 返回主页去点击连接
    }
  },

  onGoCalibrate() {
    wx.navigateTo({ url: '/pages/calibrate/calibrate' })
  },

  onClearCalib() {
    wx.showModal({
      title: '清除标定数据',
      content: '确定要清除当前的地球仪标定参数吗？清除后需重新标定才能计算坐标。',
      confirmColor: '#e74c3c',
      success: (res) => {
        if (res.confirm) {
          app.clearCalibration()
          this._syncState()
          wx.showToast({ title: '已清除标定', icon: 'success' })
        }
      }
    })
  }
})
