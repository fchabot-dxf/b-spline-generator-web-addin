"""
H23 item 24 (data loss, MEASURED live twice by the advisor): with document A active, a real Send built a
B-Spline Set in A; a NEW document B was then created/activated and a second Send ran there -> document A's
B-Spline Set was DELETED. Cause: `_remove_last_import()` deleted straight from the in-memory
`last_imported_occurrences` / `current_import_group` globals -- plain object references with no document check
of their own. An Occurrence stays `.isValid` and `deleteMe()`-able even after a DIFFERENT document becomes
active, so switching documents and Sending again silently deleted document A's own geometry.

Fix: `_in_active_design(des, entity)` checks the entity's own `entityToken` against the ACTIVE design via
`des.findEntityByToken` (the Fusion API's own document-scoped identity mechanism, confirmed live: an
occurrence's token is found via its own design, not via a different one) before any deletion or re-use as an
import target. This suite fakes that exact mechanism (two independent per-design token sets) rather than real
Fusion -- the orchestration itself (`_handle_generate`'s full STEP-import pipeline) is exercised live, not here;
this is `_remove_last_import`/`_in_active_design`'s own cross-document logic in isolation, the same shape
fb_engine/test_send_frame.py's own World takes for send_frame's orchestration.
"""
import sys
import types

import pytest

from test_svg_layer_import_plan import _bspline_gen as bsg  # noqa: E402  (shared adsk stubs + loader)


class FakeEntity:
    """A minimal stand-in for an Occurrence: a stable identity (`entityToken`), a `.isValid` flag a document
    close could flip (never flipped by a mere document SWITCH, matching real Fusion), and a `deleteMe()` that
    records whether it was actually called."""
    _next_token = 0

    def __init__(self, name):
        self.name = name
        FakeEntity._next_token += 1
        self.entityToken = f'tok-{FakeEntity._next_token}'
        self.isValid = True
        self.deleted = False

    def deleteMe(self):
        self.deleted = True
        self.isValid = False


class FakeDesign:
    """A document's own design: `findEntityByToken` only recognizes tokens minted for ITS OWN entities --
    exactly the real Fusion behavior confirmed live (an occurrence from document A: found via desA,
    NOT found via desB)."""
    def __init__(self, name):
        self.name = name
        self._tokens = set()

    def own(self, entity):
        self._tokens.add(entity.entityToken)
        return entity

    def findEntityByToken(self, token):
        return [object()] if token in self._tokens else []


@pytest.fixture
def two_docs(monkeypatch):
    des_a, des_b = FakeDesign('A'), FakeDesign('B')
    app = types.SimpleNamespace(activeProduct=des_a)
    monkeypatch.setattr(bsg, 'app', app, raising=False)
    monkeypatch.setattr(bsg, '_log', lambda msg: None)
    monkeypatch.setattr(bsg.adsk.fusion, 'Design', types.SimpleNamespace(cast=lambda x: x), raising=False)
    monkeypatch.setattr(bsg, '_clear_custom_graphics', lambda: None)
    return types.SimpleNamespace(app=app, des_a=des_a, des_b=des_b)


class TestInActiveDesign:
    def test_an_entity_owned_by_the_active_design_is_recognized(self, two_docs):
        e = two_docs.des_a.own(FakeEntity('panel'))
        assert bsg._in_active_design(two_docs.des_a, e) is True

    def test_an_entity_owned_by_a_DIFFERENT_design_is_not(self, two_docs):
        e = two_docs.des_a.own(FakeEntity('panel'))
        assert bsg._in_active_design(two_docs.des_b, e) is False

    def test_none_and_invalid_entities_are_never_in_any_design(self, two_docs):
        assert bsg._in_active_design(two_docs.des_a, None) is False
        e = two_docs.des_a.own(FakeEntity('panel'))
        e.isValid = False
        assert bsg._in_active_design(two_docs.des_a, e) is False


class TestRemoveLastImportIsDocumentScoped:
    def test_import_in_A_then_switch_to_B_then_remove_last_import_leaves_A_untouched(self, two_docs):
        # The exact MEASURED scenario: Send built a set in A (recorded in the in-memory globals), the user
        # then activates B, and B's own Send calls _remove_last_import() to clear "the previous import" --
        # which must mean "whatever is actually still in B", never "whatever A happens to still have".
        occ_a = two_docs.des_a.own(FakeEntity('B-Spline Set (A)'))
        group_a = two_docs.des_a.own(FakeEntity('Group (A)'))
        bsg.last_imported_occurrences = [occ_a]
        bsg.current_import_group = group_a

        two_docs.app.activeProduct = two_docs.des_b  # the user switched documents
        bsg._remove_last_import()

        assert occ_a.deleted is False, 'document A\'s own occurrence must survive a Send in document B'
        assert group_a.deleted is False, 'document A\'s own import group must survive a Send in document B'
        # the in-memory bookkeeping is still reset either way (it no longer describes anything useful)
        assert bsg.last_imported_occurrences == []
        assert bsg.current_import_group is None

    def test_remove_last_import_in_the_SAME_document_still_deletes_as_before(self, two_docs):
        # The common, non-buggy case: no document switch, _remove_last_import must still actually clean up.
        occ_a = two_docs.des_a.own(FakeEntity('B-Spline Set (A)'))
        group_a = two_docs.des_a.own(FakeEntity('Group (A)'))
        bsg.last_imported_occurrences = [occ_a]
        bsg.current_import_group = group_a

        bsg._remove_last_import()  # app.activeProduct is still des_a

        assert occ_a.deleted is True
        assert group_a.deleted is True
        assert bsg.last_imported_occurrences == []
        assert bsg.current_import_group is None

    def test_a_mix_only_the_active_documents_own_occurrences_are_deleted(self, two_docs):
        # append mode can, per the dispatch's own warning, leave last_imported_occurrences holding entries
        # from more than one document; only the ACTIVE one's own entries may ever be touched.
        occ_a = two_docs.des_a.own(FakeEntity('from A'))
        occ_b = two_docs.des_b.own(FakeEntity('from B'))
        bsg.last_imported_occurrences = [occ_a, occ_b]
        bsg.current_import_group = None

        two_docs.app.activeProduct = two_docs.des_b
        bsg._remove_last_import()

        assert occ_a.deleted is False
        assert occ_b.deleted is True
