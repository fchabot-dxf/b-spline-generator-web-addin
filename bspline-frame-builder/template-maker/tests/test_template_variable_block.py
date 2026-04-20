import sys
import types
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from template_variable_block import format_variable_block


def test_format_variable_block_default():
    variables = [
        {'name': 'widthIn', 'expression': '10 "', 'enabled': True},
        {'name': 'heightIn', 'expression': '15 "', 'enabled': False},
        {'name': 'offset', 'expression': 'widthIn * 0.5', 'enabled': True},
        {'name': 'empty', 'expression': '', 'enabled': True},
    ]

    block = format_variable_block(variables)
    assert 'widthIn = 10 "' in block
    assert 'offset = widthIn * 0.5' in block
    assert 'heightIn' not in block
    assert 'empty' in block


if __name__ == '__main__':
    test_format_variable_block_default()
    print('variable block helper test passed')
