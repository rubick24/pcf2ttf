import logging
import os
import shutil

from pcffont import PcfFont
from pixel_font_builder import FontBuilder, Glyph, opentype

logging.basicConfig(level=logging.DEBUG)

project_root_dir = os.path.abspath(os.path.dirname(__file__))


def _convert_font(load_file_path: str, save_file_path: str):
    # 加载原始 PCF 字体
    pcf_font = PcfFont.load(load_file_path, strict_level=0)
    # 创建像素字体构建器
    font_size = pcf_font.properties.pixel_size
    builder = FontBuilder(font_size)

    # 转储元信息
    builder.meta_info.version = pcf_font.properties.font_version
    builder.meta_info.family_name = pcf_font.properties.family_name
    builder.meta_info.style_name = pcf_font.properties.weight_name
    builder.meta_info.manufacturer = pcf_font.properties.foundry

    # 转储度量参数
    builder.horizontal_header.ascent = pcf_font.bdf_accelerators.font_ascent
    builder.horizontal_header.descent = -pcf_font.bdf_accelerators.font_descent
    builder.vertical_header.ascent = pcf_font.bdf_accelerators.font_ascent
    builder.vertical_header.descent = -pcf_font.bdf_accelerators.font_descent
    builder.os2_config.x_height = pcf_font.properties.x_height or 0
    builder.os2_config.cap_height = pcf_font.properties.cap_height or 0

    # 已添加的字形名称，避免重复添加
    used_glyph_names = set()

    # 添加占位字形
    default_glyph_index = pcf_font.bdf_encodings.default_char
    default_metric = pcf_font.metrics[default_glyph_index]
    default_bitmap = pcf_font.bitmaps[default_glyph_index]
    builder.glyphs.append(Glyph(
        name='.notdef',  # 约定名称
        advance_width=default_metric.character_width,
        advance_height=font_size,
        horizontal_origin=(-default_metric.left_sided_bearing, -default_metric.character_descent),
        vertical_origin_y=default_metric.character_ascent - font_size,
        data=default_bitmap,
    ))
    used_glyph_names.add('.notdef')

    # 添加普通字形
    for code_point, glyph_index in sorted(pcf_font.bdf_encodings.items()):
        glyph_name = pcf_font.glyph_names[glyph_index]
        if glyph_index == default_glyph_index:
            # 避免重复添加默认字形
            glyph_name = '.notdef'
        metric = pcf_font.metrics[glyph_index]
        bitmap = pcf_font.bitmaps[glyph_index]

        builder.character_mapping[code_point] = glyph_name
        if glyph_name not in used_glyph_names:
            builder.glyphs.append(Glyph(
                name=glyph_name,
                advance_width=metric.character_width,
                advance_height=font_size,
                horizontal_origin=(-metric.left_sided_bearing, -metric.character_descent),
                vertical_origin_y=metric.character_ascent - font_size,
                data=bitmap,
            ))
            used_glyph_names.add(glyph_name)

    # 输出字体
    builder.save_otf(f'{save_file_path}.otf')
    builder.save_otf(f'{save_file_path}.woff2', flavor=opentype.Flavor.WOFF2)
    builder.save_ttf(f'{save_file_path}.ttf')
    builder.save_bdf(f'{save_file_path}.bdf')
    builder.save_pcf(f'{save_file_path}.pcf')


def main():
    outputs_dir = os.path.join(project_root_dir, 'build')
    if os.path.exists(outputs_dir):
        shutil.rmtree(outputs_dir)
    os.makedirs(outputs_dir)

    _convert_font(
        os.path.join(project_root_dir, 'assets', 'wenquanyi_9pt.pcf'),
        os.path.join(project_root_dir, 'build', 'wenquanyi_9pt'),
    )

    _convert_font(
        os.path.join(project_root_dir, 'assets', 'wenquanyi_10pt.pcf'),
        os.path.join(project_root_dir, 'build', 'wenquanyi_10pt'),
    )


if __name__ == '__main__':
    main()
