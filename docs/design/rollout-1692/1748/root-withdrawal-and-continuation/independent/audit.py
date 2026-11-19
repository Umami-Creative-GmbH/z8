from review import *
import re, zlib, struct, binascii
base=ROOT/'docs/design/rollout-1692/1748'
manifest=json.loads((base/'manifest.json').read_text())
audit=[]
for f in manifest['files']:
 p=(base/f['path']).resolve(); assert p.is_relative_to(base)
 b=p.read_bytes(); canonical=b.replace(b'\r\n',b'\n') if p.suffix!='.png' else b
 row=dict(path=f['path'],bytes=len(b),sha256=digest(b),rawMatch=digest(b)==f['sha256'],canonicalMatch=digest(canonical)==(f.get('canonicalLfSha256') or f['sha256']))
 if p.suffix=='.json':
  value=json.loads(b); row['parsed']=True; row['shape']=type(value).__name__
 if p.suffix=='.png':
  assert b[:8]==b'\x89PNG\r\n\x1a\n'; pos=8; data=b''; chunks=[]
  while pos<len(b):
   length=struct.unpack('>I',b[pos:pos+4])[0]; kind=b[pos+4:pos+8]; block=b[pos+8:pos+8+length]; crc=struct.unpack('>I',b[pos+8+length:pos+12+length])[0]
   assert binascii.crc32(kind+block)&0xffffffff==crc
   if kind==b'IHDR': w,h,depth,color,compression,filter,interlace=struct.unpack('>IIBBBBB',block)
   if kind==b'IDAT': data+=block
   chunks.append(kind.decode()); pos+=length+12
  decoded=zlib.decompress(data); channels={0:1,2:3,4:2,6:4}[color]; assert depth==8 and interlace==0
  stride=w*channels; assert len(decoded)==h*(stride+1); prev=bytearray(stride)
  for y in range(h):
   ftype=decoded[y*(stride+1)]; assert ftype in range(5); scan=bytearray(decoded[y*(stride+1)+1:(y+1)*(stride+1)])
   for x in range(stride):
    a=scan[x-channels] if x>=channels else 0; bb=prev[x]; c=prev[x-channels] if x>=channels else 0
    if ftype==1: scan[x]=(scan[x]+a)&255
    elif ftype==2: scan[x]=(scan[x]+bb)&255
    elif ftype==3: scan[x]=(scan[x]+((a+bb)//2))&255
    elif ftype==4:
     q=a+bb-c; aa,ab,ac=abs(q-a),abs(q-bb),abs(q-c); scan[x]=(scan[x]+(a if aa<=ab and aa<=ac else bb if ab<=ac else c))&255
   prev=scan
  row['png']=dict(width=w,height=h,depth=depth,channels=channels,crcAndDecode=True)
 audit.append(row)
assert all(x['rawMatch'] or x['canonicalMatch'] for x in audit)
links=[]
report=ROOT/'docs/design/rollout-1692/1748.md'; content=report.read_text()
for target in re.findall(r'\]\(([^)]+)\)',content):
 if not re.match(r'\w+://',target) and not target.startswith('#'):
  q=(report.parent/target.split('#')[0]); links.append(dict(target=target,exists=q.exists()))
assert all(x['exists'] for x in links)
save('archive-audit.json',dict(originalPaths=75,manifestPayloads=73,manifestAndReport=2,files=audit,links=links,boundary='Public originals read; no archived scripts executed. Hash preservation and historical content acceptance are distinct. Raw logs and original JSON are not copied to SAFE.'))
ledger=json.loads((ROOT/'docs/design/rollout-1692/integration.json').read_text()); anchors=[]
for t in [ledger['baseline'],*ledger['tickets']]:
 if t.get('verifiedCommit'):
  sha=t['verifiedCommit']; result=subprocess.run(['git','merge-base','--is-ancestor',sha,'HEAD'],cwd=ROOT).returncode
  anchors.append(dict(issue=t['issue'],commit=sha,ancestor=result==0))
assert all(a['ancestor'] for a in anchors)
save('anchors.json',dict(ticketAnchors=len(anchors)-1,baseline=1,anchors=anchors,latestVerified='69c9ed3a86410848885f78f5a7bcdf5f468c4323'))
pins=[]
for kind,ref in [('before','cab40dcbb6ea69cefb7aa919228298a881a66060'),('after','6144dbb54f4398436ec6b95ad37ef32fd6ab0ca8')]:
 for f in json.loads((base/kind/'source.json').read_text())['files']:
  b=subprocess.check_output(['git','show',ref+':'+f['file']],cwd=ROOT)
  pins.append(dict(kind=kind,path=f['file'],reference=ref,expected=f['sha256'],gitSha256=digest(b),lfSha256=digest(b.replace(b'\r\n',b'\n')),crlfSha256=digest(b.replace(b'\r\n',b'\n').replace(b'\n',b'\r\n')),parentBlobMatches=(not f.get('parentBlob') or git('rev-parse',ref+':'+f['file'])==f['parentBlob'])))
save('historical-source-pins.json',pins)
print('Archive',len(audit),'verified; anchors',len(anchors)-1,'plus baseline; links',len(links))
