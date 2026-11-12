"""Read-only source audit: python scripts/verify-phase-talk.py aaaa.docx qqqa.docx."""
import sys,json,hashlib,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
source=Path(__file__).resolve().parents[1]/'src/phasePlay/phaseTalkSources.ts'
records=json.loads(source.read_text().split(' = ',1)[1].removesuffix(' as const;\n'))
expected=['995c47f15d676d4b264da3a4ed69e970679d72beb0126e69fea38c83597520f4','4218917802fee359c7672bbfca845c1b6c0ae0a802ffa9c348950da570b2b6cd']
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
for library,path,digest in zip(records,sys.argv[1:],expected):
 raw=Path(path).read_bytes();assert hashlib.sha256(raw).hexdigest()==digest,'Original file hash mismatch'
 with zipfile.ZipFile(path) as z:
  body=ET.fromstring(z.read('word/document.xml')).find('w:body',ns)
  nodes=body.findall('w:p',ns)
  numbering=ET.fromstring(z.read('word/numbering.xml')) if 'word/numbering.xml' in z.namelist() else ET.Element('numbering')
  actual_markers={}
  counters={}
  for i,p in enumerate(nodes,1):
   num=p.find('w:pPr/w:numPr/w:numId',ns)
   if num is None or num.attrib.get('{'+ns['w']+'}val')=='0':continue
   num_id=num.attrib['{'+ns['w']+'}val']
   entry=next(n for n in numbering.findall('w:num',ns) if n.attrib['{'+ns['w']+'}numId']==num_id)
   aid=entry.find('w:abstractNumId',ns).attrib['{'+ns['w']+'}val']
   abstract=next(n for n in numbering.findall('w:abstractNum',ns) if n.attrib['{'+ns['w']+'}abstractNumId']==aid)
   level=abstract.find('w:lvl',ns)
   start=int(level.find('w:start',ns).attrib['{'+ns['w']+'}val'])
   value=counters.get(num_id,start);counters[num_id]=value+1
   actual_markers[i]=level.find('w:lvlText',ns).attrib['{'+ns['w']+'}val'].replace('%1',str(value))
  assert actual_markers=={r['paragraph']:r['marker'] for r in library['paragraphs'] if 'marker' in r},'Word list numbering mismatch'
  paragraphs=[''.join(n.text or '' if n.tag.endswith('}t') else '\t' if n.tag.endswith('}tab') else '\n' for n in p.iter() if n.tag.split('}')[-1] in ('t','tab','br','cr')) for p in body.findall('w:p',ns)]
 assert paragraphs==[r['text'] for r in library['paragraphs']],'Paragraph content/order mismatch'
 rows=[r for r in library['paragraphs'] if 'phase' in r]
 print(library['mode'],len(rows),{phase:sum(r['phase']==phase for r in rows) for phase in ['red','yellow','green']},'all original characters verified')
assert len(sys.argv)==3,'Provide both original DOCX paths'
