"""
The in-add-in updater (fb_shared/updater.py): "Check for updates" reads the installed build-info.json stamp, fetches
the published latest.json, and only on the user's click downloads the zip, verifies its SHA-256, backs the old folder
up and swaps the new one in. These tests drive the pure functions on temp trees -- never the real AddIns folder.

Run with:
    cd bspline-frame-builder
    python -m pytest fb_shared/test_updater.py
"""
import hashlib
import json
import os
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import pytest

_HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, os.path.dirname(_HERE))

from fb_shared import updater  # noqa: E402
from fb_shared.build_info import read_build_info  # noqa: E402

NAME = 'bspline-frame-builder'
MANIFEST = ('{\r\n    "autodeskProduct": "Fusion360",\r\n    "type": "addin",\r\n    "id": "bspline-frame-builder",\r\n'
            '    "version": "0.1.0",\r\n    "runOnStartup": false,\r\n    "entry": "bspline-frame-builder.py"\r\n}\r\n')
NOW = datetime(2026, 11, 22, 21, 30, 5)


def _stamp(built_at, sha='abc1234', version='2026.11.22-1'):
    return {'version': version, 'sha': sha, 'branch': 'main', 'built_at': built_at, 'source_root': '', 'dirty': False}


def _make_zip(path, files, top=NAME):
    """A release-shaped zip: every entry under '<top>/'. ``files`` maps inner path -> text."""
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as zf:
        for rel, text in files.items():
            zf.writestr(f'{top}/{rel}' if top else rel, text)
    return path


def _release_files(marker='new', stamp=None):
    files = {
        f'{NAME}.py': f'# entry {marker}\n',
        f'{NAME}.manifest': MANIFEST,
        'b-spline-gen/html/main/main.js': f'// {marker}\n',
        'fb_shared/__init__.py': '',
    }
    if stamp is not None:
        files['build-info.json'] = json.dumps(stamp)
    return files


def _install_old(addins, extra=None):
    live = addins / NAME
    (live / 'b-spline-gen' / 'html' / 'main').mkdir(parents=True)
    (live / f'{NAME}.py').write_text('# entry old\n', encoding='utf-8')
    (live / f'{NAME}.manifest').write_text(MANIFEST.replace('false', 'true'), encoding='utf-8')
    (live / 'b-spline-gen' / 'html' / 'main' / 'main.js').write_text('// old\n', encoding='utf-8')
    (live / 'b-spline-gen' / 'gone_in_new_build.js').write_text('// orphan\n', encoding='utf-8')
    (live / '.addin-running.lock').write_text('{"pid": 1}', encoding='utf-8')
    for rel, text in (extra or {}).items():
        (live / rel).parent.mkdir(parents=True, exist_ok=True)
        (live / rel).write_text(text, encoding='utf-8')
    return live


# â”€â”€ is there a newer build? (the existing version stamp, compared by built_at) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def test_newer_build_when_latest_was_built_later():
    assert updater.compare_builds(_stamp('2026-11-20T10:00:00-05:00'), _stamp('2026-11-22T09:00:00-05:00', sha='def5678')) == 'newer'


def test_current_when_the_sha_matches_even_if_the_times_differ():
    # Fred's own deploy of the same commit is stamped later than the release: still "current"
    assert updater.compare_builds(_stamp('2026-11-22T23:00:00-05:00'), _stamp('2026-11-22T09:00:00-05:00')) == 'current'


def test_current_when_the_installed_build_is_newer_than_the_release():
    assert updater.compare_builds(_stamp('2026-11-23T08:00:00-05:00', sha='111aaaa'), _stamp('2026-11-22T09:00:00-05:00', sha='222bbbb')) == 'current'


def test_an_unstamped_install_is_offered_the_release():
    # zips released before this change carry no build-info.json -> read_build_info's sentinel
    assert updater.compare_builds(read_build_info('/no/such/dir'), _stamp('2026-11-22T09:00:00-05:00')) == 'newer'


def test_time_zones_are_compared_as_instants():
    # 10:00 in Montreal (-05:00) is 15:00 UTC: later than 14:00 UTC
    assert updater.compare_builds(_stamp('2026-11-22T14:00:00+00:00', sha='a'), _stamp('2026-11-22T10:00:00-05:00', sha='b')) == 'newer'


def test_a_latest_json_without_a_time_is_refused():
    with pytest.raises(updater.UpdateError) as e:
        updater.validate_latest({'sha': 'abc', 'sha256': 'x'})
    assert e.value.code == 'bad_latest'


def test_describe_build_names_version_sha_and_date():
    text = updater.describe_build(_stamp('2026-11-22T09:15:00-05:00'))
    assert '2026.11.22-1' in text and 'abc1234' in text and '2026-11-22' in text
    assert 'no version stamp' in updater.describe_build(read_build_info('/no/such/dir'))


# â”€â”€ checksum â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def test_parse_sha256_reads_the_sha256sum_format():
    hexd = 'a' * 64
    assert updater.parse_sha256_text(f'{hexd}  bspline-frame-builder.zip\n') == hexd
    assert updater.parse_sha256_text(hexd.upper()) == hexd
    with pytest.raises(updater.UpdateError):
        updater.parse_sha256_text('<html>Not Found</html>')


def test_verify_sha256_refuses_a_mismatch(tmp_path):
    z = _make_zip(tmp_path / 'a.zip', _release_files())
    good = hashlib.sha256(z.read_bytes()).hexdigest()
    updater.verify_sha256(z, good)
    with pytest.raises(updater.UpdateError) as e:
        updater.verify_sha256(z, '0' * 64)
    assert e.value.code == 'checksum'


# â”€â”€ zip shape â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def test_validate_zip_accepts_the_release_shape(tmp_path):
    names = updater.validate_zip(_make_zip(tmp_path / 'a.zip', _release_files()))
    assert f'{NAME}/{NAME}.manifest' in names


@pytest.mark.parametrize('files,top', [
    ({f'{NAME}.py': '', f'{NAME}.manifest': MANIFEST}, 'other-folder'),        # wrong top folder
    ({f'{NAME}.py': ''}, NAME),                                                # manifest missing
    ({f'{NAME}.py': '', f'{NAME}.manifest': MANIFEST, '../evil.py': ''}, NAME),  # escapes the folder
])
def test_validate_zip_refuses_other_shapes(tmp_path, files, top):
    with pytest.raises(updater.UpdateError) as e:
        updater.validate_zip(_make_zip(tmp_path / 'a.zip', files, top=top))
    assert e.value.code == 'bad_zip'


def test_validate_zip_refuses_a_file_that_is_not_a_zip(tmp_path):
    p = tmp_path / 'a.zip'
    p.write_text('<html>rate limited</html>', encoding='utf-8')
    with pytest.raises(updater.UpdateError) as e:
        updater.validate_zip(p)
    assert e.value.code == 'bad_zip'


# â”€â”€ run on startup â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def test_set_run_on_startup_flips_only_that_key():
    out = updater.set_run_on_startup(MANIFEST, True)
    assert json.loads(out)['runOnStartup'] is True
    assert out.replace('true', 'false') == MANIFEST    # everything else byte-identical (CRLF kept)


def test_set_run_on_startup_adds_a_missing_key():
    text = '{\n    "id": "bspline-frame-builder"\n}\n'
    assert json.loads(updater.set_run_on_startup(text, True)) == {'runOnStartup': True, 'id': 'bspline-frame-builder'}


# â”€â”€ install: staging swap on a temp tree â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def test_install_swaps_the_folder_and_keeps_a_backup(tmp_path):
    addins = tmp_path / 'AddIns'
    live = _install_old(addins)
    (addins / 'someone-elses-addin').mkdir()
    (addins / 'someone-elses-addin' / 'x.py').write_text('keep', encoding='utf-8')
    z = _make_zip(tmp_path / 'new.zip', _release_files(stamp=_stamp('2026-11-22T09:00:00-05:00')))

    result = updater.install_zip(z, addins, now=NOW)

    assert result['mode'] == 'swap'
    assert (live / f'{NAME}.py').read_text(encoding='utf-8') == '# entry new\n'
    assert not (live / 'b-spline-gen' / 'gone_in_new_build.js').exists()        # a clean folder, no orphans
    assert read_build_info(live)['built_at'] == '2026-11-22T09:00:00-05:00'
    assert json.loads((live / f'{NAME}.manifest').read_text(encoding='utf-8'))['runOnStartup'] is True  # kept as installed
    assert (live / '.addin-running.lock').exists()                              # the running add-in's heartbeat carries over
    backup = addins / f'{NAME}.bak-20261122-213005'
    assert result['backup'] == str(backup)
    assert (backup / f'{NAME}.py').read_text(encoding='utf-8') == '# entry old\n'
    assert sorted(p.name for p in addins.iterdir()) == [NAME, f'{NAME}.bak-20261122-213005', 'someone-elses-addin']
    assert (addins / 'someone-elses-addin' / 'x.py').read_text(encoding='utf-8') == 'keep'


def test_install_keeps_only_the_newest_backup(tmp_path):
    addins = tmp_path / 'AddIns'
    _install_old(addins)
    (addins / f'{NAME}.bak-20250101-000000').mkdir()
    (addins / f'{NAME}.bak-20261001-120000').mkdir()
    updater.install_zip(_make_zip(tmp_path / 'new.zip', _release_files()), addins, now=NOW)
    assert sorted(p.name for p in addins.iterdir()) == [NAME, f'{NAME}.bak-20261122-213005']


def test_an_old_backup_deeper_than_260_characters_is_still_removed(tmp_path):
    # measured 2026-11-22 (scratchpad installer-test): rmtree(ignore_errors=True) silently left a backup whose deepest
    # file sat past 260 characters, and the result still listed it as removed
    addins = tmp_path / ('d' * max(1, 127 - len(str(tmp_path)) - len('\\AddIns'))) / 'AddIns'
    _install_old(addins)
    old = addins / f'{NAME}.bak-20250101-000000'
    deep = old / ('x' * 60) / ('y' * 60) / 'deep.json'
    os.makedirs('\\\\?\\' + str(deep.parent) if sys.platform == 'win32' else deep.parent)
    with open(('\\\\?\\' + str(deep)) if sys.platform == 'win32' else deep, 'w') as f:
        f.write('{}')
    assert len(str(deep)) > 260
    result = updater.install_zip(_make_zip(tmp_path / 'new.zip', _release_files()), addins, now=NOW)
    assert sorted(p.name for p in addins.iterdir()) == [NAME, f'{NAME}.bak-20261122-213005']
    assert result['removed_backups'] == [str(old)]


def test_first_install_needs_no_backup_and_turns_run_on_startup_on(tmp_path):
    addins = tmp_path / 'AddIns'
    addins.mkdir()
    result = updater.install_zip(_make_zip(tmp_path / 'new.zip', _release_files()), addins, now=NOW, run_on_startup=True)
    assert result['backup'] is None
    assert json.loads((addins / NAME / f'{NAME}.manifest').read_text(encoding='utf-8'))['runOnStartup'] is True
    assert sorted(p.name for p in addins.iterdir()) == [NAME]


def test_a_bad_zip_leaves_the_install_untouched(tmp_path):
    addins = tmp_path / 'AddIns'
    live = _install_old(addins)
    with pytest.raises(updater.UpdateError):
        updater.install_zip(_make_zip(tmp_path / 'bad.zip', {'x.py': ''}, top='wrong'), addins, now=NOW)
    assert (live / f'{NAME}.py').read_text(encoding='utf-8') == '# entry old\n'
    assert sorted(p.name for p in addins.iterdir()) == [NAME]                    # no staging / backup left behind


def _refuse_rename_of(live):
    """os.rename stand-in: the live folder can't move (what Windows does while Fusion holds a file in it)."""
    def rename(src, dst):
        if Path(src) == live:
            raise PermissionError(5, 'Access is denied', str(src))
        os.rename(src, dst)
    return rename


def test_a_folder_that_cannot_move_is_updated_file_by_file(tmp_path):
    addins = tmp_path / 'AddIns'
    live = _install_old(addins, extra={'frame-builder/frame-builder-debug.log': 'old log'})
    z = _make_zip(tmp_path / 'new.zip', _release_files())
    result = updater.install_zip(z, addins, now=NOW, rename=_refuse_rename_of(live))
    assert result['mode'] == 'overlay'
    assert (live / f'{NAME}.py').read_text(encoding='utf-8') == '# entry new\n'
    assert (live / 'b-spline-gen' / 'html' / 'main' / 'main.js').read_text(encoding='utf-8') == '// new\n'
    assert not (live / 'b-spline-gen' / 'gone_in_new_build.js').exists()
    assert (live / 'frame-builder' / 'frame-builder-debug.log').read_text(encoding='utf-8') == 'old log'  # logs stay
    assert (addins / f'{NAME}.bak-20261122-213005' / f'{NAME}.py').read_text(encoding='utf-8') == '# entry old\n'


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows file locking')
def test_a_file_held_open_rolls_the_update_back(tmp_path):
    addins = tmp_path / 'AddIns'
    live = _install_old(addins)
    z = _make_zip(tmp_path / 'new.zip', _release_files())
    held = open(live / 'b-spline-gen' / 'html' / 'main' / 'main.js', 'r', encoding='utf-8')   # Windows: blocks rename + replace
    try:
        with pytest.raises(updater.UpdateError) as e:
            updater.install_zip(z, addins, now=NOW)
    finally:
        held.close()
    assert e.value.code == 'in_use'
    assert 'b-spline-gen/html/main/main.js' in str(e.value)
    assert (live / f'{NAME}.py').read_text(encoding='utf-8') == '# entry old\n'   # rolled back, never half new
    assert not (addins / 'bsfb-new').exists()


# â”€â”€ the whole click: fetch latest.json -> download -> verify -> install (file:// stands in for https) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
def _publish(tmp_path, stamp):
    rel = tmp_path / 'release'
    rel.mkdir()
    z = _make_zip(rel / 'bspline-frame-builder.zip', _release_files(stamp=stamp))
    latest = dict(stamp, zip_url=z.as_uri(), sha256=hashlib.sha256(z.read_bytes()).hexdigest(), size=z.stat().st_size)
    (rel / 'latest.json').write_text(json.dumps(latest), encoding='utf-8')
    return rel


def test_check_then_install_end_to_end(tmp_path):
    addins = tmp_path / 'AddIns'
    live = _install_old(addins, extra={'build-info.json': json.dumps(_stamp('2026-11-01T09:00:00-05:00', sha='old0000'))})
    rel = _publish(tmp_path, _stamp('2026-11-22T09:00:00-05:00', sha='new1111'))

    latest = updater.fetch_latest((rel / 'latest.json').as_uri())
    assert updater.compare_builds(read_build_info(live), latest) == 'newer'
    assert (live / f'{NAME}.py').read_text(encoding='utf-8') == '# entry old\n'   # checking never installs

    seen = []
    result = updater.download_and_install(live, latest, now=NOW, progress=lambda done, total: seen.append(done))
    assert read_build_info(live)['sha'] == 'new1111'
    assert result['backup'].endswith('.bak-20261122-213005')
    assert seen and seen[-1] == latest['size']


def test_a_tampered_download_is_refused_before_anything_moves(tmp_path):
    addins = tmp_path / 'AddIns'
    live = _install_old(addins)
    rel = _publish(tmp_path, _stamp('2026-11-22T09:00:00-05:00', sha='new1111'))
    latest = updater.fetch_latest((rel / 'latest.json').as_uri())
    latest['sha256'] = 'f' * 64
    with pytest.raises(updater.UpdateError) as e:
        updater.download_and_install(live, latest, now=NOW)
    assert e.value.code == 'checksum'
    assert sorted(p.name for p in addins.iterdir()) == [NAME]


@pytest.mark.parametrize('layout', ['renamed-folder', 'next-to-dot-git'])
def test_the_updater_updates_the_folder_it_runs_from_whatever_its_name(tmp_path, layout):
    # Fred 2026-11-23 ("Remove it"): no source-checkout refusal. The folder the add-in runs from is the one replaced
    # and backed up, whatever its name and whatever sits next to it; nothing named bspline-frame-builder appears beside it.
    parent = tmp_path / 'AddIns'
    root = parent / ('my-copy' if layout == 'renamed-folder' else NAME)
    root.mkdir(parents=True)
    if layout == 'next-to-dot-git':
        (parent / '.git').mkdir()
    (root / f'{NAME}.py').write_text('# old\n', encoding='utf-8')
    (root / f'{NAME}.manifest').write_text(MANIFEST, encoding='utf-8')
    rel = _publish(tmp_path, _stamp('2026-11-22T09:00:00-05:00', sha='new1111'))
    result = updater.download_and_install(root, updater.fetch_latest((rel / 'latest.json').as_uri()), now=NOW)
    assert (root / f'{NAME}.py').read_text(encoding='utf-8') == '# entry new\n'
    assert read_build_info(root)['sha'] == 'new1111'
    backup = parent / f'{root.name}.bak-20261122-213005'
    assert result['backup'] == str(backup)
    assert (backup / f'{NAME}.py').read_text(encoding='utf-8') == '# old\n'
    want = sorted([root.name, backup.name] + (['.git'] if layout == 'next-to-dot-git' else []))
    assert sorted(p.name for p in parent.iterdir()) == want


def test_offline_reads_as_a_plain_error(tmp_path):
    with pytest.raises(updater.UpdateError) as e:
        updater.fetch_latest((tmp_path / 'nothing-here.json').as_uri())
    assert e.value.code == 'offline'
