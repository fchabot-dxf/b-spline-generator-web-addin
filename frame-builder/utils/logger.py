import os, json
import datetime
import traceback

class DebugLogger:
    """Robust logger that manages multiple channels for modular debugging."""
    def __init__(self, addin_root):
        self.addin_root = addin_root
        self.max_log_lines = 12000
        self.keep_log_lines = 9000
        self._purge_check_every = 200
        self._log_write_count = 0
        self.notifications = [] 

        # Base Log Definitions
        self.sketch_logs = [os.path.join(addin_root, "frame-builder-sketch.log")]
        self.solid_logs = [os.path.join(addin_root, "frame-builder-solid.log")]
        self.debug_logs = [os.path.join(addin_root, "frame-builder-debug.log")]

        # Project Handshake
        try:
            handshake_path = os.path.join(addin_root, 'project_path.json')
            if os.path.exists(handshake_path):
                with open(handshake_path, 'r', encoding='utf-8') as f:
                    config = json.load(f)
                    source_dir = config.get('project_root')
                    if source_dir and os.path.isdir(source_dir):
                        self.sketch_logs.append(os.path.join(source_dir, "frame-builder-sketch.log"))
                        self.solid_logs.append(os.path.join(source_dir, "frame-builder-solid.log"))
                        self.debug_logs.append(os.path.join(source_dir, "frame-builder-debug.log"))
        except: pass

    def _purge_if_needed(self, path):
        try:
            if not os.path.exists(path): return
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                lines = f.readlines()
            if len(lines) <= self.max_log_lines: return
            kept = lines[-self.keep_log_lines:]
            with open(path, "w", encoding="utf-8") as f:
                f.writelines(kept)
        except: pass

    def _write_to_paths(self, paths, entry):
        self._log_write_count += 1
        for path in paths:
            try:
                with open(path, "a", encoding="utf-8") as f:
                    f.write(entry)
                if self._log_write_count % self._purge_check_every == 0:
                    self._purge_if_needed(path)
            except: pass

    def log_sketch(self, message, level="INFO"):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        entry = f"[{timestamp}] [{level}] {message}\n"
        self._write_to_paths(self.sketch_logs, entry)
        self._write_to_paths(self.debug_logs, f"[SKETCH] {entry}")

    def log_solid(self, message, level="INFO"):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        entry = f"[{timestamp}] [{level}] {message}\n"
        self._write_to_paths(self.solid_logs, entry)
        self._write_to_paths(self.debug_logs, f"[SOLID]  {entry}")

    def log(self, message, level="INFO"):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        entry = f"[{timestamp}] [{level}] {message}\n"
        self._write_to_paths(self.debug_logs, entry)
        
        if level in ("ERROR", "WARNING"):
            clean = message.split('|')[0].strip()
            if clean not in self.notifications:
                self.notifications.append(f"• {level}: {clean}")

    def log_error(self, message):
        error_info = traceback.format_exc()
        self.log(f"ERROR: {message}\n{error_info}", "ERROR")

    def session_start(self, title):
        self.notifications = []
        div = "="*50
        header = f"\n{div}\n[{datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] STARTING SESSION: {title}\n{div}\n"
        self._write_to_paths(self.debug_logs, header)
        self._write_to_paths(self.sketch_logs, header)
        self._write_to_paths(self.solid_logs, header)
