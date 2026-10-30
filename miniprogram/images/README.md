# globesound 图标资源

本目录存放小程序所需的图标和标记图片。

## 需要的标记图片

| 文件名 | 尺寸 | 描述 |
|--------|------|------|
| `marker-cyan.png` | 24×24 px | 青色（#4fd1c5）圆形 + 深色描边，用于移动状态标记 |
| `marker-amber.png` | 24×24 px | 琥珀色（#ffb547）圆形 + 发光效果，用于静止/锁定状态标记 |
| `marker-station.png` | 16×16 px | 深红色（#961c1c）小圆点，用于电台位置标记 |
| `marker-target.png` | 24×24 px | 白色十字准星 + 透明背景，用于标定页目标位置标记 |

## 设计要求

- 所有图片使用 PNG 格式，支持透明通道
- 标记图片需在深色（#05070d）背景上清晰可见
- `marker-amber.png` 带外发光效果，模拟锁定指示
- `marker-target.png` 使用细线十字准星，中心留空

## 生成方式

可使用任意图片编辑工具制作，也可通过以下 Python 脚本批量生成：

```python
from PIL import Image, ImageDraw

# marker-cyan.png
img = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.ellipse([2, 2, 21, 21], fill=(79, 209, 197, 255), outline=(5, 7, 13, 255), width=2)
img.save('marker-cyan.png')

# marker-amber.png
img = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.ellipse([1, 1, 22, 22], fill=(255, 181, 71, 60))  # glow
draw.ellipse([4, 4, 19, 19], fill=(255, 181, 71, 255))
img.save('marker-amber.png')

# marker-station.png
img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.ellipse([3, 3, 12, 12], fill=(150, 28, 28, 255))
img.save('marker-station.png')

# marker-target.png
img = Image.new('RGBA', (24, 24), (0, 0, 0, 0))
draw = ImageDraw.Draw(img)
draw.line([(12, 0), (12, 9)], fill='white', width=2)
draw.line([(12, 15), (12, 23)], fill='white', width=2)
draw.line([(0, 12), (9, 12)], fill='white', width=2)
draw.line([(15, 12), (23, 12)], fill='white', width=2)
draw.ellipse([8, 8, 16, 16], outline='white', width=1)
img.save('marker-target.png')
```
