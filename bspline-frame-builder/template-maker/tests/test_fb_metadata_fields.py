"""
E7b — regression guard for `get_fb_metadata` deriving from
`get_fb_metadata_fields` (fb_shared/entity_helpers.py), byte-identical to the
pre-E7b pipe-joined string format. Before E7b these were two independent
implementations that could drift; now `get_fb_metadata` is purely derived
from the structured dict `get_fb_metadata_fields` returns.
"""
from entity_helpers import get_fb_metadata, get_fb_metadata_fields


class _FakeAttr:
    def __init__(self, value):
        self.value = value


class _FakeAttributes:
    def __init__(self, values):
        self._values = values  # {(group, name): value}

    def itemByName(self, group, name):
        val = self._values.get((group, name))
        return _FakeAttr(val) if val is not None else None


class _FakeEntity:
    """No `nativeObject` attr, so `_get_native` passes it through unchanged.
    No `centerSketchPoint` attr, so the Bulge branch never fires."""
    def __init__(self, attr_values):
        self.attributes = _FakeAttributes(attr_values)


def test_metadata_fields_and_string_with_start_end_center():
    ent = _FakeEntity({
        ('FrameBuilder', 'StartID'): 'S1',
        ('FrameBuilder', 'EndID'): 'E1',
        ('FrameBuilder', 'CenterID'): 'C1',
    })

    assert get_fb_metadata_fields(ent) == {'startId': 'S1', 'endId': 'E1', 'centerId': 'C1'}
    assert get_fb_metadata(ent) == 'StartID=S1 | EndID=E1 | CenterID=C1'


def test_no_attributes_returns_empty_dict_and_string():
    class _NoAttrsEntity:
        pass

    ent = _NoAttrsEntity()
    assert get_fb_metadata_fields(ent) == {}
    assert get_fb_metadata(ent) == ''


def test_partial_fields_only_present_keys_appear_in_order():
    # Only EndID set — StartID/CenterID must be absent, not empty-valued.
    ent = _FakeEntity({('FrameBuilder', 'EndID'): 'E2'})

    assert get_fb_metadata_fields(ent) == {'endId': 'E2'}
    assert get_fb_metadata(ent) == 'EndID=E2'
