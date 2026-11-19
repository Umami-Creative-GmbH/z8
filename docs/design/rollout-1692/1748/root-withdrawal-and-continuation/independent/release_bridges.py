from review import *
entries=json.loads((SAFE/'bridges.json').read_text()); released=[]
for e in entries:
 p=(ROOT/e['path']).resolve(); assert p.is_relative_to(ROOT)
 if not p.exists():
  b=(SAFE/p.name).read_bytes(); assert digest(b)==e['sha256'] and len(b)==e['bytes']
  released.append(dict(**e,removed=True,absent=True)); continue
 assert p.is_file()
 b=p.read_bytes(); assert digest(b)==e['sha256'] and len(b)==e['bytes']
 (SAFE/p.name).write_bytes(b); p.unlink(); released.append(dict(**e,removed=True,absent=not p.exists()))
save('bridge-cleanup.json',released)
