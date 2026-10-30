/**
 * witmotion.js — WitMotion BWT901BLECL BLE 数据解析器
 * 移植自 Python witmotion.py 模块
 * 适配微信小程序环境（使用 ArrayBuffer / DataView，不依赖 Node.js Buffer）
 */

// ========== BLE UUID 常量 ==========
/** BLE 服务 UUID */
const SERVICE_UUID = '0000FFE5-0000-1000-8000-00805F9A34FB'
/** BLE 通知特征值 UUID（用于接收数据） */
const NOTIFY_UUID = '0000FFE4-0000-1000-8000-00805F9A34FB'
/** BLE 写入特征值 UUID（用于发送命令） */
const WRITE_UUID = '0000FFE9-0000-1000-8000-00805F9A34FB'

// ========== 数据包常量 ==========
/** 数据包头部标识 */
const HEADER = [0x55, 0x61]
/** 数据包总长度（字节） */
const PACKET_LEN = 20
/** 加速度量程（±16g） */
const ACC_RANGE_G = 16.0
/** 陀螺仪量程（±2000°/s） */
const GYRO_RANGE_DPS = 2000.0
/** 角度量程（±180°） */
const ANGLE_RANGE_DEG = 180.0

/**
 * 解析单个20字节数据包
 * 
 * 数据包格式：
 *   [0x55, 0x61, accX_L, accX_H, accY_L, accY_H, accZ_L, accZ_H,
 *    gyroX_L, gyroX_H, gyroY_L, gyroY_H, gyroZ_L, gyroZ_H,
 *    angleX_L, angleX_H, angleY_L, angleY_H, angleZ_L, angleZ_H]
 * 
 * 每个值为 int16 小端序，缩放公式：真实值 = raw / 32768 * 量程
 * 
 * @param {ArrayBuffer} buffer - 20字节原始数据
 * @returns {object|null} 解析结果 { acc: [x,y,z], gyro: [x,y,z], angle: [x,y,z] }，无效包返回 null
 */
function parsePacket(buffer) {
  if (!buffer) return null

  let view
  if (buffer instanceof DataView) {
    view = buffer
  } else if (buffer instanceof ArrayBuffer) {
    if (buffer.byteLength < PACKET_LEN) return null
    view = new DataView(buffer)
  } else if (buffer.buffer instanceof ArrayBuffer) {
    if (buffer.byteLength < PACKET_LEN) return null
    view = new DataView(buffer.buffer, buffer.byteOffset || 0, buffer.byteLength)
  } else {
    return null
  }

  // 验证包头
  if (view.getUint8(0) !== HEADER[0] || view.getUint8(1) !== HEADER[1]) {
    return null
  }

  // 读取 9 个 int16 小端序值（从字节偏移 2 开始）
  const raw = []
  for (let i = 0; i < 9; i++) {
    raw.push(view.getInt16(2 + i * 2, true)) // true = 小端序
  }

  // 缩放得到真实物理值
  return {
    acc: [
      raw[0] / 32768.0 * ACC_RANGE_G,
      raw[1] / 32768.0 * ACC_RANGE_G,
      raw[2] / 32768.0 * ACC_RANGE_G
    ],
    gyro: [
      raw[3] / 32768.0 * GYRO_RANGE_DPS,
      raw[4] / 32768.0 * GYRO_RANGE_DPS,
      raw[5] / 32768.0 * GYRO_RANGE_DPS
    ],
    angle: [
      raw[6] / 32768.0 * ANGLE_RANGE_DEG,
      raw[7] / 32768.0 * ANGLE_RANGE_DEG,
      raw[8] / 32768.0 * ANGLE_RANGE_DEG
    ]
  }
}

/**
 * 流式数据包解析器
 * 处理 BLE 通知中的不定长数据，自动拼接和切分完整数据包
 * 
 * 使用方式：
 *   const parser = new PacketParser()
 *   // 每次收到 BLE 通知时：
 *   const packets = parser.feed(arrayBuffer)
 *   packets.forEach(p => console.log(p.acc))
 */
class PacketParser {
  constructor() {
    /** @type {Uint8Array} 内部缓冲区，存储尚未解析的字节 */
    this._buffer = new Uint8Array(0)
  }

  /**
   * 送入新的 BLE 数据，返回解析出的所有完整数据包
   * 
   * @param {ArrayBuffer} data - 从 BLE 通知收到的原始数据
   * @returns {Array<object>} 解析出的数据包数组，每项包含 { acc, gyro, angle }
   */
  feed(data) {
    if (!data || data.byteLength === 0) {
      return []
    }

    const incoming = new Uint8Array(data)

    // 将新数据追加到缓冲区
    const combined = new Uint8Array(this._buffer.length + incoming.length)
    combined.set(this._buffer, 0)
    combined.set(incoming, this._buffer.length)
    this._buffer = combined

    const packets = []

    // 在缓冲区中搜索数据包头 0x55 0x61
    let searchStart = 0
    while (searchStart <= this._buffer.length - PACKET_LEN) {
      // 找到下一个包头位置
      let headerPos = -1
      for (let i = searchStart; i <= this._buffer.length - PACKET_LEN; i++) {
        if (this._buffer[i] === HEADER[0] && this._buffer[i + 1] === HEADER[1]) {
          headerPos = i
          break
        }
      }

      if (headerPos < 0) {
        // 没找到更多包头，跳出循环
        break
      }

      // 检查是否有完整的 20 字节数据包
      if (headerPos + PACKET_LEN > this._buffer.length) {
        // 数据不完整，保留剩余数据等待下次拼接
        break
      }

      // 提取 20 字节并解析
      const packetBytes = this._buffer.slice(headerPos, headerPos + PACKET_LEN)
      const parsed = parsePacket(packetBytes.buffer)
      if (parsed) {
        packets.push(parsed)
      }

      // 移动搜索起点到本包之后
      searchStart = headerPos + PACKET_LEN
    }

    // 保留未处理的尾部数据（可能是不完整的包）
    if (searchStart > 0) {
      this._buffer = this._buffer.slice(searchStart)
    }

    // 防止缓冲区过大（丢弃过旧的无效数据）
    if (this._buffer.length > PACKET_LEN * 20) {
      // 只保留最后可能包含有效数据的部分
      this._buffer = this._buffer.slice(this._buffer.length - PACKET_LEN * 2)
      console.warn('[WitMotion] 缓冲区过大，已截断')
    }

    return packets
  }

  /**
   * 清空内部缓冲区
   */
  reset() {
    this._buffer = new Uint8Array(0)
  }
}

/**
 * 判断设备名是否像 WitMotion 传感器
 * WitMotion 蓝牙设备名通常以 "WT" 开头
 * 
 * @param {string} name - 蓝牙设备广播名称
 * @returns {boolean}
 */
function looksLikeWitmotion(name) {
  if (!name || typeof name !== 'string') {
    return false
  }
  return name.toUpperCase().startsWith('WT')
}

module.exports = {
  // UUID 常量
  SERVICE_UUID,
  NOTIFY_UUID,
  WRITE_UUID,
  // 数据包常量
  HEADER,
  PACKET_LEN,
  ACC_RANGE_G,
  GYRO_RANGE_DPS,
  ANGLE_RANGE_DEG,
  // 函数和类
  parsePacket,
  PacketParser,
  looksLikeWitmotion
}
