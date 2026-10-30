/**
 * ble.js — 微信小程序 BLE 连接管理器
 * 封装微信蓝牙 API，专用于连接 WitMotion BWT901BLECL IMU 传感器
 */

const { PacketParser, looksLikeWitmotion, SERVICE_UUID, NOTIFY_UUID } = require('./witmotion')

/**
 * BLE 连接管理器
 * 
 * 使用方式：
 *   const ble = new BLEManager()
 *   await ble.init()
 *   const devices = await ble.scan()
 *   await ble.connect(devices[0].deviceId)
 *   ble.onPacket = (packet) => { console.log(packet.acc) }
 *   // ...
 *   await ble.disconnect()
 *   await ble.destroy()
 */
class BLEManager {
  constructor() {
    /** @type {string|null} 已连接设备的名称 */
    this.deviceName = null
    /** @type {string|null} 已连接设备的 ID */
    this.deviceId = null
    /** @type {string|null} 已匹配的 BLE 服务 UUID */
    this.serviceId = null
    /** @type {string|null} 已匹配的 BLE 通知特征值 UUID */
    this.characteristicId = null
    /** @type {boolean} 连接状态 */
    this.connected = false
    /** @type {PacketParser} 数据包解析器 */
    this.parser = new PacketParser()
    /** @type {Function|null} 数据包回调 (packet) => void */
    this.onPacket = null
    /** @type {Function|null} 连接状态变化回调 (connected: boolean) => void */
    this.onConnectionChange = null
    /** @type {Function|null} 适配器状态变化回调 (available: boolean) => void */
    this.onAdapterChange = null

    /** @type {Set<Function>} 多监听器集合 */
    this._packetListeners = new Set()
    this._connectionListeners = new Set()

    // 绑定内部回调（确保 this 指向正确）
    this._onCharValueChange = this._handleCharValueChange.bind(this)
    this._onConnectionStateChange = this._handleConnectionStateChange.bind(this)
    this._onAdapterStateChange = this._handleAdapterStateChange.bind(this)
  }

  addPacketListener(fn) {
    if (typeof fn === 'function') {
      this._packetListeners.add(fn)
    }
  }

  removePacketListener(fn) {
    this._packetListeners.delete(fn)
  }

  addConnectionListener(fn) {
    if (typeof fn === 'function') {
      this._connectionListeners.add(fn)
    }
  }

  removeConnectionListener(fn) {
    this._connectionListeners.delete(fn)
  }

  /**
   * 初始化蓝牙适配器
   * 必须在使用其他蓝牙 API 前调用
   * 
   * @returns {Promise<void>}
   * @throws {Error} 蓝牙不可用时抛出
   */
  init() {
    return new Promise((resolve, reject) => {
      wx.openBluetoothAdapter({
        mode: 'central',
        success: () => {
          console.log('[BLE] 蓝牙适配器已初始化')
          // 监听适配器状态变化
          wx.onBluetoothAdapterStateChange(this._onAdapterStateChange)
          // 监听连接状态变化
          wx.onBLEConnectionStateChange(this._onConnectionStateChange)
          resolve()
        },
        fail: (err) => {
          console.error('[BLE] 初始化蓝牙适配器失败:', err)
          reject(err)
        }
      })
    })
  }

  /**
   * 扫描 WitMotion 设备
   * 
   * @param {number} timeout - 扫描超时时间（毫秒），默认8000
   * @returns {Promise<Array<{deviceId: string, name: string, RSSI: number}>>}
   */
  scan(timeout = 8000) {
    return new Promise((resolve, reject) => {
      /** @type {Map<string, {deviceId: string, name: string, RSSI: number}>} */
      const foundDevices = new Map()

      // 设备发现回调
      const onDeviceFound = (res) => {
        const devices = res.devices || []
        for (const device of devices) {
          // 获取设备名称（可能在 name 或 localName 字段）
          const name = device.name || device.localName || ''
          if (looksLikeWitmotion(name) && !foundDevices.has(device.deviceId)) {
            const info = {
              deviceId: device.deviceId,
              name: name,
              RSSI: device.RSSI
            }
            foundDevices.set(device.deviceId, info)
            console.log('[BLE] 发现 WitMotion 设备:', name, device.deviceId)
          }
        }
      }

      // 注册设备发现监听
      wx.onBluetoothDeviceFound(onDeviceFound)

      // 开始扫描
      wx.startBluetoothDevicesDiscovery({
        allowDuplicatesKey: false,
        powerLevel: 'high',
        success: () => {
          console.log('[BLE] 开始扫描设备...')
        },
        fail: (err) => {
          wx.offBluetoothDeviceFound(onDeviceFound)
          reject(err)
          return
        }
      })

      // 超时后停止扫描并返回结果
      setTimeout(() => {
        wx.stopBluetoothDevicesDiscovery({
          success: () => {
            console.log('[BLE] 扫描结束')
          }
        })
        wx.offBluetoothDeviceFound(onDeviceFound)
        const result = Array.from(foundDevices.values())
        // 按信号强度排序（RSSI 越大越近）
        result.sort((a, b) => b.RSSI - a.RSSI)
        resolve(result)
      }, timeout)
    })
  }

  /**
   * 连接到指定的 BLE 设备
   * 
   * 连接流程：
   * 1. 建立 BLE 连接
   * 2. 发现服务，匹配 FFE5 服务
   * 3. 发现特征值，匹配 FFE4 通知特征值
   * 4. 启用通知，开始接收数据
   * 
   * @param {string} deviceId - 设备 ID
   * @returns {Promise<void>}
   */
  async connect(deviceId, deviceName = null) {
    try {
      // 步骤1: 建立连接
      await this._createConnection(deviceId)
      this.deviceId = deviceId
      this.deviceName = deviceName || 'WT901BLE'
      console.log('[BLE] 连接成功:', deviceId, this.deviceName)

      // 步骤2: 发现服务
      const serviceId = await this._discoverService(deviceId)
      this.serviceId = serviceId
      console.log('[BLE] 找到服务:', serviceId)

      // 步骤3: 发现通知特征值
      const charId = await this._discoverCharacteristic(deviceId, serviceId)
      this.characteristicId = charId
      console.log('[BLE] 找到通知特征值:', charId)

      // 步骤4: 启用通知
      await this._enableNotify(deviceId, serviceId, charId)
      console.log('[BLE] 通知已启用，开始接收数据')

      // 注册数据接收回调
      wx.onBLECharacteristicValueChange(this._onCharValueChange)

      // 重置解析器
      this.parser.reset()
      this.connected = true

      // 触发连接回调
      if (this.onConnectionChange) {
        this.onConnectionChange(true)
      }
      for (const fn of this._connectionListeners) {
        try { fn(true) } catch (e) { console.error(e) }
      }
    } catch (err) {
      // 连接失败时清理
      console.error('[BLE] 连接流程失败:', err)
      this._cleanup()
      throw err
    }
  }

  /**
   * 断开 BLE 连接
   * @returns {Promise<void>}
   */
  disconnect() {
    return new Promise((resolve) => {
      if (!this.deviceId) {
        resolve()
        return
      }

      // 取消数据接收监听
      wx.offBLECharacteristicValueChange(this._onCharValueChange)

      wx.closeBLEConnection({
        deviceId: this.deviceId,
        success: () => {
          console.log('[BLE] 已断开连接')
        },
        fail: (err) => {
          console.warn('[BLE] 断开连接异常:', err)
        },
        complete: () => {
          this._cleanup()
          resolve()
        }
      })
    })
  }

  /**
   * 销毁蓝牙适配器，释放所有资源
   * @returns {Promise<void>}
   */
  async destroy() {
    await this.disconnect()
    return new Promise((resolve) => {
      // 取消全局监听
      wx.offBluetoothAdapterStateChange(this._onAdapterStateChange)
      wx.offBLEConnectionStateChange(this._onConnectionStateChange)

      wx.closeBluetoothAdapter({
        success: () => {
          console.log('[BLE] 蓝牙适配器已关闭')
        },
        fail: (err) => {
          console.warn('[BLE] 关闭蓝牙适配器异常:', err)
        },
        complete: () => {
          resolve()
        }
      })
    })
  }

  // ========== 内部方法 ==========

  /**
   * 建立 BLE 连接
   * @private
   */
  _createConnection(deviceId) {
    return new Promise((resolve, reject) => {
      wx.createBLEConnection({
        deviceId: deviceId,
        timeout: 10000,
        success: resolve,
        fail: reject
      })
    })
  }

  /**
   * 发现并匹配 WitMotion 的 BLE 服务
   * 微信返回的 UUID 大小写不确定，需要不区分大小写比较
   * @private
   */
  _discoverService(deviceId) {
    return new Promise((resolve, reject) => {
      // 某些设备需要延迟才能发现服务
      setTimeout(() => {
        wx.getBLEDeviceServices({
          deviceId: deviceId,
          success: (res) => {
            const services = res.services || []
            console.log('[BLE] 发现服务列表:', services.map(s => s.uuid))

            // 不区分大小写匹配 FFE5 服务
            const target = SERVICE_UUID.toUpperCase()
            const matched = services.find(
              s => s.uuid.toUpperCase() === target
            )

            if (matched) {
              resolve(matched.uuid)
            } else {
              reject(new Error('未找到 WitMotion 服务 (FFE5)'))
            }
          },
          fail: reject
        })
      }, 500)
    })
  }

  /**
   * 发现并匹配通知特征值
   * @private
   */
  _discoverCharacteristic(deviceId, serviceId) {
    return new Promise((resolve, reject) => {
      wx.getBLEDeviceCharacteristics({
        deviceId: deviceId,
        serviceId: serviceId,
        success: (res) => {
          const chars = res.characteristics || []
          console.log('[BLE] 发现特征值列表:', chars.map(c => ({
            uuid: c.uuid,
            properties: c.properties
          })))

          // 不区分大小写匹配 FFE4 通知特征值
          const target = NOTIFY_UUID.toUpperCase()
          const matched = chars.find(
            c => c.uuid.toUpperCase() === target
          )

          if (matched) {
            resolve(matched.uuid)
          } else {
            // 若精确匹配失败，尝试查找带 notify 属性的特征值
            const notifyChar = chars.find(c => c.properties && c.properties.notify)
            if (notifyChar) {
              console.warn('[BLE] UUID 不匹配，使用 notify 特征值:', notifyChar.uuid)
              resolve(notifyChar.uuid)
            } else {
              reject(new Error('未找到通知特征值 (FFE4)'))
            }
          }
        },
        fail: reject
      })
    })
  }

  /**
   * 启用 BLE 特征值通知
   * @private
   */
  _enableNotify(deviceId, serviceId, characteristicId) {
    return new Promise((resolve, reject) => {
      wx.notifyBLECharacteristicValueChange({
        deviceId: deviceId,
        serviceId: serviceId,
        characteristicId: characteristicId,
        state: true,
        type: 'notification',
        success: resolve,
        fail: reject
      })
    })
  }

  /**
   * 处理特征值变化（接收传感器数据）
   * @private
   */
  _handleCharValueChange(res) {
    // 确认是来自我们设备的数据
    if (res.deviceId !== this.deviceId) {
      return
    }

    // 将数据送入解析器
    const packets = this.parser.feed(res.value)

    // 回调每个解析出的数据包
    if (packets.length > 0) {
      for (const packet of packets) {
        if (this.onPacket) {
          this.onPacket(packet)
        }
        for (const fn of this._packetListeners) {
          try { fn(packet) } catch (e) { console.error(e) }
        }
      }
    }
  }

  /**
   * 处理 BLE 连接状态变化
   * @private
   */
  _handleConnectionStateChange(res) {
    if (res.deviceId !== this.deviceId) {
      return
    }

    console.log('[BLE] 连接状态变化:', res.connected ? '已连接' : '已断开')

    if (!res.connected) {
      // 设备断开连接
      this.connected = false
      this.parser.reset()

      // 取消数据接收监听
      wx.offBLECharacteristicValueChange(this._onCharValueChange)

      if (this.onConnectionChange) {
        this.onConnectionChange(false)
      }
      for (const fn of this._connectionListeners) {
        try { fn(false) } catch (e) { console.error(e) }
      }
    }
  }

  /**
   * 处理蓝牙适配器状态变化
   * @private
   */
  _handleAdapterStateChange(res) {
    console.log('[BLE] 适配器状态变化:', res.available ? '可用' : '不可用')

    if (this.onAdapterChange) {
      this.onAdapterChange(res.available)
    }

    // 适配器不可用时标记断开
    if (!res.available && this.connected) {
      this.connected = false
      this.parser.reset()
      if (this.onConnectionChange) {
        this.onConnectionChange(false)
      }
    }
  }

  /**
   * 清理内部状态
   * @private
   */
  _cleanup() {
    this.deviceId = null
    this.deviceName = null
    this.serviceId = null
    this.characteristicId = null
    this.connected = false
    this.parser.reset()
    for (const fn of this._connectionListeners) {
      try { fn(false) } catch (e) { console.error(e) }
    }
  }
}

module.exports = BLEManager
