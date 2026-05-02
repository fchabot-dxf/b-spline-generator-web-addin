import os, json
import datetime
import traceback

class DebugLogger:
    """Robust logger that writes into the add-in folder and syncs to workspace."""
    def __init__(self, addin_root, category=None):
        self.addin_root = addin_root
        self.category = self._normalize_category(category)
        self.enabled = os.getenv('FB_DEBUG_LOG', '1').strip().lower() in ('1', 'true', 'yes', 'on')
        self.log_paths = []
        self.phase_id = None  # NEW: Tracks current construction phase (e.g., p4_anatomy)

        if not self.enabled:
            return

        # 1. Primary Log: Always in the deployed AddIn folder (failsafe)
        self.log_paths = [os.path.join(addin_root, self._log_name())]
        
        # 2. Handshake Discovery: search root and frame-builder subdir
        try:
            candidates = [
                os.path.join(addin_root, 'project_path.json'),
                os.path.join(os.path.dirname(addin_root), 'project_path.json'),
                os.path.join(addin_root, 'frame-builder', 'project_path.json')
            ]
            
            for handshake_path in candidates:
                if os.path.exists(handshake_path):
                    with open(handshake_path, 'r', encoding='utf-8') as f:
                        config = json.load(f)
                        source_dir = config.get('project_root')
                    if source_dir:
                        full_source_dir = os.path.normpath(os.path.expanduser(source_dir))
                        if os.path.isdir(full_source_dir):
                            src_log = os.path.join(full_source_dir, self._log_name())
                            if src_log not in self.log_paths:
                                self.log_paths.append(src_log)
                                break # Found it
        except:
            pass

        # Truncate every log file on addin start so each session begins
        # with a clean slate. (session_start() still uses _cap_log_file for
        # its mid-session trimming, so logs aren't wiped while you're
        # working — only at addin start / reload.)
        for path in self.log_paths:
            try:
                open(path, 'w', encoding='utf-8').close()
            except:
                pass

        self.log(f"LOGGER INITIALIZED. ACTIVE PATHS: {len(self.log_paths)}")

    def log(self, message, level="INFO"):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        phase_prefix = f" [{self.phase_id}]" if self.phase_id else ""
        entry = f"[{timestamp}] [{level}]{phase_prefix} {message}\n"
        
        for path in self.log_paths:
            try:
                # Open with 'a' for append, then immediately flush/sync
                with open(path, "a", encoding="utf-8") as f:
                    f.write(entry)
                    f.flush()
                    try:
                        os.fsync(f.fileno())
                    except: pass
            except:
                pass

    def _cap_log_file(self, path, max_lines=5000):
        try:
            if not os.path.exists(path):
                return
            with open(path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            if len(lines) > max_lines:
                with open(path, 'w', encoding='utf-8') as f:
                    f.writelines(lines[-max_lines:])
        except:
            pass

    def log_error(self, message):
        self.log(f"ERROR: {message}", "ERROR")

    def session_start(self, title):
        # Cap logs on session start to keep files lean without constant I/O overhead
        for path in self.log_paths:
            self._cap_log_file(path)

        self.log("\n" + "="*50)
        self.log(f"STARTING SESSION: {title}")
        self.log("="*50 + "\n")


    def _normalize_category(self, category):
        if not category:
            return None
        normalized = str(category).strip().lower().replace(' ', '_')
        return normalized if normalized else None

    def _log_name(self):
        if self.category:
            return f"frame-builder-{self.category}-debug.log"
        return "frame-builder-debug.log"

