import cv2, numpy as np
from PIL import Image
SRC='/root/.claude/uploads/559195d0-7eb8-5848-b1a0-f5a56ce220f6/9465c280-image.jpg'
im=cv2.imread(SRC)            # BGR 2752x1536
H,W=im.shape[:2]
# quadrado de recorte: cabeça inteira (cabelo→queixo+pescoço), com folga lateral transparente
side=2000; cx=765; y0=230
x0=cx-side//2
pad=np.full((side,side,3),204,np.uint8)
sx0=max(0,x0); sx1=min(W,x0+side)
pad[:, sx0-x0:sx1-x0]=im[y0:y0+side, sx0:sx1]
valid=np.zeros((side,side),np.uint8); valid[:, sx0-x0:sx1-x0]=255
S=800
small=cv2.resize(pad,(S,S),interpolation=cv2.INTER_AREA)
vsmall=cv2.resize(valid,(S,S),interpolation=cv2.INTER_NEAREST)
b,g,r=[small[...,i].astype(int) for i in range(3)]
sat=np.max(small,2).astype(int)-np.min(small,2).astype(int)
neutral=(sat<=7)&(np.min(small,2)>=185)
# fundo certo = neutro claro conectado à borda
lab=np.zeros((S+2,S+2),np.uint8)
bgm=np.zeros((S,S),np.uint8)
n,cc=cv2.connectedComponents(neutral.astype(np.uint8))
border=set(np.unique(np.concatenate([cc[0],cc[-1],cc[:,0],cc[:,-1]])))-{0}
for k in border: bgm[cc==k]=1
bgm[vsmall==0]=1
yy,xx=np.mgrid[0:S,0:S]
core=(((xx-S*0.50)/(S*0.24))**2+((yy-S*0.47)/(S*0.30))**2)<1
mask=np.full((S,S),cv2.GC_PR_FGD,np.uint8)
# prováveis: faixa fina em volta do fundo certo como PR_BGD
dil=cv2.dilate(bgm,np.ones((9,9),np.uint8))
mask[(dil==1)&(bgm==0)&(~core)]=cv2.GC_PR_BGD
# primeiro plano certo: elipse do rosto/cabelo
mask[core]=cv2.GC_FGD
mask[bgm==1]=cv2.GC_BGD
bg_model=np.zeros((1,65));fg_model=np.zeros((1,65))
cv2.grabCut(small,mask,None,bg_model,fg_model,6,cv2.GC_INIT_WITH_MASK)
fg=((mask==cv2.GC_FGD)|(mask==cv2.GC_PR_FGD)).astype(np.uint8)
# manchas neutras claras (xadrez) que sobraram fora do rosto central
mouthbox=np.zeros((S,S),bool); mouthbox[int(S*0.55):int(S*0.72), int(S*0.30):int(S*0.70)]=True
eyebox=np.zeros((S,S),bool); eyebox[int(S*0.30):int(S*0.52), int(S*0.15):int(S*0.85)]=True
stray=neutral & ~mouthbox & ~eyebox
stray=cv2.morphologyEx(stray.astype(np.uint8),cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
fg[stray==1]=0
hairband=np.zeros((S,S),bool); hairband[:int(S*0.42),:]=True
mn=np.min(small,2).astype(int)
stray2=hairband & (sat<=16) & (mn>=120)
stray2=cv2.dilate(stray2.astype(np.uint8),np.ones((3,3),np.uint8))
fg[stray2==1]=0
n,lbl,st,_=cv2.connectedComponentsWithStats(fg)
big=1+np.argmax(st[1:,cv2.CC_STAT_AREA]); fg=(lbl==big).astype(np.uint8)
# fecha buracos internos
inv=1-fg; n,lbl,st,_=cv2.connectedComponentsWithStats(inv)
for k in range(1,n):
    x,y,w,h,a=st[k]
    if a<4000 and not (x==0 or y==0 or x+w==S or y+h==S): fg[lbl==k]=1
cv2.imwrite('mask_small.png',fg*255); cv2.imwrite('small.png',small)
np.save('fg.npy',fg)
print('ok',fg.mean())
