"""Shared phase content used by every template.

Anything in this package is template-agnostic: phases whose dict is
byte-identical across every template, plus factories that build per-template
phase blocks from a small data input (e.g. a silhouette loop).

The folder is named with a leading underscore so
``fb_engine.template_resolver._discover_template_entries`` skips it — the
resolver only considers folders whose name starts with ``template_``.
"""
