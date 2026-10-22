# 附录：背景资料与备选方案

整理日期：2026-10。主方案见仓库根目录的 [README](../README.md)，这里记录一路上看过、比较过的东西，以及没有选它们的原因。

## 1. 需求是怎么收敛的

| 阶段 | 想法 | 结论 |
| --- | --- | --- |
| 1 | 球形屏幕做地球仪 | LED 球屏可以买到（深圳有 20–50cm 的小球），但不能触摸，分辨率也低 |
| 2 | 能点击触发坐标的投影球 | 红外触摸投影球技术上可行，自己做太复杂（另有一份 DIY 报告，见下方链接） |
| 3 | 现成的电子地球仪 | 没有一款同时满足"桌面尺寸、球面画面、点击出坐标" |
| 4 | 不要屏幕，用传统地球仪，转到固定位置就读出坐标 | 选定：用姿态传感器测重力方向，读数点放在球顶 |

DIY 触摸投影地球仪报告（Claude 文档）：https://claude.ai/code/artifact/a9c39ad7-6eb2-46a8-8590-17c5ff337278

## 2. "转动读坐标"的几条技术路线

| 路线 | 原理 | 优点 | 缺点 | 参考 |
| --- | --- | --- | --- | --- |
| **姿态传感器 + 球顶读数（已选）** | 球内的加速度计测重力方向，标定后换算成球顶的经纬度 | 不用改机械结构，不会漂，倾角无关 | 要装进球里并配平；电池要充电 | 本仓库 |
| 两个绝对值编码器 | 极轴读经度，子午圈转轴读纬度 | 精度高（约 0.3°），电子件放在底座里，可以用 USB 供电 | 要在轴心装磁铁或联轴器，机械改造量大 | [RadioGlobe](https://hackaday.com/2020/07/27/radioglobe-takes-the-world-of-internet-radio-for-a-spin/)：两个 Bourns EMS22A，1024 档，开源（[GitHub](https://github.com/DesignSparkrs/RadioGlobe)） |
| 姿态传感器 + 磁力计航向 | 用九轴融合出完整姿态，读数点可以放在任意方向 | 读数点位置自由 | 室内和金属子午圈附近航向误差大 | — |
| 点读笔地球仪 | 笔头读取印在球面上的光学码 | 便宜 | 只能识别区域，不输出坐标 | — |

磁编码器模块的参考价：[AS5600](https://www.fruugo.jp/as5600-magnetic-encoder-sensor-module-33v-12bit-high-precision-angle-measurement/p-515427616-1051343475)（12 位，带磁铁）、[MT6701](https://ifuturetech.org/product/mt6701-high-speed-and-high-precision-magnetic-encoder-module/)（14 位，磁铁间隙 0.5–2mm）。AS5600 的 I2C 地址是固定的，两个要接在不同的总线上。

## 3. 传感器比较（维特智能系列）

| 型号 | 连接 | 续航 | 重量 | 尺寸（mm） | 备注 |
| --- | --- | --- | --- | --- | --- |
| **BWT901BLECL（已购）** | 蓝牙 5.0，也可用 Type-C 有线 | 4–6 小时（260mAh） | 19g | 51.5×36.1×15 | 蓝牙协议已核实 |
| WT9011DCL-BT50 | 蓝牙 5.0，Type-C 只能充电 | 40 小时（130mAh） | 9g | 32.5×23.5×11.4 | 更小、更省电；协议未核实 |
| WT901SDCL-BT50 | 蓝牙 5.0 / Type-C，带 SD 卡记录 | 10–20 小时 | 19g | 51.5×36.1×20 | — |
| WT901WIFI | Wi-Fi | 3 小时 | 19g | 51.5×36.1×15 | — |
| BWT901CL / BWT61CL | 经典蓝牙 2.0 | 4–6 小时 | 19g | 51.5×36.1×15 | 本项目代码不支持 |

所有型号的倾角精度都是 XY 0.2°。本方案只用加速度计，六轴还是九轴没有区别。

其他品牌也看过：RuuviTag（纽扣电池可用 1–2 年，但难买、贵）、四月兄弟 ABSensor N01、云里物里 E8、KKM K15（加速度蓝牙信标）、Seeed XIAO nRF52840 Sense、M5StickC Plus2。

## 4. 商业产品（供参考）

| 产品 | 类型 | 能不能出坐标 |
| --- | --- | --- |
| [PufferSphere M](https://wiki.openstreetmap.org/wiki/Pufferfish_Display) | 60/90cm 内投影触摸球，机构级产品，要询价 | 能，控制盒直接输出触点坐标 |
| [Gakken WorldEye](https://eclecti.cc/computergraphics/snow-globe-redux-gakken-worldeye-projector-upgrade) | 只显示半球的投影球，已停产 | 不能 |
| [LeapFrog Magic Adventures Globe](https://www.walmart.com/ip/549911870) | 地球仪加 2.7 寸屏和触控笔 | 只能播放内置内容 |
| [Replogle Intelliglobe II](https://ovrclock.com/best-interactive-globes-for-kids-learning/) | 点读笔地球仪 | 只能播放内置内容 |
| Odyssey Atlasphere（1996，[已停产](https://wikipedia2006.classicistranieri.com/en/e/x/p/Explore_Technologies%2C_Inc._15ff.html)） | 用笔点球面，内部算出经纬度 | 能算，但不对外开放 |

## 5. 协议资料来源

- [WT901BLECL 设置与蓝牙协议（Zenn）](https://zenn.dev/fastriver/articles/wt901blecl_change_settings)：通知通道 FFE4，写入通道 FFE9，数据包以 55 61 开头，寄存器读取回包以 55 71 开头，配置指令以 FF AA 开头
- [REXYGEN 论坛里的维特 BLE 解析代码](https://forum.rexygen.com/post/1712)：20 字节数据包的字段布局和换算系数
- 维特官方型号对比表（King 提供的截图）：尺寸、重量、续航、精度
