"""amend_item.py — add scope to a seat's running task in ONE step, so the progress page can't miss it.

Adding work mid-task used to be two steps (a handoff.py amend + remembering to edit the seat's checklist); the second got
forgotten and the status page showed "done" for a seat still working. This command does both, or neither:

  1. appends `- [ ] [<TAG>] <text>` to the seat's NEXT-SESSION checklist (seat -> branch + task file from
     tools/status_site/seats.json) in a TEMPORARY worktree at origin/<branch> (never inside the seat's own checkout,
     which may be dirty or behind), commits it by path, pushes, removes the worktree; the seat's next pull brings it;
  2. sends the amendment (handoff.py amend --to worker, from the seat's checkout) naming the tag and the
     commit-subject convention.

    python tools/amend_item.py <seatKey> <TAG> "<what to do>"
    e.g. python tools/amend_item.py seatB T78-item-7 "ANATOMICAL: skin-and-bone lean torso ..."
"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..'))
HANDOFF = os.path.join(os.path.expanduser('~'), '.claude', 'skills', 'multi-agent-handoff', 'handoff.py')
NL = '\n'


def run(args, cwd):
    r = subprocess.run(args, cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode:
        sys.exit(f"FAILED: {' '.join(args)}{NL}{r.stdout}{r.stderr}")
    return r.stdout


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    key, tag, text = sys.argv[1:]
    if not re.fullmatch(r'[A-Za-z0-9]+-item-\d+', tag):
        sys.exit(f"TAG must look like T78-item-7, got {tag!r}")
    seats = json.load(open(os.path.join(HERE, 'status_site', 'seats.json'), encoding='utf-8'))['seats']
    seat = next((s for s in seats if s['key'] == key), None)
    if not seat:
        sys.exit(f"unknown seat {key!r}; known: {[s['key'] for s in seats]}")
    branch = seat['branch']
    run(['git', 'fetch', '-q', 'origin', branch], ROOT)
    tmp = os.path.join(os.path.dirname(ROOT), f'wt-amend-{key}')
    run(['git', '-c', 'core.longpaths=true', 'worktree', 'add', '-q', '--detach', tmp, f'origin/{branch}'], ROOT)
    try:
        task = os.path.join(tmp, seat['task'])
        body = open(task, encoding='utf-8').read()
        if f'[{tag}]' in body:
            sys.exit(f"{tag} is already in {seat['task']} on origin/{branch}")
        line = f"- [ ] [{tag}] {text}{NL}"
        anchor = body.find('Pass back from') if 'Pass back from' in body else body.find('Commit by path')
        body = body[:anchor] + line + body[anchor:] if anchor >= 0 else body.rstrip(NL) + NL + line
        open(task, 'w', encoding='utf-8', newline='').write(body)
        run(['git', 'commit', '-q', seat['task'], '-m',
             f"docs: {tag} added to {seat['name']}'s checklist (amend_item){NL}{NL}"
             "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"], tmp)
        run(['git', 'push', '-q', 'origin', f'HEAD:{branch}'], tmp)
    finally:
        subprocess.run(['git', 'worktree', 'remove', '--force', tmp], cwd=ROOT, capture_output=True)
    checkout = ROOT + seat.get('checkout', '')
    words = tag.replace('-', ' ')
    note = (f"NEW CHECKLIST ITEM [{tag}] (pushed to origin/{branch} {seat['task']}: pull --rebase to get it): {text} "
            f"Commit it with a subject starting '{words}: ...' so the progress page counts it.")
    print(run([sys.executable, HANDOFF, 'amend', '--to', 'worker', '--note', note], checkout).strip())
    print(f"added [{tag}] to {seat['name']} ({seat['task']} on origin/{branch}) + amended")


if __name__ == '__main__':
    main()
