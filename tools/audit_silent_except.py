"""H23 item 12: a reusable audit for "the user asked for X, it silently failed, nothing told them" --
the exact shape of item 10's own CAM-confirm bug (an undefined-name NameError swallowed by a bare
`except Exception: _log_error(...)`, so the whole action did nothing visible).

Finds every `except Exception`/bare `except` block that is (a) reachable from a user-facing action entry
point (`notify()`, `_handle_*`, `_do_*`, a CommandCreated/CommandExecute handler) and (b) whose body does
nothing but log -- no messageBox, no sendInfoToHTML/toast/returnData, no re-raise, no returning a non-None
value a caller might check.

KNOWN LIMITATION (confirmed by manual spot-check during the H23 item 12 sweep): SURFACE_CALL_SUBSTR is a
fixed name list and will NOT recognize an app-specific surfacing helper it doesn't know about (e.g.
`_send_palette_message` in frame-builder/ui/solid_builder_ui.py was flagged "silent" by this script even
though it does call back into the palette on failure) -- so this script's own "SILENT" list is a
conservative OVER-approximation, a start for manual triage, not a final verdict. Add a name to
SURFACE_CALL_SUBSTR once you've confirmed what it does.

Usage:
    python tools/audit_silent_except.py <file.py> [<file.py> ...]
"""
import ast
import sys

ENTRY_NAME_PATTERNS = ("notify", "_handle_", "_do_", "commandCreated", "execute", "onExecute", "run", "stop")
LOG_NAME_SUBSTR = ("log", "_log")
SURFACE_CALL_SUBSTR = (
    "messagebox", "sendinfotohtml", "sendtohtml", "send_to_html", "send_palette_message",
    "toast", "progress", "send_progress", "firecustomevent",
)


def is_entry_name(name):
    return any(p.lower() in name.lower() for p in ENTRY_NAME_PATTERNS)


class CallCollector(ast.NodeVisitor):
    """Collects same-file function/method names called from within a function body."""
    def __init__(self):
        self.calls = set()

    def visit_Call(self, node):
        f = node.func
        if isinstance(f, ast.Name):
            self.calls.add(f.id)
        elif isinstance(f, ast.Attribute):
            self.calls.add(f.attr)
        self.generic_visit(node)


def body_is_log_only(handler_body):
    """True if every statement in the except body is a log-only call, `pass`, or a bare string/docstring.
    Returns False if it clearly surfaces or re-raises; "ambiguous" for any other statement shape."""
    if not handler_body:
        return True
    for stmt in handler_body:
        if isinstance(stmt, ast.Pass):
            continue
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Constant):
            continue  # a stray string literal, not real code
        if isinstance(stmt, ast.Raise):
            return False  # re-raises -- not hidden
        if isinstance(stmt, ast.Return):
            if stmt.value is not None and not (isinstance(stmt.value, ast.Constant) and stmt.value.value is None):
                return False  # returns a non-None value a caller might check -- not purely silent
            continue
        if isinstance(stmt, ast.Expr) and isinstance(stmt.value, ast.Call):
            call = stmt.value
            name = call.func.id if isinstance(call.func, ast.Name) else (call.func.attr if isinstance(call.func, ast.Attribute) else "")
            if any(s in name.lower() for s in LOG_NAME_SUBSTR):
                continue
            if any(s in name.lower() for s in SURFACE_CALL_SUBSTR):
                return False
            continue  # an unrecognized call -- conservatively still "silent" (see KNOWN LIMITATION above)
        return "ambiguous"
    return True


def analyze_file(path):
    src = open(path, encoding="utf-8").read()
    try:
        tree = ast.parse(src, filename=path)
    except SyntaxError as e:
        print(f"SYNTAX ERROR in {path}: {e}")
        return []

    funcs = {}
    calls_by_func = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            funcs[node.name] = node
            cc = CallCollector()
            cc.visit(node)
            calls_by_func[node.name] = cc.calls

    entries = {name for name in funcs if is_entry_name(name)}
    reachable = set(entries)
    frontier = set(entries)
    while frontier:
        nxt = set()
        for fn in frontier:
            for callee in calls_by_func.get(fn, ()):
                if callee in funcs and callee not in reachable:
                    reachable.add(callee)
                    nxt.add(callee)
        frontier = nxt

    findings = []
    for fn_name in reachable:
        node = funcs[fn_name]
        for sub in ast.walk(node):
            if isinstance(sub, ast.ExceptHandler):
                is_bare_or_exception = sub.type is None or (
                    isinstance(sub.type, ast.Name) and sub.type.id == "Exception"
                )
                if not is_bare_or_exception:
                    continue
                verdict = body_is_log_only(sub.body)
                findings.append({"file": path, "func": fn_name, "line": sub.lineno, "verdict": verdict})
    return findings


if __name__ == "__main__":
    all_findings = []
    for path in sys.argv[1:]:
        all_findings.extend(analyze_file(path))

    silent = [f for f in all_findings if f["verdict"] is True]
    ambiguous = [f for f in all_findings if f["verdict"] == "ambiguous"]
    print(f"TOTAL except-Exception/bare-except in reachable functions: {len(all_findings)}")
    print(f"SILENT candidates (log-only or pass, nothing recognized surfaces -- see KNOWN LIMITATION): {len(silent)}")
    print(f"AMBIGUOUS (other statement shapes, needs a look): {len(ambiguous)}")
    print()
    print("=== SILENT candidates ===")
    for f in sorted(silent, key=lambda x: (x["file"], x["line"])):
        print(f"{f['file']}:{f['line']}  in {f['func']}()")
    print()
    print("=== AMBIGUOUS ===")
    for f in sorted(ambiguous, key=lambda x: (x["file"], x["line"])):
        print(f"{f['file']}:{f['line']}  in {f['func']}()")
