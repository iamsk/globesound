/**
 * geo.js — 地球仪坐标校准与几何计算模块
 * 移植自 Python geo.py，纯数学实现，无外部依赖
 * 适配微信小程序环境
 */

// ========== 常量 ==========

/** 校准用的参考地理点 */
const CALIBRATION_POINTS = [
  { name: '北极', lat: 90.0, lon: 0.0 },
  { name: '几内亚湾：赤道和本初子午线的交点 (0°, 0°)', lat: 0.0, lon: 0.0 },
  { name: '新加坡', lat: 1.35, lon: 103.82 },
  { name: '悉尼', lat: -33.87, lon: 151.21 }
]

/** 校准误差警告阈值（度） */
const RMS_WARN_DEG = 3.0

// ========== 向量与矩阵基础运算 ==========

/**
 * 向量点积
 * @param {number[]} a - 3维向量
 * @param {number[]} b - 3维向量
 * @returns {number}
 */
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

/**
 * 向量模长
 * @param {number[]} v - 3维向量
 * @returns {number}
 */
function norm(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
}

/**
 * 向量归一化
 * @param {number[]} v - 3维向量
 * @returns {number[]} 单位向量
 */
function normalize(v) {
  const n = norm(v)
  if (n < 1e-12) {
    return [0, 0, 0]
  }
  return [v[0] / n, v[1] / n, v[2] / n]
}

/**
 * 矩阵-向量乘法（3x3 矩阵 × 3维向量）
 * @param {number[][]} A - 3x3矩阵
 * @param {number[]} v - 3维向量
 * @returns {number[]} 结果向量
 */
function matMul(A, v) {
  return [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2]
  ]
}

/**
 * 矩阵-矩阵乘法（3x3 × 3x3）
 * @param {number[][]} A - 3x3矩阵
 * @param {number[][]} B - 3x3矩阵
 * @returns {number[][]} 3x3结果矩阵
 */
function matMulMat(A, B) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0
      for (let k = 0; k < 3; k++) {
        sum += A[i][k] * B[k][j]
      }
      C[i][j] = sum
    }
  }
  return C
}

/**
 * 矩阵转置（3x3）
 * @param {number[][]} A - 3x3矩阵
 * @returns {number[][]} 转置矩阵
 */
function transpose(A) {
  return [
    [A[0][0], A[1][0], A[2][0]],
    [A[0][1], A[1][1], A[2][1]],
    [A[0][2], A[1][2], A[2][2]]
  ]
}

/**
 * 向量外积（3维 × 3维 → 3x3矩阵）
 * @param {number[]} a - 3维向量
 * @param {number[]} b - 3维向量
 * @returns {number[][]} 3x3矩阵 a * b^T
 */
function outerProduct(a, b) {
  return [
    [a[0] * b[0], a[0] * b[1], a[0] * b[2]],
    [a[1] * b[0], a[1] * b[1], a[1] * b[2]],
    [a[2] * b[0], a[2] * b[1], a[2] * b[2]]
  ]
}

/**
 * 3x3 矩阵行列式
 * @param {number[][]} M - 3x3矩阵
 * @returns {number}
 */
function det3x3(M) {
  return (
    M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
    M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
    M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0])
  )
}

// ========== 坐标转换 ==========

/**
 * 经纬度转单位向量（ECEF 笛卡尔坐标）
 * @param {number} lat - 纬度（度）
 * @param {number} lon - 经度（度）
 * @returns {number[]} [x, y, z] 单位向量
 */
function latlonToVec(lat, lon) {
  const latRad = lat * Math.PI / 180.0
  const lonRad = lon * Math.PI / 180.0
  const cosLat = Math.cos(latRad)
  return [
    cosLat * Math.cos(lonRad),
    cosLat * Math.sin(lonRad),
    Math.sin(latRad)
  ]
}

/**
 * 单位向量转经纬度
 * @param {number[]} v - 3维向量（会先归一化）
 * @returns {{lat: number, lon: number}} 纬度和经度（度）
 */
function vecToLatlon(v) {
  const u = normalize(v)
  // clamp 防止 asin 参数超出 [-1, 1] 导致 NaN
  const z = Math.max(-1, Math.min(1, u[2]))
  const lat = Math.asin(z) * 180.0 / Math.PI
  const lon = Math.atan2(u[1], u[0]) * 180.0 / Math.PI
  return { lat, lon }
}

/**
 * 两个向量之间的夹角（度）
 * @param {number[]} a - 3维向量
 * @param {number[]} b - 3维向量
 * @returns {number} 角度（度）
 */
function angleDeg(a, b) {
  const na = normalize(a)
  const nb = normalize(b)
  let d = dot(na, nb)
  // clamp 防止浮点误差导致 acos 参数超出 [-1, 1]
  d = Math.max(-1, Math.min(1, d))
  return Math.acos(d) * 180.0 / Math.PI
}

// ========== SVD 分解（Jacobi 方法） ==========

/**
 * 创建 3x3 单位矩阵
 * @returns {number[][]}
 */
function eye3() {
  return [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ]
}

/**
 * 复制 3x3 矩阵
 * @param {number[][]} M
 * @returns {number[][]}
 */
function copyMat(M) {
  return [
    [M[0][0], M[0][1], M[0][2]],
    [M[1][0], M[1][1], M[1][2]],
    [M[2][0], M[2][1], M[2][2]]
  ]
}

/**
 * 对称矩阵的 Jacobi 特征值分解
 * 
 * 对 3x3 对称矩阵 S 进行特征值分解 S = V * diag(eigenvalues) * V^T
 * 使用经典 Jacobi 旋转消去非对角元素
 * 
 * @param {number[][]} S - 3x3 对称矩阵
 * @returns {{ eigenvalues: number[], V: number[][] }} 特征值和特征向量矩阵
 */
function jacobiEigen(S) {
  const A = copyMat(S)
  const V = eye3()
  const maxIter = 100

  for (let iter = 0; iter < maxIter; iter++) {
    // 找最大的非对角元素
    let maxVal = 0
    let p = 0
    let q = 1
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        if (Math.abs(A[i][j]) > maxVal) {
          maxVal = Math.abs(A[i][j])
          p = i
          q = j
        }
      }
    }

    // 收敛判断
    if (maxVal < 1e-12) {
      break
    }

    // 计算 Jacobi 旋转角
    const app = A[p][p]
    const aqq = A[q][q]
    const apq = A[p][q]

    let theta
    if (Math.abs(app - aqq) < 1e-15) {
      theta = Math.PI / 4
    } else {
      theta = 0.5 * Math.atan2(2 * apq, app - aqq)
    }

    const c = Math.cos(theta)
    const s = Math.sin(theta)

    // 构造旋转矩阵并应用 A' = G^T * A * G
    // 先更新 A 矩阵的相关行列
    const newApp = c * c * app + 2 * s * c * apq + s * s * aqq
    const newAqq = s * s * app - 2 * s * c * apq + c * c * aqq
    const newApq = 0  // Jacobi 旋转的目标

    A[p][p] = newApp
    A[q][q] = newAqq
    A[p][q] = newApq
    A[q][p] = newApq

    // 更新其余行列
    for (let r = 0; r < 3; r++) {
      if (r === p || r === q) continue

      const arp = A[r][p]
      const arq = A[r][q]
      A[r][p] = c * arp + s * arq
      A[p][r] = A[r][p]
      A[r][q] = -s * arp + c * arq
      A[q][r] = A[r][q]
    }

    // 更新特征向量矩阵 V
    for (let r = 0; r < 3; r++) {
      const vrp = V[r][p]
      const vrq = V[r][q]
      V[r][p] = c * vrp + s * vrq
      V[r][q] = -s * vrp + c * vrq
    }
  }

  // 提取特征值（对角线元素）
  const eigenvalues = [A[0][0], A[1][1], A[2][2]]

  return { eigenvalues, V }
}

/**
 * 3x3 矩阵的 SVD 分解
 * 
 * 实现步骤：
 * 1. 计算 H^T * H（对称正半定矩阵）
 * 2. 对 H^T * H 进行 Jacobi 特征值分解，得到 V 和特征值
 * 3. 奇异值 = sqrt(特征值)
 * 4. U = H * V * diag(1/sigma)
 * 
 * @param {number[][]} H - 3x3 矩阵
 * @returns {{ U: number[][], S: number[], Vt: number[][] }}
 *   U: 3x3 左奇异向量矩阵
 *   S: 长度3的奇异值数组（降序）
 *   Vt: 3x3 右奇异向量矩阵的转置
 */
function svd3x3(H) {
  // 步骤1: 计算 H^T * H
  const Ht = transpose(H)
  const HtH = matMulMat(Ht, H)

  // 步骤2: 特征值分解 H^T * H = V * diag(lambda) * V^T
  const { eigenvalues, V } = jacobiEigen(HtH)

  // 按特征值降序排列（确保奇异值降序）
  const indices = [0, 1, 2]
  indices.sort((a, b) => eigenvalues[b] - eigenvalues[a])

  const sortedEig = indices.map(i => eigenvalues[i])
  // 重排 V 的列
  const sortedV = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let r = 0; r < 3; r++) {
    for (let ci = 0; ci < 3; ci++) {
      sortedV[r][ci] = V[r][indices[ci]]
    }
  }

  // 步骤3: 奇异值 = sqrt(max(0, lambda))
  const sigma = sortedEig.map(e => Math.sqrt(Math.max(0, e)))

  // 步骤4: U = H * V * diag(1/sigma)
  // 先计算 H * V
  const HV = matMulMat(H, sortedV)

  // 归一化各列得到 U（处理奇异值为零的情况）
  const U = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let j = 0; j < 3; j++) {
    if (sigma[j] > 1e-10) {
      const invSigma = 1.0 / sigma[j]
      for (let i = 0; i < 3; i++) {
        U[i][j] = HV[i][j] * invSigma
      }
    } else {
      // 奇异值为零，需要构造正交补空间的向量
      // 使用叉积从已有的 U 列生成
      if (j === 0) {
        U[0][j] = 1; U[1][j] = 0; U[2][j] = 0
      } else if (j === 1) {
        // 与第一列正交
        const u0 = [U[0][0], U[1][0], U[2][0]]
        // 选一个不平行的向量来叉积
        let seed = [1, 0, 0]
        if (Math.abs(dot(u0, seed)) > 0.9) {
          seed = [0, 1, 0]
        }
        // 叉积
        const cross = [
          u0[1] * seed[2] - u0[2] * seed[1],
          u0[2] * seed[0] - u0[0] * seed[2],
          u0[0] * seed[1] - u0[1] * seed[0]
        ]
        const cn = normalize(cross)
        U[0][j] = cn[0]; U[1][j] = cn[1]; U[2][j] = cn[2]
      } else {
        // j === 2: 叉积 U[:,0] 和 U[:,1]
        const u0 = [U[0][0], U[1][0], U[2][0]]
        const u1 = [U[0][1], U[1][1], U[2][1]]
        const cross = [
          u0[1] * u1[2] - u0[2] * u1[1],
          u0[2] * u1[0] - u0[0] * u1[2],
          u0[0] * u1[1] - u0[1] * u1[0]
        ]
        const cn = normalize(cross)
        U[0][j] = cn[0]; U[1][j] = cn[1]; U[2][j] = cn[2]
      }
    }
  }

  const Vt = transpose(sortedV)

  return { U, S: sigma, Vt }
}

// ========== Wahba 问题求解 ==========

/**
 * 求解旋转矩阵（Wahba 问题）
 * 
 * 给定若干对应点对 (src[i] → dst[i])，求最优旋转矩阵 R 使得 R * src[i] ≈ dst[i]
 * 
 * 方法：SVD 分解
 *   H = Σ dst[i] * src[i]^T
 *   H = U * S * Vt
 *   d = sign(det(U) * det(Vt))
 *   R = U * diag(1, 1, d) * Vt
 * 
 * @param {number[][]} src - 源点向量数组
 * @param {number[][]} dst - 目标点向量数组
 * @returns {number[][]} 3x3 旋转矩阵
 */
function solveRotation(src, dst) {
  // 构建 H 矩阵
  const H = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
  for (let k = 0; k < src.length; k++) {
    const op = outerProduct(dst[k], src[k])
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        H[i][j] += op[i][j]
      }
    }
  }

  // SVD 分解
  const { U, S, Vt } = svd3x3(H)

  // 确保正确的旋转（det(R) = +1）
  const d = Math.sign(det3x3(U) * det3x3(Vt))

  // R = U * diag(1, 1, d) * Vt
  const D = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, d]
  ]

  return matMulMat(matMulMat(U, D), Vt)
}

// ========== 校准 ==========

/**
 * 执行校准
 * 
 * 给定多组传感器"向上"向量和对应的地理经纬度，求解旋转矩阵
 * 自动尝试 sign=+1 和 sign=-1 两种情况，选择误差更小的
 * 
 * @param {number[][]} upsSensor - 传感器坐标系下的"向上"单位向量数组
 * @param {{lat: number, lon: number}[]} latlons - 对应的地理经纬度数组
 * @returns {{ rotation: number[][], sign: number, rmsDeg: number }}
 */
function calibrate(upsSensor, latlons) {
  // 将地理坐标转为单位向量
  const geoVecs = latlons.map(ll => latlonToVec(ll.lat, ll.lon))

  let bestResult = null
  let bestRms = Infinity

  // 尝试两种符号
  for (const sign of [1, -1]) {
    // 应用符号到传感器向量
    const srcVecs = upsSensor.map(v => [v[0] * sign, v[1] * sign, v[2] * sign])

    // 求解旋转
    const R = solveRotation(srcVecs, geoVecs)

    // 计算 RMS 误差
    let sumSqErr = 0
    for (let i = 0; i < srcVecs.length; i++) {
      const predicted = matMul(R, srcVecs[i])
      const errDeg = angleDeg(predicted, geoVecs[i])
      sumSqErr += errDeg * errDeg
    }
    const rms = Math.sqrt(sumSqErr / srcVecs.length)

    if (rms < bestRms) {
      bestRms = rms
      bestResult = { rotation: R, sign: sign, rmsDeg: rms }
    }
  }

  return bestResult
}

// ========== 校准对象 ==========

/**
 * 校准数据封装
 * 保存旋转矩阵和符号，提供传感器→经纬度的转换方法
 */
class Calibration {
  /**
   * @param {number[][]} rotation - 3x3 旋转矩阵
   * @param {number} sign - 传感器符号 (+1 或 -1)
   * @param {number} rmsDeg - 校准 RMS 误差（度）
   */
  constructor(rotation, sign, rmsDeg) {
    this.rotation = rotation
    this.sign = sign
    this.rmsDeg = rmsDeg
  }

  /**
   * 将传感器"向上"向量转换为经纬度
   * @param {number[]} upSensor - 传感器坐标系下的"向上"单位向量
   * @returns {{lat: number, lon: number}}
   */
  toLatlon(upSensor) {
    const signed = [
      upSensor[0] * this.sign,
      upSensor[1] * this.sign,
      upSensor[2] * this.sign
    ]
    const geoVec = matMul(this.rotation, signed)
    return vecToLatlon(geoVec)
  }

  /**
   * 序列化为 JSON 可存储的对象
   * @returns {object}
   */
  toJSON() {
    return {
      rotation: this.rotation,
      sign: this.sign,
      rmsDeg: this.rmsDeg
    }
  }

  /**
   * 从 JSON 对象反序列化
   * @param {object} obj - 包含 rotation, sign, rmsDeg 的对象
   * @returns {Calibration}
   */
  static fromJSON(obj) {
    return new Calibration(obj.rotation, obj.sign, obj.rmsDeg)
  }
}

// ========== 静止检测器 ==========

/**
 * 传感器静止检测器
 * 通过检测陀螺仪和加速度计数据判断设备是否静止
 * 静止时返回平均的"向上"方向向量
 */
class StillDetector {
  /**
   * @param {number} gyroMaxDps - 陀螺仪静止阈值（度/秒），默认3.0
   * @param {number} accTolG - 加速度计容差（g），默认0.05
   * @param {number} window - 静止采样窗口大小，默认10
   */
  constructor(gyroMaxDps = 3.0, accTolG = 0.05, window = 10) {
    this.gyroMaxDps = gyroMaxDps
    this.accTolG = accTolG
    this.window = window
    /** @type {number[][]} 环形缓冲区，存储归一化后的加速度向量 */
    this._samples = []
  }

  /**
   * 清空采样缓冲区
   */
  reset() {
    this._samples = []
  }

  /**
   * 更新一组传感器数据
   * 
   * @param {number[]} acc - 加速度向量 [x, y, z]（单位：g）
   * @param {number[]} gyro - 陀螺仪向量 [x, y, z]（单位：°/s）
   * @returns {number[]|null} 静止时返回平均"向上"单位向量，否则返回 null
   */
  update(acc, gyro) {
    // 检查陀螺仪是否足够安静
    const gyroStill = (
      Math.abs(gyro[0]) < this.gyroMaxDps &&
      Math.abs(gyro[1]) < this.gyroMaxDps &&
      Math.abs(gyro[2]) < this.gyroMaxDps
    )

    // 检查加速度计模长是否接近 1g
    const accNorm = norm(acc)
    const accOk = Math.abs(accNorm - 1.0) < this.accTolG

    if (!gyroStill || !accOk) {
      // 不静止，清空采样
      this._samples = []
      return null
    }

    // 静止状态：将归一化的加速度向量加入缓冲区
    const normalizedAcc = normalize(acc)
    this._samples.push(normalizedAcc)

    // 限制缓冲区大小（环形行为：丢弃最旧的）
    if (this._samples.length > this.window) {
      this._samples.shift()
    }

    // 缓冲区未满时返回 null
    if (this._samples.length < this.window) {
      return null
    }

    // 计算所有样本的平均值并归一化
    const mean = [0, 0, 0]
    for (const s of this._samples) {
      mean[0] += s[0]
      mean[1] += s[1]
      mean[2] += s[2]
    }
    mean[0] /= this._samples.length
    mean[1] /= this._samples.length
    mean[2] /= this._samples.length

    return normalize(mean)
  }
}

module.exports = {
  // 常量
  CALIBRATION_POINTS,
  RMS_WARN_DEG,
  // 向量/矩阵运算
  dot,
  norm,
  normalize,
  matMul,
  matMulMat,
  transpose,
  outerProduct,
  det3x3,
  // 坐标转换
  latlonToVec,
  vecToLatlon,
  angleDeg,
  // SVD
  svd3x3,
  // 旋转求解
  solveRotation,
  // 校准
  calibrate,
  Calibration,
  // 静止检测
  StillDetector
}
