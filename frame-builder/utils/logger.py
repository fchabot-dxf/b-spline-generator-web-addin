import os, json
import datetime
import traceback

class DebugLogger:
    """Robust logger that writes into the add-in folder for add-in debugging."""
    def __init__(self, addin_root):
        self.addin_root = addin_root
        self.log_paths = [os.path.join(addin_root, "frame-builder-debug.log")]
        
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

    def log(self, message, level="INFO"):
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        entry = f"[{timestamp}] [{level}] {message}\n"
        for path in self.log_paths:
            try:
                with open(path, "a", encoding="utf-8") as f:
                    f.write(entry)
                
                # Check line count and truncate to 2000 if necessary
                with open(path, "r", encoding="utf-8") as f:
                    lines = f.readlines()
                if len(lines) > 2000:
                    with open(path, "w", encoding="utf-8") as f:
                        f.writelines(lines[-2000:])
            except:
                pass # Silent fallback if one location is locked

    def log_error(self, message):
        error_info = traceback.format_exc()
        self.log(f"ERROR: {message}\n{error_info}", "ERROR")

    def session_start(self, title):
        self.log("\n" + "="*50)
        self.log(f"STARTING SESSION: {title}")
        self.log("="*50 + "\n")
