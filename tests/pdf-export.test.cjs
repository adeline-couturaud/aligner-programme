const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const base=process.env.PDF_TEST_BASE||path.join(__dirname,'..');
const vendor=process.env.PDF_TEST_VENDOR||path.join(base,'vendor/jspdf-4.2.1.umd.min.js');
const {jsPDF}=require(vendor);
const node=(value)=>({textContent:value,innerText:value});
const item=(i,long=false)=>({querySelector(s){if(s==='h3,h4')return node('Repère '+i);if(s==='.bilan-item-heading span')return node('JOUR '+i);if(s==='p')return node(long?'Une réponse personnelle très longue avec détails, matières et ajustements. '.repeat(300):'Mon repère '+i+' : préférer le bleu, essayer, ajuster.');}});
const section=(start,end,long=false)=>({querySelector(s){return s==='h2,h3'?node('Mes choix du quotidien'):null},querySelectorAll(){return Array.from({length:end-start+1},(_,i)=>item(start+i,long&&i===0));}});
function fixture(tips,long=false){
 const sheet={querySelector(s){return s.includes(' h1')||s.includes(' h2')?node(tips?'Mes 21 conseils':'Ma boussole style'):node('Des repères à conserver.');},querySelectorAll(s){return s==='.bilan-identity span'?[node('Mon carnet : Test synthétique')]:[section(1,7,long),section(8,14),section(15,21)];}};
 return {querySelector(s){return s==='.bilan-print-disclaimer'?node('Synthèse personnelle Aligner Conseil.'):sheet},querySelectorAll(){return []}};
}
(async()=>{
 const navigator={};
 const window={jspdf:{jsPDF}};
 vm.runInNewContext(fs.readFileSync(path.join(base,'pdf-export.js'),'utf8'),{window,navigator,Image:class{},setTimeout,clearTimeout,document:{}});
 for(const tips of [false,true]){
  const result=await window.CarnetPDF.create(fixture(tips,true),tips);
  assert.equal(result.blob.type,'application/pdf');
  const bytes=Buffer.from(await result.blob.arrayBuffer());
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
  assert(bytes.length>5000);
  if(process.env.PDF_TEST_OUTPUT)fs.writeFileSync(path.join(process.env.PDF_TEST_OUTPUT,tips?'tips.pdf':'bilan.pdf'),bytes);
 }
 let shared=0;
 navigator.canShare=()=>true;navigator.share=async()=>{shared++};
 assert.equal(await window.CarnetPDF.share({name:'test.pdf'}),true);assert.equal(shared,1);
 navigator.canShare=()=>false;assert.equal(await window.CarnetPDF.share({}),false);assert.equal(shared,1);
 navigator.canShare=()=>true;navigator.share=async()=>{const e=new Error('Annulé');e.name='AbortError';throw e};
 await assert.rejects(()=>window.CarnetPDF.share({}),e=>e.name==='AbortError');
 delete navigator.share;assert.equal(await window.CarnetPDF.share({}),false);
 const context={window:{},navigator};vm.runInNewContext(fs.readFileSync(path.join(base,'pdf-export.js'),'utf8'),context);
 await assert.rejects(()=>context.window.CarnetPDF.create(fixture(false),false),/module PDF/);

 // Exercise the UI preparation without invoking window.print or a popup.
 const app=fs.readFileSync(path.join(base,'app.js'),'utf8');
 const helper=app.slice(app.indexOf('async function prepareBilanPdf('),app.indexOf('\nfunction communityHTML()'));
 const button={},link={hidden:true,click(){this.clicked=true}},status={};
 const preview={isConnected:true,querySelector(s){return s==='#saveBilanPdf'?button:s==='#downloadBilanPdf'?link:status}};
 const ui={window:{CarnetPDF:{create:async()=>({blob:new Blob(['pdf'],{type:'application/pdf'}),filename:'test.pdf'}),share:async()=>false}},File,URL:{createObjectURL:()=> 'blob:local-test',revokeObjectURL(){}},bilanPdfUrl:'',Blob};
 vm.createContext(ui);vm.runInContext(helper+';this.prepareBilanPdf=prepareBilanPdf',ui);
 await ui.prepareBilanPdf(preview,false);
 assert.equal(button.disabled,false);assert.equal(link.hidden,false);assert.equal(link.download,'test.pdf');assert.equal(link.href,'blob:local-test');
 await button.onclick();assert.equal(link.clicked,true);
 ui.window.CarnetPDF.share=async()=>{const e=new Error('cancel');e.name='AbortError';throw e};
 await button.onclick();assert.match(status.textContent,/annulé/);
 ui.window.CarnetPDF.create=async()=>{throw new Error('photo indisponible')};
 await ui.prepareBilanPdf(preview,false);assert.match(status.textContent,/photo indisponible/);assert.equal(button.disabled,false);assert.match(button.textContent,/Réessayer/);
 assert(app.includes("const usePhotos=!tips&&!!document.getElementById('bilanPhotos')?.checked"));

 console.log('PASS : deux PDF réels avec 21 conseils et réponse longue ; partage disponible, indisponible et annulé ; erreur explicite si module absent.');
})().catch(e=>{console.error(e);process.exit(1)});
