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
                                self.log(f"HANDSHAKE SUCCESS: Dual Logging active at {src_log}")
                                break # Found it
        except:
            pass

    def log(self, message, level="INFO"):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        entry = f"[{timestamp}] [{level}] {message}\n"
        
        for path in self.log_paths:
            try:
                # Open with 'a' for append, then immediately flush/sync
                with open(path, "a", encoding="utf-8") as f:
                    f.write(entry)
                    f.flush()
                    try:
                        os.fsync(f.fileno())
                    except: pass # some filesystems don't support fsync
                self._cap_log_file(path)
            except:
                pass # Fail silently on one stream to preserve the other

    def _cap_log_file(self, path, max_lines=1000):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            if len(lines) > max_lines:
                with open(path, 'w', encoding='utf-8') as f:
                    f.writelines(lines[-max_lines:])
        except:
            pass

    def log_error(self, message):
        # We don't call traceback here because typically the caller passes it
        self.log(f"ERROR: {message}", "ERROR")

    def session_start(self, title):
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

