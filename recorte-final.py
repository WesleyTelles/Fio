import cv2, numpy as np
small=cv2.imread('small.png'); fg=np.load('fg.npy')
S=small.shape[0]
k=np.ones((3,3),np.uint8)
core=cv2.erode(fg,k,iterations=2)
band=((fg==1)&(core==0)).astype(np.uint8)*255
clean=cv2.inpaint(small,band,3,cv2.INPAINT_TELEA)          # remove halo claro do xadrez nas bordas
m=cv2.erode(fg,k,iterations=1).astype(np.float32)
a=cv2.GaussianBlur(m,(0,0),1.3)
a=np.clip((a-0.15)/0.7,0,1)
rgba=np.dstack([clean, (a*255).astype(np.uint8)])
cv2.imwrite('cut800.png',rgba)
# prévia: sobre fundo escuro com anel lima
def prev(size):
    r=cv2.resize(rgba,(size,size),interpolation=cv2.INTER_AREA).astype(np.float32)
    bg=np.zeros((size,size,3),np.float32); bg[:]=(0x15,0x19,0x18)  # BGR de #181915
    al=r[...,3:4]/255; out=r[...,:3]*al+bg*(1-al)
    yy,xx=np.mgrid[0:size,0:size]; d=np.hypot(xx-size/2+.5,yy-size/2+.5)
    out=out.astype(np.uint8); c=(d>size/2-size*0.03)
    out[c]=(0x40,0xFF,0xD5)
    out[d>size/2]=(0x0F,0x11,0x10)
    return out
cv2.imwrite('prev_big.png',prev(480))
sheet=np.full((480,480+8+192+8+64,3),(0x0F,0x11,0x10),np.uint8)
sheet[:, :480]=prev(480); sheet[:192,488:680]=prev(192); sheet[200:264,688-200+200:688-200+264] if False else None
cv2.imwrite('prev_sheet.png',sheet)
cv2.imwrite('prev_64.png',cv2.resize(prev(192),(64,64),interpolation=cv2.INTER_AREA))
