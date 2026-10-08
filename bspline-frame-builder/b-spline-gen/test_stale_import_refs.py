"""b-spline-gen's import state names only occurrences of open documents (hygiene, 2026-10-07). MEASURED live: at
documentClosing / documentClosed the closing doc's occurrences still read isValid True (invalid only afterwards), so the
handler drops those whose document IS the closing one; an already-invalid one goes too. (Freed no memory -- that stays
inside Fusion, fb_shared/fusion_memory.py -- it removes the invalid-proxy noise.)"""
import types

from test_import_failed_no_modal import bsg  # noqa: E402  (b-spline-gen loaded by path under its fake adsk)


def _occ(doc, valid=True):
    return types.SimpleNamespace(isValid=valid, component=types.SimpleNamespace(parentDesign=types.SimpleNamespace(parentDocument=doc)))


def test_the_closing_documents_occurrences_go_the_others_stay():
    closing, other = object(), object()
    mine, mine2, theirs = _occ(closing), _occ(closing), _occ(other)
    bsg.current_import_group, bsg.last_imported_occurrences = mine, [mine2, theirs]
    bsg._drop_stale_import_refs(closing)
    assert bsg.current_import_group is None
    assert bsg.last_imported_occurrences == [theirs]


def test_another_documents_close_keeps_this_ones_import_state():
    closing, other = object(), object()
    keep = _occ(other)
    bsg.current_import_group, bsg.last_imported_occurrences = keep, [keep]
    bsg._drop_stale_import_refs(closing)
    assert bsg.current_import_group is keep and bsg.last_imported_occurrences == [keep]


def test_an_already_invalid_occurrence_goes_with_or_without_a_closing_doc():
    doc = object()
    dead, live = _occ(doc, valid=False), _occ(doc)
    bsg.current_import_group, bsg.last_imported_occurrences = dead, [dead, live]
    bsg._drop_stale_import_refs()
    assert bsg.current_import_group is None and bsg.last_imported_occurrences == [live]
