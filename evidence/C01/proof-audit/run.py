from pathlib import Path
import subprocess,json
root=Path(__file__).resolve().parents[3]
commands=[['./node_modules/.bin/tsc','-p','evidence/C01/proof-audit/tsconfig.json'],['node','--experimental-strip-types','evidence/C01/proof-audit/normalization.ts']]
results=[]
for command in commands:
    r=subprocess.run(command,cwd=root,text=True,capture_output=True)
    results.append({'command':command,'exit_code':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
print(json.dumps(results,ensure_ascii=False,indent=2))
raise SystemExit(0 if all(r['exit_code']==0 for r in results) else 1)
