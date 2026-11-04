/**
  globesound 设置页逻辑
  支持：查看当前经纬度坐标与数据来源、传感器电量、重标定、连接管理与最近读数历史
*/

const app = getApp()

Page({
  data: {
    bleConnected: false,
    deviceName: '',
    deviceId: '',
    batteryLevel: null,
    batteryIcon: '🔋',
    batteryClass: '',
    isCalibrated: false,
    rmsDeg: '0.00',
    coordText: '—',
    sourceText: '未连接',
    fixes: []
  },

  onLoad() {
    this.ble = app.globalData.ble
    this._onConnChange = () => {
      this._syncState()
    }
    this._onBatChange = () => {
      this._syncState()
    }
    if (this.ble) {
      this.ble.addConnectionListener(this._onConnChange)
      this.ble.addBatteryListener(this._onBatChange)
    }
  },

  onShow() {
    this._syncState()
    // 进入设置页时主动下发一次查电量
    if (this.ble && this.ble.connected) {
      this.ble.queryBattery()
    }
  },

  onUnload() {
    if (this.ble) {
      if (this._onConnChange) this.ble.removeConnectionListener(this._onConnChange)
      if (this._onBatChange) this.ble.removeBatteryListener(this._onBatChange)
    }
  },

  _syncState() {
    const ble = app.globalData.ble
    const cal = app.globalData.calibration
    const bat = ble && ble.battery !== null ? ble.battery : app.globalData.batteryLevel

    let batCls = ''
    let batIcon = '🔋'
    if (bat !== null && bat !== undefined) {
      if (bat < 20) {
        batCls = 'low'
        batIcon = '🪫'
      } else if (bat < 50) {
        batCls = 'medium'
        batIcon = '🔋'
      } else {
        batCls = 'good'
        batIcon = '🔋'
      }
    }

    this.setData({
      bleConnected: ble ? ble.connected : false,
      deviceName: ble ? ble.deviceName || '' : '',
      deviceId: ble ? ble.deviceId || '' : '',
      batteryLevel: bat,
      batteryClass: batCls,
      batteryIcon: batIcon,
      isCalibrated: !!cal,
      rmsDeg: cal && cal.rmsDeg != null ? cal.rmsDeg.toFixed(2) : '0.00',
      coordText: app.globalData.coordText || '—',
      sourceText: app.globalData.sourceText || (ble && ble.connected ? 'BWT901BLECL' : '未连接'),
      fixes: app.globalData.fixes || []
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
