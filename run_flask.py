import subprocess
import sys
import os

# Start Flask as a detached subprocess
flask_proc = subprocess.Popen(
    [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app.py')],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    creationflags=0x00000008  # DETACHED_PROCESS
)
print(f"Flask PID: {flask_proc.pid}")
# Keep this process alive to prevent parent from killing child
flask_proc.wait()
