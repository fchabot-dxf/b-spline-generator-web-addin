import os, json
import datetime
import traceback

class DebugLogger:
    """Robust logger that writes into the add-in folder for add-in debugging."""
    def __init__(self, addin_root):
        self.addin_root = addin_root
        self.log_paths = [os.path.join(addin_root, "frame-builder-debug.log")]
        self.max_log_lines = 12000
        self.keep_log_lines = 9000
        self._purge_check_every = 200
        self._log_write_count = 0
        self.notifications = [] # Collects user-facing warnings/errors
        
        # Check for project handshake to log into source folder as well
        try:
            import json
            handshake_path = os.path.join(addin_root, 'project_path.json')
            if os.path.exists(handshake_path):
                with open(handshake_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    source_dir = config.get('project_root')
                    if source_dir and os.path.isdir(source_dir):
                        # Ensure the target directory exists (it should)
                        src_log = os.path.join(source_dir, 'frame-builder-debug.log')
                        self.log_paths.append(src_log)
        except:
            pass

    def _purge_if_needed(self, path):
        try:
            if not os.path.exists(path):
                return
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
            if len(lines) <= self.max_log_lines:
                return
            kept = lines[-self.keep_log_lines:]
            with open(path, "w", encoding="utf-8") as f:
                f.writelines(kept)
        except:
            pass

    def log(self, message, level="INFO"):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        entry = f"[{timestamp}] [{level}] {message}\n"
        
        # User-facing summary collection
        if level in ("ERROR", "WARNING"):
            # Simplify very techy messages for the pop-up
            clean = message.split('|')[0].strip()
            if clean not in self.notifications:
                self.notifications.append(f"• {level}: {clean}")

        self._log_write_count += 1
        for path in self.log_paths:
            try:
                with open(path, "a", encoding="utf-8") as f:
                    f.write(entry)
                if self._log_write_count % self._purge_check_every == 0:
                    self._purge_if_needed(path)
            except:
                pass # Silent fallback if one location is locked

    def log_error(self, message):
        error_info = traceback.format_exc()
        self.log(f"ERROR: {message}\n{error_info}", "ERROR")

    def session_start(self, title):
        self.notifications = []
        self.log("\n" + "="*50)
        self.log(f"STARTING SESSION: {title}")
        self.log("="*50 + "\n")
