import subprocess,pathlib,os,json,sys; sys.stdout.reconfigure(encoding="utf-8")
s=pathlib.Path(os.environ['TEMP'])/'z8-r165-review-bceb0ee-SAFE'
args=sys.argv[2:]; name=sys.argv[1];env=dict(os.environ,pnpm_config_verify_deps_before_run='false')
version=subprocess.run(['pnpm.cmd','--config.verify-deps-before-run=false','--version'],capture_output=True,env=env)
(s/(name+'-version.log')).write_bytes(version.stdout+version.stderr)
assert version.returncode==0 and version.stdout.strip()==b'12.16.1',version.stdout
cmd=['pnpm.cmd','--config.verify-deps-before-run=false',*args]
p=subprocess.run(cmd,capture_output=True,env=env)
(s/(name+'.log')).write_bytes(p.stdout+p.stderr)
(s/(name+'-command.json')).write_text(json.dumps({'command':cmd,'environment':{'pnpm_config_verify_deps_before_run':'false'},'exit':p.returncode},indent=2))
print((p.stdout+p.stderr).decode(errors='replace')[-9000:]);print('EXIT',p.returncode);sys.exit(p.returncode)
