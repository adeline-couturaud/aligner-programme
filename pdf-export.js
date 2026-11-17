/* PDF local : aucune réponse ni photo n’est envoyée à un service de conversion. */
(function(global){
'use strict';
function clean(value){
 return String(value||'').replace(/\u00a0|\u202f/g,' ').replace(/[\u2018\u2019]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/[^\u0009\u000a\u000d\u0020-\u00ff\u0152\u0153\u20ac]/g,'').trim();
}
function text(node){return clean(node?.textContent)}
function readSheet(root,tips){
 const sheet=root.querySelector(tips?'.tips-sheet':'.bilan-sheet');
 if(!sheet)throw new Error('Le document à exporter est introuvable.');
 return {
  title:text(sheet.querySelector(tips?'.bilan-hero h2':'.bilan-hero h1')),
  intro:text(sheet.querySelector('.bilan-hero p')),
  identity:Array.from(sheet.querySelectorAll('.bilan-identity span'),text),
  sections:Array.from(sheet.querySelectorAll('.bilan-section'),section=>({
   title:text(section.querySelector('h2,h3')),
   intro:text(section.querySelector('.bilan-section-heading p')),
   items:Array.from(section.querySelectorAll('.bilan-item'),item=>({
    title:text(item.querySelector('h3,h4')),
    day:text(item.querySelector('.bilan-item-heading span')),
    // innerText retains user-entered line breaks in the visible preview.
    body:clean(item.querySelector('p')?.innerText||item.querySelector('p')?.textContent)
   }))
  })),
  photos:Array.from(root.querySelectorAll('.bilan-print-photos figure'),figure=>({
   url:figure.querySelector('img')?.getAttribute('src')||'',
   caption:text(figure.querySelector('figcaption'))
  })),
  disclaimer:text(root.querySelector('.bilan-print-disclaimer'))
 };
}
function imageData(photo){
 return new Promise((resolve,reject)=>{
  const img=new Image();img.crossOrigin='anonymous';
  const timeout=setTimeout(()=>{img.onload=img.onerror=null;reject(new Error('Une photo ne se charge pas. Réessayez ou exportez sans les photos.'));},15000);
  img.onerror=()=>{clearTimeout(timeout);reject(new Error('Une photo est indisponible. Réessayez ou exportez sans les photos.'));};
  img.onload=()=>{clearTimeout(timeout);try{
   const ratio=Math.min(1,1400/Math.max(img.naturalWidth,img.naturalHeight));
   const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.naturalWidth*ratio));canvas.height=Math.max(1,Math.round(img.naturalHeight*ratio));
   const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Image indisponible');
   ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
   resolve({...photo,data:canvas.toDataURL('image/jpeg',0.85),width:canvas.width,height:canvas.height});
  }catch(e){reject(new Error('Impossible d’intégrer une photo. Réessayez ou exportez sans les photos.'));}};
  img.src=photo.url;
 });
}
async function create(root,tips){
 if(!global.jspdf?.jsPDF)throw new Error('Le module PDF ne s’est pas chargé. Fermez puis rouvrez le carnet avec une connexion Internet.');
 const model=readSheet(root,tips);
 if(!model.title||!model.sections.length)throw new Error('Le document n’est pas encore prêt.');
 const images=[];for(const photo of model.photos)images.push(await imageData(photo));
 const doc=new global.jspdf.jsPDF({unit:'mm',format:'a4',compress:true});
 doc.setProperties({title:model.title,author:'Aligner Conseil',subject:tips?'Mes 21 conseils':'Ma boussole style'});
 const left=17,width=176,bottom=276;let y=22;
 const page=()=>{doc.addPage();y=20};
 const ensure=h=>{if(y+h>bottom)page()};
 function paragraph(value,size=11,bold=false,color=[35,61,56]){
  if(!value)return;
  doc.setFont('helvetica',bold?'bold':'normal');doc.setFontSize(size);doc.setTextColor(...color);
  const lines=doc.splitTextToSize(clean(value),width);const step=size*0.3528*1.45;
  for(const line of lines){ensure(step);doc.text(line,left,y);y+=step;}
  y+=3;
 }
 paragraph('ALIGNER CONSEIL | MON CARNET ALIGNÉ',9,true,[0,109,119]);
 paragraph(model.title,23,true,[11,73,63]);
 paragraph(model.intro,11);
 for(const identity of model.identity)paragraph(identity,10);
 y+=3;
 for(const section of model.sections){
  ensure(24);paragraph(section.title,15,true,[11,73,63]);paragraph(section.intro,10);
  for(const item of section.items){
   ensure(23);paragraph([item.day,item.title].filter(Boolean).join(' | '),11,true,[164,43,80]);
   paragraph(item.body,11);y+=2;
  }
 }
 if(model.disclaimer){ensure(18);paragraph(model.disclaimer,9,false,[90,105,99]);}
 for(let i=0;i<images.length;i++){
  if(i%2===0){page();paragraph('Mes souvenirs en images',16,true,[11,73,63]);}
  const image=images[i];const scale=Math.min(width/image.width,100/image.height);
  const w=image.width*scale,h=image.height*scale;
  doc.addImage(image.data,'JPEG',left+(width-w)/2,y,w,h);y+=h+6;
  paragraph(image.caption,10);y+=8;
 }
 const count=doc.getNumberOfPages();
 for(let p=1;p<=count;p++){doc.setPage(p);doc.setFont('helvetica','normal');doc.setFontSize(9);doc.setTextColor(90,105,99);doc.text('Aligner Conseil',left,287);doc.text(p+' / '+count,193,287,{align:'right'});}
 return {blob:doc.output('blob'),filename:tips?'Mes-21-conseils-Aligner-Conseil.pdf':'Ma-boussole-style-Aligner-Conseil.pdf'};
}
async function share(file){
 if(typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]})){
  await navigator.share({files:[file],title:'Mon Carnet Aligné'});return true;
 }
 return false;
}
global.CarnetPDF={create,readSheet,share};
})(window);
