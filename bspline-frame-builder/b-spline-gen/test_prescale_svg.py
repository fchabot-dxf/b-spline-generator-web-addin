import re


def _prescale_svg(svg_text, scale, width_in=7.0, height_in=9.0):
    w_px = width_in * scale
    h_px = height_in * scale
    half_w = w_px / 2
    half_h = h_px / 2

    def transform_coord(x_str, y_str):
        new_x = float(x_str) * scale - half_w
        new_y = (half_h - float(y_str) * scale) - (0.5 * scale)
        return f'{new_x:.4f},{new_y:.4f}'

    def scale_pair(m):
        return transform_coord(m.group(1), m.group(2))

    def scale_x_attr(m):
        return f'{m.group(1)}="{float(m.group(2)) * scale - half_w:.4f}"'
    svg_text = re.sub(r'\b(x|cx)="([^"]+)"', scale_x_attr, svg_text)

    def scale_y_attr(m):
        val = (half_h - float(m.group(2)) * scale) - (0.5 * scale)
        return f'{m.group(1)}="{val:.4f}"'
    svg_text = re.sub(r'\b(y|cy)="([^"]+)"', scale_y_attr, svg_text)

    def scale_only_attr(m):
        return f'{m.group(1)}="{float(m.group(2)) * scale:.4f}"'
    svg_text = re.sub(r'\b(width|height|r|rx|ry|font-size)="([^"]+)"', scale_only_attr, svg_text)

    def scale_pts(m):
        return 'points="' + re.sub(r'([-\d.]+),([-\d.]+)', scale_pair, m.group(1)) + '"'
    svg_text = re.sub(r'points="([^"]+)"', scale_pts, svg_text)

    def transform_path_d(path_data):
        token_re = re.compile(r'([MmZzLlHhVvCcSsQqTtAa])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)')
        tokens = []
        for cmd, num in token_re.findall(path_data):
            if cmd:
                tokens.append(cmd)
            elif num:
                tokens.append(num)

        param_counts = {
            'M': 2, 'L': 2, 'T': 2, 'H': 1, 'V': 1,
            'C': 6, 'S': 4, 'Q': 4, 'A': 7, 'Z': 0
        }

        def transform_num(val, is_x, is_y, absolute):
            f = float(val)
            if is_x:
                return f'{f * scale - half_w:.4f}' if absolute else f'{f * scale:.4f}'
            if is_y:
                return f'{(half_h - f * scale) - (0.5 * scale):.4f}' if absolute else f'{(-f * scale):.4f}'
            return f'{f:.4f}'

        output = []
        i = 0
        current_cmd = None
        while i < len(tokens):
            token = tokens[i]
            if token in param_counts:
                current_cmd = token
                output.append(token)
                i += 1
                continue

            if current_cmd is None:
                break

            cmd = current_cmd
            upper = cmd.upper()
            absolute = cmd == upper
            count = param_counts.get(upper, 0)
            if count == 0:
                continue

            while i < len(tokens) and tokens[i] not in param_counts:
                group = tokens[i:i+count]
                if len(group) < count:
                    break
                transformed = []
                if upper == 'A':
                    for pi, val in enumerate(group):
                        if pi in (0, 1):
                            transformed.append(transform_num(val, True, False, absolute))
                        elif pi in (2, 3, 4):
                            transformed.append(f'{float(val):.4f}')
                        elif pi == 5:
                            transformed.append(transform_num(val, True, False, absolute))
                        elif pi == 6:
                            transformed.append(transform_num(val, False, True, absolute))
                else:
                    for pi, val in enumerate(group):
                        if upper == 'H':
                            transformed.append(transform_num(val, True, False, absolute))
                        elif upper == 'V':
                            transformed.append(transform_num(val, False, True, absolute))
                        else:
                            is_x = (pi % 2) == 0
                            is_y = not is_x
                            transformed.append(transform_num(val, is_x, is_y, absolute))
                output.extend(transformed)
                i += count

        return ' '.join(output)

    def scale_d(m):
        return 'd="' + transform_path_d(m.group(1)) + '"'
    svg_text = re.sub(r'\bd="([^"]+)"', scale_d, svg_text)

    svg_text = re.sub(
        r'viewBox="[^"]+"',
        f'viewBox="{-half_w:.0f} {-half_h:.0f} {w_px:.0f} {h_px:.0f}"',
        svg_text
    )

    return svg_text


if __name__ == '__main__':
    sample = '<svg width="672" height="864" viewBox="0 0 7 9"><path d="M 0 0 L 7 0 L 7 9 L 0 9 Z"/></svg>'
    out = _prescale_svg(sample, 96, 7, 9)
    print(out)
