"""Deterministic platform derivatives of the supplied pixels. No logo drawing."""
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
import hashlib, json, shutil
import argparse

ROOT = Path(__file__).resolve().parents[1]
p = argparse.ArgumentParser(); p.add_argument('--source', type=Path, default=ROOT/'assets/brand/source-original.png'); args=p.parse_args()
brand = ROOT/'assets/brand'; brand.mkdir(parents=True, exist_ok=True)
source = brand/'source-original.png'
if args.source.resolve()!=source.resolve(): shutil.copyfile(args.source, source)
im=Image.open(source).convert('RGB'); width,height=im.size
assert width==height and width>=1000
# The supplied lockup has a separate monogram above the wordmark. Crop only
# existing pixels for small platform icons; the full source remains unchanged.
region=im.crop((0,0,width,round(height*.64)))
minimum=ImageChops.darker(ImageChops.darker(*region.split()[:2]),region.split()[2])
ink=minimum.point(lambda x:255 if x<220 else 0)
box=ink.getbbox(); assert box
mark=region.crop(box).convert('RGBA')
minimum=ImageChops.darker(ImageChops.darker(*mark.convert('RGB').split()[:2]),mark.convert('RGB').split()[2])
alpha=minimum.point(lambda x:0 if x>=245 else 255)
mark.putalpha(alpha)
def contained(canvas, art, fraction):
    out=Image.new('RGBA',(canvas,canvas),(0,0,0,0))
    small=art.copy();small.thumbnail((round(canvas*fraction),round(canvas*fraction)),Image.Resampling.LANCZOS)
    out.alpha_composite(small,((canvas-small.width)//2,(canvas-small.height)//2));return out
def white_icon(size, fraction=.74):
    out=Image.new('RGBA',(size,size),'white');out.alpha_composite(contained(size,mark,fraction));return out.convert('RGB')
def save(image,path):path.parent.mkdir(parents=True,exist_ok=True);image.save(path,optimize=True)
save(mark,brand/'aeris-monogram.png')
lockup=im.copy();lockup.thumbnail((320,320),Image.Resampling.LANCZOS);save(lockup,brand/'aeris-lockup.png');save(lockup,ROOT/'assets/logo.png')
for size in (32,64):save(white_icon(size),brand/f'favicon-{size}.png')
white_icon(64).save(ROOT/'favicon.ico',sizes=[(16,16),(32,32),(48,48),(64,64)])
save(white_icon(180),brand/'apple-touch-icon.png')
save(white_icon(192),ROOT/'icon-192.png');save(white_icon(512),ROOT/'icon-512.png')
save(white_icon(512,.58),brand/'aeris-maskable-512.png')
# OG is the supplied lockup on a plain white field, not an invented mockup.
og=Image.new('RGB',(1200,630),'white');copy=im.copy();copy.thumbnail((540,540),Image.Resampling.LANCZOS);og.paste(copy,((1200-copy.width)//2,(630-copy.height)//2));save(og,brand/'aeris-og.png')
res=ROOT/'android/app/src/main/res'
save(white_icon(192),res/'drawable-nodpi/ic_launcher.png')
foreground=contained(432,mark,50/108)
save(foreground,res/'drawable-nodpi/ic_aeris_foreground.png')
mono=Image.new('RGBA',foreground.size,'white');mono.putalpha(foreground.getchannel('A'))
save(mono,res/'drawable-nodpi/ic_aeris_monochrome.png')
small=contained(96,mark,22/24);small_white=Image.new('RGBA',small.size,'white');small_white.putalpha(small.getchannel('A'))
save(small_white,res/'drawable-nodpi/ic_notification_aeris.png')
for density,scale in [('mdpi',1),('hdpi',1.5),('xhdpi',2),('xxhdpi',3),('xxxhdpi',4)]:
    for name in ['ic_launcher','ic_launcher_round']:save(white_icon(round(48*scale)),res/f'mipmap-{density}/{name}.png')
for version,extra in [('v26',''),('v33','\n    <monochrome android:drawable="@drawable/ic_aeris_monochrome" />')]:
    directory=res/f'mipmap-anydpi-{version}';directory.mkdir(parents=True,exist_ok=True)
    xml='<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n    <background android:drawable="@color/aeris_icon_background" />\n    <foreground android:drawable="@drawable/ic_aeris_foreground" />'+extra+'\n</adaptive-icon>\n'
    for name in ['ic_launcher','ic_launcher_round']:(directory/(name+'.xml')).write_text(xml,encoding='utf-8')
# Verify every non-transparent foreground pixel survives the guaranteed safe circle.
safe=Image.new('L',(432,432));ImageDraw.Draw(safe).ellipse((84,84,348,348),fill=255)
outside=ImageChops.subtract(foreground.getchannel('A'),safe);assert outside.getbbox() is None
outputs=[ROOT/'icon-192.png',ROOT/'icon-512.png',ROOT/'favicon.ico',*brand.glob('*.png'),*res.glob('**/ic_*.png')]
manifest={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sourceSize':im.size,'monogramCrop':box,'operations':['source pixel crop','near-white matte for platform alpha','proportional Lanczos resize','platform safety padding','alpha-only monochrome'],'adaptiveSafeCirclePassed':True,'assets':[{'path':str(f.relative_to(ROOT)).replace('\\','/'),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in outputs]}
(brand/'asset-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
print(json.dumps({'sourceSha256':manifest['sourceSha256'],'crop':box,'assets':len(outputs),'adaptiveSafeCirclePassed':True}))
