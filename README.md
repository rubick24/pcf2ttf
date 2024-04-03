# PCF2TTF

从 pcf 字体文件中读取位图字形，用 js 转化成 [.glyphs](https://github.com/schriftgestalt/GlyphsSDK/blob/Glyphs3/GlyphsFileFormat/GlyphsFileFormatv3.md) 文件，并通过 python 库 `fontmake` 输出为像素矢量字形的 ttf 文件。

下面是我使用文泉驿点阵宋体生成的 TTF 字体效果。
实际字体大小为 15px（ascent=13, descent=2），行高为 18px。

![example](./assets/example.png)

## 使用

安装依赖

```sh
pip install -r ./requirements.txt
pnpm install
```

运行

```sh
pnpm tsx src/index.ts
```
