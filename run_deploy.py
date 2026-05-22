import subprocess, sys, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# Inject node/npm paths so node.exe is available to any .cmd scripts
env = os.environ.copy()
env['PATH'] = os.pathsep.join([
    r'C:\nvm4w\nodejs',
    r'C:\Users\danse\AppData\Roaming\npm',
]) + os.pathsep + env.get('PATH', '')

result = subprocess.run(
    [sys.executable, 'bspline-frame-builder/deploy_cloudflare.py'],
    capture_output=True, text=True, encoding='utf-8', errors='replace',
    env=env
)
with open('deploy_log.txt', 'w', encoding='utf-8') as f:
    f.write('DEPLOY EXIT CODE: ' + str(result.returncode) + '\n\nSTDOUT:\n')
    f.write(result.stdout or '(empty)\n')
    f.write('\nSTDERR:\n')
    f.write(result.stderr or '(empty)\n')
