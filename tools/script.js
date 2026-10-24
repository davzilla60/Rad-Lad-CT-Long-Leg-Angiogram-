<script>
(function(){
"use strict";
/* ---------------------------------------------------------------
   THE SCANOGRAM — CT lower-limb run-off angiogram simulator ("Legs for Days")
   Patient set-up (feet first) → AP + lateral scanogram (diaphragm → toes) → scan range →
   table speed + bolus tracking OR timed delay → helical run-off rendered slice by slice for
   where the bolus was when the table got there → percentage grade.
   Imaging: composite — KiTS-00026 (CC BY 3.0) chest → L1, licensed stock-video sweep L1 → toes.
   --------------------------------------------------------------- */

var BASE = "./assets/";
/* ---- calibration (tools/gen_assets.py → assets/calib.json) ---- */
var Z_TOTAL = 1301.3, AX_N = 158, AX_STEP = 8;  // composite length (mm); review stack every 8 mm
var IMG_W = 376, FOV_MM = 345.9;                // square axial grid (px) and its FOV
var Z_SEAM = 216.3;                             // join between the two source scans (mm from the top)
var ART_REF = 300;                              // arterial lumen core HU in the stored images
var HU_LUT = [[-1000,0],[-300,60],[600,255]];   // 8-bit encoding of the axial JPEGs
/* landmarks, mm from the top of the scanogram (read off the composite) */
var DOME_MM = 128, COELIAC_MM = 190, RENAL_MM = 250, BIF_MM = 370, FEMHEAD_MM = 490,
    KNEE_MM = 885, ANKLE_MM = 1150, TOE_MM = 1254;
var Z_REF = COELIAC_MM;                         // bolus transit times are measured from the upper abdominal aorta
function F(mm){ return mm/Z_TOTAL; }
var DOME_F = F(DOME_MM), TOE_F = F(TOE_MM);
/* aortic ROI targets per review slice (largest round arterial blob ≥ 12 mm), normalised to IMG_W */
var TARGETS = {"4":{"x":0.5534,"y":0.6002,"r":0.0271},"5":{"x":0.5509,"y":0.6073,"r":0.0267},"6":{"x":0.5502,"y":0.6082,"r":0.0269},"7":{"x":0.5485,"y":0.6057,"r":0.0266},"8":{"x":0.5463,"y":0.6027,"r":0.0265},"9":{"x":0.5447,"y":0.5998,"r":0.026},"10":{"x":0.544,"y":0.5954,"r":0.0257},"11":{"x":0.5438,"y":0.5922,"r":0.0255},"12":{"x":0.5436,"y":0.5903,"r":0.0249},"13":{"x":0.5419,"y":0.5885,"r":0.0249},"14":{"x":0.5388,"y":0.5875,"r":0.025},"15":{"x":0.5352,"y":0.5859,"r":0.0248},"16":{"x":0.5319,"y":0.5826,"r":0.0249},"17":{"x":0.5288,"y":0.5796,"r":0.0244},"18":{"x":0.5252,"y":0.5756,"r":0.0247},"19":{"x":0.5231,"y":0.5726,"r":0.0239},"20":{"x":0.5217,"y":0.5696,"r":0.0241},"21":{"x":0.5203,"y":0.5663,"r":0.0239},"22":{"x":0.5196,"y":0.5643,"r":0.0235},"23":{"x":0.5192,"y":0.5628,"r":0.0229},"24":{"x":0.5169,"y":0.5605,"r":0.0227},"25":{"x":0.5155,"y":0.5433,"r":0.027},"26":{"x":0.5123,"y":0.5462,"r":0.0239},"27":{"x":0.5155,"y":0.5491,"r":0.0213},"28":{"x":0.5418,"y":0.5244,"r":0.0257},"29":{"x":0.5404,"y":0.5173,"r":0.0246},"30":{"x":0.5365,"y":0.5169,"r":0.0236},"31":{"x":0.5318,"y":0.5133,"r":0.0246},"32":{"x":0.5352,"y":0.5084,"r":0.0224},"33":{"x":0.5306,"y":0.5037,"r":0.0197},"34":{"x":0.528,"y":0.4976,"r":0.0197},"35":{"x":0.5269,"y":0.493,"r":0.0188},"36":{"x":0.5237,"y":0.4833,"r":0.0197},"37":{"x":0.5225,"y":0.4803,"r":0.0194},"38":{"x":0.5218,"y":0.4755,"r":0.0193},"39":{"x":0.5204,"y":0.4717,"r":0.0204},"40":{"x":0.5175,"y":0.4742,"r":0.0196},"41":{"x":0.5167,"y":0.4724,"r":0.019},"42":{"x":0.5164,"y":0.4736,"r":0.0189},"43":{"x":0.5156,"y":0.4756,"r":0.0194},"44":{"x":0.5161,"y":0.4771,"r":0.02},"45":{"x":0.5176,"y":0.4858,"r":0.0211}};
var HERO_K = 125;                               // mid-calf slice (tibial arteries) for the close-up
var HERO_CROP = [64, 112, 248];                 // x, y, size (px) around both calves
function axFrac(k){ return (AX_STEP*k)/Z_TOTAL; }
function axForFrac(f){ return Math.max(0, Math.min(AX_N-1, Math.round(f*Z_TOTAL/AX_STEP))); }
function pad3(n){ return (n<10?"00":n<100?"0":"")+n; }
var PNG = { logo_full:1, logo_mark:1, mip_art:1 };
for(var _i=0;_i<AX_N;_i++) PNG["lb_"+pad3(_i)] = 1;

/* ---- asset URL helper (overridden when inlined) ---- */
var ASSETS = window.SCG_ASSETS || null;
function url(name){ return ASSETS ? ASSETS[name] : BASE + name + (PNG[name] ? ".png" : ".jpg"); }

/* ---- DOM ---- */
var $ = function(id){ return document.getElementById(id); };
var stage=$("scgStage"), vp=$("scgViewport"),
    img=$("scgImg"), imgB=$("scgImgB"),
    roiEl=$("scgRoi"), roiTag=$("scgRoiTag"), targetEl=$("scgTarget"),
    acqEl=$("scgAcq"), acqTitle=$("scgAcqTitle"), acqNum=$("scgAcqNum"), acqBig=$("scgAcqBig"),
    watermark=$("scgWatermark"), watermarkTx=$("scgWatermarkTx"),
    vpTL=$("scgVpTL"), vpBL=$("scgVpBL"), vpBR=$("scgVpBR"),
    railTitle=$("scgRailTitle"), railDesc=$("scgRailDesc"), railBody=$("scgRailBody"),
    cmds=$("scgCmds"), cliForm=$("scgCliForm"), cli=$("scgCli"),
    logEl=$("scgLog"), phaseChip=$("scgPhaseChip"),
    titleEl=$("scgTitle"), startBtn=$("scgStart"),
    resultEl=$("scgResult"), room=$("scgRoom"),
    stackUI=$("scgStackUI"), stackSlider=$("scgStackSlider"), winBtns=$("scgWinBtns"),
    levelLine=$("scgLevelLine"), levelTag=$("scgLevelTag"), levelBand=$("scgLevelBand"),
    pip=$("scgPip"), pipImg=$("scgPipImg"), pipLine=$("scgPipLine"), pipBox=$("scgPipBox"),
    rangeBox=$("scgRangeBox"), rangeTopH=$("scgRangeTop"), rangeBotH=$("scgRangeBot"),
    rangeTopTag=$("scgRangeTopTag"), rangeBotTag=$("scgRangeBotTag"), rangeCap=$("scgRangeCap"),
    rangeMaskTop=$("scgRangeMaskTop"), rangeMaskBot=$("scgRangeMaskBot"),
    achWrap=$("scgAch"), achLogo=$("scgAchLogo"), trigEl=$("scgTrig"), trigTx=$("scgTrigTx");

/* ---- brand ---- */
$("scgMarkMini").innerHTML =
  '<img class="scg-mark-ic" src="'+url("logo_mark")+'" alt="Rad-Lad">'+
  '<div class="scg-mark-tx"><b>THE&nbsp;SCANOGRAM&nbsp;·&nbsp;CTA&nbsp;RUN-OFF</b><span>Rad-Lad&nbsp;·&nbsp;Illuminate&nbsp;the&nbsp;Invisible</span></div>';
$("scgLogoBig").src = url("logo_full");
$("scgTitleScoutAp").src  = url("scout_ap");
$("scgTitleScoutLat").src = url("scout_lat");
achLogo.src = url("logo_mark");

function playAchievement(){
  achWrap.classList.remove("is-playing");
  void achWrap.offsetWidth;
  achWrap.classList.add("is-playing");
}
$("scgAchReplay").addEventListener("click", playAchievement);

/* =============================================================
   STATE
   ============================================================= */
function freshState(){
  return {
    phase:"title",
    method:null,                                   // "bt" | "timed"
    range:{ top:0.25, bot:0.78, confirmed:false },
    level:{ y:0.55, confirmed:false },
    monK:0,
    roiActive:false, roiPlaced:false, roiLocked:false,
    roi:{ x:0.5, y:0.5, r:0.03 },
    target:{ x:0.5, y:0.47, tol:0.03 },
    threshold:100, delay:15, speed:100,
    injected:false, t:0, monTimer:null, huSeries:[], triggered:false, trigT:null, trigHow:null,
    scanStart:null, enh:null,
    patientShift:0, vb:80,                        // per-run circulation time (s) and bolus speed down the legs (mm/s)
    stackK:0, win:"cta", dxLo:0, dxHi:AX_N-1,
    imgNat:{w:1,h:1}, score:null
  };
}
var S = freshState();
var LEVEL_LO_MM = 60, LEVEL_HI_MM = 340;          // descending thoracic → infrarenal abdominal aorta
var LEVEL_TARGET = { y:F((LEVEL_LO_MM+LEVEL_HI_MM)/2), tol:F((LEVEL_HI_MM-LEVEL_LO_MM)/2) };
var LEVEL_MIN = 0.02, LEVEL_MAX = 0.98;
function randomisePatient(){
  S.patientShift = Math.round((Math.random()*7 - 3)*2)/2;     // −3 … +4 s circulation variation
  S.vb = 55 + 5*Math.round(Math.random()*13);                 // 55 … 120 mm/s down the legs
}

/* =============================================================
   CONTRAST KINETICS (HU)
   t = seconds from the start of injection.  140 mL @ 4 mL/s (35 s) + 40 mL saline.
   The bolus reaches the upper abdominal aorta at t0, rises over ~4 s, holds a plateau for the
   length of the injection, then washes out.  Lower down it arrives later: (z − Z_REF) / vb.
   ============================================================= */
var INJ = 35, MON_START = 6.0, MON_CYCLE = 1.2, DIAG_DELAY = 4.0, MON_TIMEOUT = 45;
var MON_MS = 900;                                  // real ms per monitoring scan
function t0(){ return 14 + S.patientShift; }
function aoHU(t){
  var a=t0(), r=1/(1+Math.exp(-(t-(a+2.5))/1.3)), f=1/(1+Math.exp((t-(a+INJ+1))/2.5));
  return 40 + 330*r*f + 40/(1+Math.exp(-(t-(a+22))/4));
}
function transit(zmm){ return Math.max(0, zmm - Z_REF)/S.vb; }
function artHU(t, zmm){ return aoHU(t - transit(zmm)); }
function topMm(){ return S.range.top*Z_TOTAL; }
function botMm(){ return S.range.bot*Z_TOTAL; }
function covMm(){ return (S.range.bot - S.range.top)*Z_TOTAL; }
function scanTime(){ return covMm()/S.speed; }
function sliceTime(zmm){ return S.scanStart + Math.max(0, zmm - topMm())/S.speed; }
function enhAt(zmm){ return artHU(sliceTime(zmm), zmm); }
/* where the leading edge of the bolus (half-way up the rise) is at time t */
function bolusFront(t){ var dt=t-(t0()+2.5); return dt<0 ? -1 : Z_REF + dt*S.vb; }

/* =============================================================
   AXIAL RENDERER — HU recovered from the JPEG LUT; arterial pixels (label 1)
   rescaled to the modelled attenuation for when that slice was scanned.
   ============================================================= */
var cache = {};                    // k -> {g:Uint8Array, l:Uint8Array}
var BYTE2HU = new Float32Array(256);
(function(){
  for(var b=0;b<256;b++){
    BYTE2HU[b] = b < HU_LUT[1][1]
      ? HU_LUT[0][0] + (b-HU_LUT[0][1])*(HU_LUT[1][0]-HU_LUT[0][0])/(HU_LUT[1][1]-HU_LUT[0][1])
      : HU_LUT[1][0] + (b-HU_LUT[1][1])*(HU_LUT[2][0]-HU_LUT[1][0])/(HU_LUT[2][1]-HU_LUT[1][1]);
  }
})();
var cv = document.createElement("canvas"); cv.width = cv.height = IMG_W;
var cx = cv.getContext("2d", { willReadFrequently:true });
function loadPix(src, cb){
  var im = new Image();
  im.onload = function(){
    cx.clearRect(0,0,IMG_W,IMG_W); cx.drawImage(im,0,0);
    var d = cx.getImageData(0,0,IMG_W,IMG_W).data, out = new Uint8Array(IMG_W*IMG_W);
    for(var i=0,j=0;i<out.length;i++,j+=4) out[i]=d[j];
    cb(out);
  };
  im.onerror = function(){ cb(null); };
  im.src = src;
}
function getSlice(k, cb){
  if(cache[k]) { cb(cache[k]); return; }
  loadPix(url("ax_"+pad3(k)), function(g){
    loadPix(url("lb_"+pad3(k)), function(l){
      if(!g){ cb(null); return; }
      var lab = new Uint8Array(IMG_W*IMG_W);
      if(l) for(var i=0;i<lab.length;i++) lab[i] = Math.round(l[i]/60);
      cache[k] = { g:g, l:lab };
      cb(cache[k]);
    });
  });
}
function gauss(){ var u=1-Math.random(), v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(6.2832*v); }
/* HU buffer for a slice with its arteries at attenuation `art` */
function huBuffer(sl, art, noise){
  var n=IMG_W*IMG_W, hu=new Float32Array(n), kA=(art-40)/(ART_REF-40);
  for(var i=0;i<n;i++){
    var h=BYTE2HU[sl.g[i]];
    // scaling the enhancement down also scales away the image noise: put some texture back
    if(sl.l[i]===1){ h = 40 + (h-40)*kA; if(kA<1) h += 13*(1-Math.max(kA,0))*gauss(); }
    if(noise && h>-900) h += noise*gauss();
    hu[i]=h;
  }
  return hu;
}
var WINDOWS = { cta:[150,700], soft:[40,400], bone:[400,1800], mon:[40,400] };
function huToDataURL(hu, win, crop){
  var L=win[0], W=win[1], lo=L-W/2, n=IMG_W*IMG_W;
  var id=cx.createImageData(IMG_W,IMG_W), d=id.data;
  for(var i=0,j=0;i<n;i++,j+=4){
    var v=(hu[i]-lo)/W*255; v = v<0?0:(v>255?255:v);
    d[j]=d[j+1]=d[j+2]=v; d[j+3]=255;
  }
  cx.putImageData(id,0,0);
  if(!crop) return { src:cv.toDataURL("image/jpeg",0.92), w:IMG_W, h:IMG_W };
  var c2=document.createElement("canvas"); c2.width=c2.height=crop[2]*2;
  var x2=c2.getContext("2d"); x2.imageSmoothingQuality="high";
  x2.drawImage(cv, crop[0], crop[1], crop[2], crop[2], 0, 0, c2.width, c2.height);
  return { src:c2.toDataURL("image/jpeg",0.92), w:c2.width, h:c2.height };
}
function roiMeanHU(hu){
  var cxp=S.roi.x*IMG_W, cyp=S.roi.y*IMG_W, r=S.roi.r*IMG_W, s=0, n=0;
  for(var y=Math.max(0,Math.floor(cyp-r)); y<=Math.min(IMG_W-1,Math.ceil(cyp+r)); y++)
    for(var x=Math.max(0,Math.floor(cxp-r)); x<=Math.min(IMG_W-1,Math.ceil(cxp+r)); x++)
      if((x-cxp)*(x-cxp)+(y-cyp)*(y-cyp) <= r*r){ s+=hu[y*IMG_W+x]; n++; }
  return n? s/n : 0;
}
/* fraction of the ROI inside the arterial label — used for grading */
function roiArtFrac(k){
  var sl=cache[k]; if(!sl) return 0;
  var cxp=S.roi.x*IMG_W, cyp=S.roi.y*IMG_W, r=S.roi.r*IMG_W, a=0, n=0;
  for(var y=Math.max(0,Math.floor(cyp-r)); y<=Math.min(IMG_W-1,Math.ceil(cyp+r)); y++)
    for(var x=Math.max(0,Math.floor(cxp-r)); x<=Math.min(IMG_W-1,Math.ceil(cxp+r)); x++)
      if((x-cxp)*(x-cxp)+(y-cyp)*(y-cyp) <= r*r){ n++; if(sl.l[y*IMG_W+x]===1) a++; }
  return n? a/n : 0;
}

/* =============================================================
   CONSOLE LOG
   ============================================================= */
function log(msg, cls){
  var d=document.createElement("div");
  if(cls) d.innerHTML='<span class="scg-l-'+cls+'">'+msg+'</span>';
  else d.textContent=msg;
  logEl.appendChild(d);
  logEl.scrollTop=logEl.scrollHeight;
}
function logCmd(c){ log("$ "+c,"cmd"); }

/* =============================================================
   IMAGE + CONTENT-RECT MATH  (object-fit: contain)
   ============================================================= */
function showSrc(src, w, h, fade){
  if(fade){
    imgB.src = img.src; imgB.style.opacity = 1;
    img.style.opacity = 0;
    img.onload = function(){ img.style.opacity = 1; setTimeout(function(){ imgB.style.opacity = 0; },360); img.onload=null; };
    img.src = src;
  } else {
    img.onload = null; img.style.opacity = 1; imgB.style.opacity = 0; img.src = src;
  }
  if(w && h){ S.imgNat={w:w,h:h}; positionOverlays(); requestAnimationFrame(positionOverlays); return; }
  var probe = new Image();
  probe.onload = function(){
    S.imgNat={w:probe.naturalWidth,h:probe.naturalHeight};
    positionOverlays();
    requestAnimationFrame(positionOverlays);
    setTimeout(positionOverlays, 180);
  };
  probe.src = src;
}
function setImg(name, fade){ showSrc(url(name), 0, 0, fade); }
function contentRect(){
  var cw=vp.clientWidth, ch=vp.clientHeight;
  var nw=S.imgNat.w||1, nh=S.imgNat.h||1;
  var scale=Math.min(cw/nw, ch/nh);
  var w=nw*scale, h=nh*scale;
  return { x:(cw-w)/2, y:(ch-h)/2, w:w, h:h };
}
function positionOverlays(){
  var r=contentRect();
  if(r.w < 4 || r.h < 4) return;
  if(S.roiPlaced || S.roiActive){
    if(!isFinite(S.roi.x) || S.roi.x<0 || S.roi.x>1) S.roi.x=0.5;
    if(!isFinite(S.roi.y) || S.roi.y<0 || S.roi.y>1) S.roi.y=0.5;
    var px=r.x + S.roi.x*r.w, py=r.y + S.roi.y*r.h, rad=S.roi.r*r.w;
    roiEl.style.left=(px-rad)+"px"; roiEl.style.top=(py-rad)+"px";
    roiEl.style.width=roiEl.style.height=(rad*2)+"px";
  }
  var tr=S.target, tx=r.x+tr.x*r.w, ty=r.y+tr.y*r.h, trad=tr.tol*r.w;
  targetEl.style.left=(tx-trad)+"px"; targetEl.style.top=(ty-trad)+"px";
  targetEl.style.width=targetEl.style.height=(trad*2)+"px";

  /* the scanogram is a tall, narrow image: let the range box / level line reach past it so they can be grabbed */
  var bx = Math.max(0, r.x - 40), bw = Math.min(vp.clientWidth, r.w + 80);
  if(!rangeBox.classList.contains("scg-hidden")){
    var yT=r.y + S.range.top*r.h, yB=r.y + S.range.bot*r.h;
    rangeBox.style.left=bx+"px"; rangeBox.style.width=bw+"px";
    rangeBox.style.top=yT+"px"; rangeBox.style.height=(yB-yT)+"px";
    rangeMaskTop.style.left=r.x+"px"; rangeMaskTop.style.width=r.w+"px";
    rangeMaskTop.style.top=r.y+"px"; rangeMaskTop.style.height=Math.max(0,S.range.top*r.h)+"px";
    rangeMaskBot.style.left=r.x+"px"; rangeMaskBot.style.width=r.w+"px";
    rangeMaskBot.style.top=yB+"px"; rangeMaskBot.style.height=Math.max(0,(1-S.range.bot)*r.h)+"px";
  }
  if(!pipBox.classList.contains("scg-hidden")){
    pipBox.style.top=(S.range.top*100)+"%"; pipBox.style.height=((S.range.bot-S.range.top)*100)+"%";
  }
  if(!levelLine.classList.contains("scg-hidden")){
    levelLine.style.left=bx+"px"; levelLine.style.width=bw+"px";
    levelLine.style.top=(r.y + S.level.y*r.h)+"px";
  }
  if(!levelBand.classList.contains("scg-hidden")){
    levelBand.style.left=r.x+"px"; levelBand.style.width=r.w+"px";
    levelBand.style.top=(r.y + (LEVEL_TARGET.y-LEVEL_TARGET.tol)*r.h)+"px";
    levelBand.style.height=(LEVEL_TARGET.tol*2*r.h)+"px";
  }
  if(!pip.classList.contains("scg-hidden")) pipLine.style.top=(S.level.y*100)+"%";
}
window.addEventListener("resize", positionOverlays);
window.addEventListener("orientationchange", function(){ setTimeout(positionOverlays,120); });
if(typeof ResizeObserver!=="undefined"){ new ResizeObserver(function(){ positionOverlays(); }).observe(vp); }
document.addEventListener("visibilitychange", function(){ if(!document.hidden) setTimeout(positionOverlays,60); });

/* =============================================================
   PHASE MACHINE
   ============================================================= */
var PHASE_LABEL = {
  title:"STANDBY", setup:"PATIENT SET-UP", topo:"SCANOGRAM", range:"SCAN RANGE", method:"SPEED + TIMING",
  level:"BOLUS TRACKING · LEVEL", plan:"BOLUS TRACKING · ROI", monitor:"BOLUS TRACKING · MONITOR",
  timed:"TIMED SCAN · DELAY", countdown:"TIMED SCAN · INJECTING", acquire:"ACQUISITION", result:"REVIEW"
};
function setPhase(p){
  S.phase=p;
  phaseChip.textContent = PHASE_LABEL[p]||p;
  stage.classList.remove("is-scan");
  acqEl.classList.add("scg-hidden"); acqBig.classList.add("scg-hidden");
  watermark.classList.add("scg-hidden");
  if(p!=="monitor") trigEl.classList.add("scg-hidden");
  stackUI.classList.add("scg-hidden");
  winBtns.classList.add("scg-hidden");
  room.classList.toggle("scg-hidden", p!=="setup");
  var showRange = (p==="range"), showLevel = (p==="level");
  rangeBox.classList.toggle("scg-hidden", !showRange);
  rangeMaskTop.classList.toggle("scg-hidden", !showRange);
  rangeMaskBot.classList.toggle("scg-hidden", !showRange);
  levelLine.classList.toggle("scg-hidden", !showLevel);
  levelBand.classList.toggle("scg-hidden", !showLevel);
  pip.classList.toggle("scg-hidden", !(showRange||showLevel));
  pipLine.classList.toggle("scg-hidden", !showLevel);
  pipBox.classList.toggle("scg-hidden", !showRange);
  render();
}

/* =============================================================
   COMMANDS
   ============================================================= */
var COMMANDS = [
  { id:"load",   label:"LOAD PATIENT · FEET FIRST", key:"load",  phases:["setup"], needs:"notLoaded", primary:true,
    run:function(){ loadPatient(); } },
  { id:"scout",  label:"RUN SCANOGRAM",         key:"scout",  phases:["setup","topo"], needs:"loaded", primary:true,
    run:function(){ runTopo(); } },
  { id:"cover",  label:"AUTO: DIAPHRAGM → TOES", key:"cover", phases:["range"],
    run:function(){ autoCover(); } },
  { id:"rconf",  label:"CONFIRM SCAN RANGE",    key:"confirm",phases:["range"], needs:"rangeSane", primary:true,
    run:function(){ confirmRange(); } },
  { id:"bt",     label:"BOLUS TRACKING",        key:"bt",     phases:["method"], primary:true,
    run:function(){ chooseMethod("bt"); } },
  { id:"timed",  label:"TIMED SCAN (FIXED DELAY)", key:"timed", phases:["method"],
    run:function(){ chooseMethod("timed"); } },
  { id:"lvlup",  label:"LEVEL ↑ (cranial)",     key:"level+", phases:["level"],
    run:function(){ nudgeLevel(-0.008); } },
  { id:"lvldn",  label:"LEVEL ↓ (caudal)",      key:"level-", phases:["level"],
    run:function(){ nudgeLevel(+0.008); } },
  { id:"lconf",  label:"CONFIRM MONITORING LEVEL",key:"confirm",phases:["level"], primary:true,
    run:function(){ confirmLevel(); } },
  { id:"roi",    label:"PLACE TRACKING ROI",    key:"roi",    phases:["plan"], needs:"noRoi",
    run:function(){ activateRoi(); } },
  { id:"inject", label:"INJECT + START MONITORING", key:"inject", phases:["plan"], needs:"roiActive", primary:true,
    run:function(){ startMonitor(); } },
  { id:"scan",   label:"MANUAL TRIGGER",        key:"scan",   phases:["monitor"], needs:"canScan",
    run:function(){ triggerScan("manual"); } },
  { id:"tinject",label:"INJECT + START TIMER",  key:"inject", phases:["timed"], primary:true,
    run:function(){ startTimed(); } },
  { id:"back",   label:"◀ CHANGE SPEED / METHOD", key:"back",  phases:["level","plan","timed"],
    run:function(){ gotoMethod(); } },
  { id:"reset",  label:"RESET",                 key:"reset",  phases:["topo","range","method","level","plan","monitor","timed","countdown","result"],
    run:function(){ resetAll(); } }
];
function cmdEnabled(c){
  if(c.phases.indexOf(S.phase)<0) return false;
  if(c.needs==="notLoaded")  return !S.loaded && !S.loading;
  if(c.needs==="loaded")     return !!S.loaded && !topoRunning;
  if(c.needs==="noRoi")      return !S.roiActive;
  if(c.needs==="roiActive")  return S.roiActive;
  if(c.needs==="canScan")    return S.phase==="monitor" && !S.triggered;
  if(c.needs==="rangeSane")  return (S.range.bot - S.range.top) >= 0.2;
  return true;
}
function renderCmds(){
  cmds.innerHTML="";
  COMMANDS.forEach(function(c){
    if(c.phases.indexOf(S.phase)<0) return;
    if(c.id==="load" && S.loaded) return;
    var b=document.createElement("button");
    var pulse = (c.id==="lconf"&&levelInBand()) || (c.id==="rconf"&&rangeIdeal()) || (c.id==="inject"&&S.roiLocked) || (c.id==="scout"&&S.loaded);
    b.className="scg-btn"+(c.primary?" is-primary":"")+(pulse?" is-pulse":"");
    b.disabled=!cmdEnabled(c);
    b.innerHTML='<span>'+c.label+'</span><span class="scg-key">'+c.key+'</span>';
    b.onclick=function(){ logCmd(c.key); c.run(); };
    cmds.appendChild(b);
  });
}
function parseCommand(raw){
  var t=raw.trim().toLowerCase();
  if(!t) return;
  logCmd(t);
  if(t==="help"){
    log("commands here: "+COMMANDS.filter(function(c){return c.phases.indexOf(S.phase)>=0;})
        .map(function(c){return c.key;}).join(", ")+", help","sys");
    log("workflow: load (feet first) → scout → range: diaphragm → past the toes → confirm → table speed → bt or timed → (bt: level in the abdominal aorta → roi in the aorta → threshold → inject) / (timed: delay → inject) → review.","sys");
    log("extras: top +/- , base +/- (range) · speed <mm/s> · threshold <HU> · delay <s> · size <mm> · window <cta|soft|bone> (review)","sys");
    return;
  }
  if(S.phase==="range" && (t.indexOf("top")===0 || t.indexOf("base")===0 || t.indexOf("bot")===0)){
    var parts=t.split(/\s+/), which=parts[0]==="top"?"top":"bot";
    var dir=parts[1]||""; nudgeRange(which, 0.01*(dir.indexOf("-")>=0?-1:1));
    return;
  }
  if(t.indexOf("speed")===0){
    var sv=parseFloat(t.split(/\s+/)[1]);
    if(S.phase==="method" && !isNaN(sv)){ setSpeed(sv); render(); log("table speed "+S.speed+" mm/s — scan time "+scanTime().toFixed(1)+" s.","sys"); }
    else log("usage (speed + timing step): speed <mm/s>  e.g. speed 40","sys");
    return;
  }
  if(t.indexOf("threshold")===0 || t.indexOf("thr ")===0){
    var v=parseInt(t.split(/\s+/)[1],10);
    if(S.phase==="plan" && !isNaN(v)){ setThreshold(v); render(); log("trigger threshold "+S.threshold+" HU.","sys"); }
    else log("usage (ROI step): threshold <HU>  e.g. threshold 150","sys");
    return;
  }
  if(t.indexOf("delay")===0){
    var dv=parseFloat(t.split(/\s+/)[1]);
    if(S.phase==="timed" && !isNaN(dv)){ setDelay(dv); render(); log("scan delay "+S.delay+" s.","sys"); }
    else log("usage (timed step): delay <seconds>  e.g. delay 20","sys");
    return;
  }
  if(t.indexOf("window")===0 || t.indexOf("win ")===0){
    var w=t.split(/\s+/)[1]; if(WINDOWS[w] && w!=="mon" && S.phase==="result"){ setWindow(w); } else log("window (review): cta | soft | bone","sys");
    return;
  }
  if(t.indexOf("size")===0){
    var mm=parseInt(t.split(/\s+/)[1],10);
    if(!isNaN(mm) && S.roiActive && S.phase==="plan"){ setRoiDiameterMM(mm); } else log("usage: size <mm>  (e.g. size 12)","sys");
    return;
  }
  var cands=COMMANDS.filter(function(c){ return c.key===t || c.id===t; });
  var m=cands.filter(function(c){ return c.phases.indexOf(S.phase)>=0; })[0] || cands[0];
  if(!m){ log("unknown command: "+t+"  (try: help)","warn"); return; }
  if(m.phases.indexOf(S.phase)<0){ log("'"+t+"' is not available in this phase.","warn"); return; }
  if(!cmdEnabled(m)){ log("'"+t+"' is locked right now.","warn"); return; }
  m.run();
}
cliForm.addEventListener("submit",function(e){ e.preventDefault(); var v=cli.value; cli.value=""; parseCommand(v); });

/* =============================================================
   RENDER (rail per phase)
   ============================================================= */
function kvBlock(rows){
  return '<div>'+rows.map(function(r){
    return '<div class="scg-kv"><span>'+r[0]+'</span><span>'+r[1]+'</span></div>';
  }).join('')+'</div>';
}
var CHECKS = [
  "Identity, pregnancy status and contrast safety checked (renal function, allergy)",
  "18 G cannula, antecubital fossa — flushed, connected to the pump injector",
  "Supine, <b>feet first</b> — the whole run-off must fit inside the table travel",
  "Arms raised above the head — out of the abdominal FOV",
  "Legs straight and together, feet strapped toes-up — no movement during the long scan",
  "Lasers on the xiphisternum · table zeroed"
];
function render(){
  renderCmds();
  var showRoi = (S.phase==="plan"||S.phase==="monitor") && (S.roiPlaced||S.roiActive);
  roiEl.classList.toggle("scg-hidden", !showRoi);
  targetEl.classList.toggle("scg-hidden", !(S.phase==="plan" && S.roiActive && !S.roiLocked && TARGETS[S.monK]));
  positionOverlays();

  if(S.phase==="setup"){
    railTitle.textContent="Patient set-up";
    railDesc.textContent="CTA run-off · claudication / critical limb ischaemia";
    var done = S.loaded ? CHECKS.length : (S.loading ? S.checkN||0 : 2);
    railBody.innerHTML =
      '<div class="scg-check">'+CHECKS.map(function(c,i){
        return '<div class="'+(i<done?"is-done":"")+'"><i>'+(i<done?"✓":"○")+'</i><span>'+c+'</span></div>';
      }).join('')+'</div>'+
      '<div class="scg-hint">'+(S.loaded ? "Patient in position. Command: <b>scout</b>"
        : "Command: <b>load</b> — moves the table feet first into the gantry.")+'</div>';
    vpTL.textContent=""; vpBL.textContent=""; vpBR.textContent="";
  }
  else if(S.phase==="topo"){
    railTitle.textContent="Scanogram";
    railDesc.textContent="Localiser radiographs";
    railBody.innerHTML=kvBlock([
        ["Projections","AP + lateral"],
        ["Length","≈ "+Math.round(Z_TOTAL/10)*10+" mm"],
        ["Technique","120 kV · 35 mA"],
        ["Position","Supine · feet first"],
        ["Purpose","Prescribe the run-off range"]
      ])+'<div class="scg-hint">A long localiser — lower chest to beyond the feet — so the whole arterial tree can be planned in one helical acquisition.</div>';
  }
  else if(S.phase==="range"){
    var okT=rangeTopOK(), okB=rangeBotOK(), ok=rangeIdeal();
    var cm = covMm().toFixed(0);
    railTitle.textContent="Scan range";
    railDesc.textContent="Prescribe the run-off coverage";
    var hint = ok ? (topMm() < DOME_MM-110 ? "Covers it — but the top is well up into the chest: extra dose for no diagnostic gain. Bring it down to the diaphragm, or <b>confirm</b>."
                                           : "Coverage: <b>diaphragm → beyond the toes</b>. Command: <b>confirm</b>")
      : (!okT ? (topMm() < BIF_MM ? "Top is below the diaphragm — the coeliac axis, SMA and renal arteries (and any aneurysm or inflow disease) would be cut off. Drag the upper edge up to the domes."
                                  : "Top is below the aortic bifurcation — the aorto-iliac <b>inflow</b> would be missed. The run-off starts at the diaphragm.")
      : (botMm() < ANKLE_MM ? "Base stops above the ankles — the distal tibial and pedal arteries (the vessels a bypass or angioplasty targets) would be missed."
      : "Base is close — keep going until the <b>tips of the toes</b> are inside the box."));
    railBody.innerHTML=
      '<div class="scg-hint '+(ok?"is-ok":"is-warn")+'" id="scgRngHint">'+hint+'</div>'+
      kvBlock([
        ["Top (cranial)", '<b style="color:'+(okT?"var(--accent)":"var(--warn)")+'">'+rangeLabel(S.range.top)+'</b>'],
        ["Base (caudal)", '<b style="color:'+(okB?"var(--accent)":"var(--warn)")+'">'+rangeLabel(S.range.bot)+'</b>'],
        ["Coverage", cm+" mm"],
        ["Collimation","64 × 0.625 mm"]
      ])+
      '<div class="scg-hint">A run-off follows the arterial tree from the abdominal aorta to the feet: start at the <b>diaphragm</b> (coeliac, SMA, renal arteries, aorta) and finish <b>beyond the toes</b> (pedal arch). Check the feet on the lateral inset.</div>';
    vpTL.textContent="SCANOGRAM · AP\nprescribe scan range";
    vpBL.textContent="lateral inset ↗";
    vpBR.textContent="120 kV · CTA";
    rangeBox.classList.toggle("is-off", !ok);
    pip.classList.toggle("is-off", !ok);
    rangeTopTag.textContent = rangeLabel(S.range.top);
    rangeBotTag.textContent = rangeLabel(S.range.bot);
    rangeCap.textContent = cm+" mm";
  }
  else if(S.phase==="method"){
    railTitle.textContent="Table speed + timing";
    railDesc.textContent="How fast, and when, will the table move?";
    railBody.innerHTML=
      '<div class="scg-readout"><div class="scg-ro-lab">Table speed</div><div class="scg-ro-val"><span id="scgSpeedVal">'+S.speed+'</span> <small>mm/s</small></div></div>'+
      '<div class="scg-size"><span style="font-size:10px;color:var(--ink-faint)">SPEED</span><input type="range" id="scgSpeed" min="20" max="150" step="5" value="'+S.speed+'"></div>'+
      kvBlock([
        ["Scan time",'<b id="scgScanTime">'+scanTime().toFixed(1)+' s</b> for '+covMm().toFixed(0)+' mm'],
        ["Contrast","140 mL · 350 mgI/mL @ 4 mL/s"],
        ["Injection","35 s + 40 mL saline"],
        ["Direction","Cranio-caudal (with the blood)"]
      ])+
      '<div class="scg-hint">The bolus travels down the legs at only ~50–120 mm/s (slower with disease). A table that moves faster than the contrast <b>outruns the bolus</b>; one that is too slow is still scanning the feet after the contrast has washed out and the veins have filled.</div>'+
      '<div class="scg-choice">'+
        '<button type="button" data-m="bt"><b>BOLUS TRACKING</b><span>Monitor the aorta with low-dose scans and trigger when it reaches a threshold. Adapts to this patient’s circulation.</span></button>'+
        '<button type="button" data-m="timed"><b>TIMED SCAN</b><span>Pick a fixed delay from the start of injection. Assumes an average circulation time.</span></button>'+
      '</div>';
    var sp=$("scgSpeed");
    sp.addEventListener("input",function(){ setSpeed(parseInt(sp.value,10)); $("scgSpeedVal").textContent=S.speed; $("scgScanTime").textContent=scanTime().toFixed(1)+" s"; });
    Array.prototype.forEach.call(railBody.querySelectorAll(".scg-choice button"),function(b){
      b.onclick=function(){ logCmd(b.dataset.m); chooseMethod(b.dataset.m); };
    });
    vpTL.textContent="SCANOGRAM · AP\nrange set"; vpBL.textContent=""; vpBR.textContent="";
  }
  else if(S.phase==="level"){
    var lab = rangeLabel(S.level.y), lok = levelInBand();
    railTitle.textContent="Bolus tracking — level";
    railDesc.textContent="Set the monitoring slice";
    railBody.innerHTML=
      '<div class="scg-hint '+(lok?"is-ok":"")+'" id="scgLvlHint">'+levelHint(lok)+'</div>'+
      kvBlock([
        ["Line at", '<b style="color:'+(lok?"var(--accent)":"var(--warn)")+'">'+lab+'</b>'],
        ["Table", (S.level.y*Z_TOTAL).toFixed(0)+" mm from top"],
        ["Target", "Aorta (above the bifurcation)"],
        ["Mode","Low-dose sequential · "+MON_CYCLE.toFixed(1)+" s"]
      ])+
      '<div class="scg-hint">You can confirm any level — the monitoring slice you get is the real slice at that position.</div>';
    vpTL.textContent="SCANOGRAM · AP\nset monitoring level";
    vpBL.textContent="lateral inset ↗"; vpBR.textContent="120 kV";
    levelLine.classList.toggle("is-on", lok);
    pip.classList.toggle("is-on", lok);
    levelTag.textContent = lok ? "▶ AORTA" : lab;
  }
  else if(S.phase==="plan"){
    railTitle.textContent="Bolus tracking — ROI";
    railDesc.textContent="ROI + trigger threshold";
    railBody.innerHTML=
      '<div class="scg-hint" id="scgRoiHint">'+
        (S.roiActive? "Drag the ROI into the <b>aorta</b>. Wheel or SIZE to resize."
                    : "Monitoring slice acquired. Command: <b>roi</b> — creates the tracking ROI.")+
      '</div>'+
      (S.roiActive? '<div class="scg-size"><span style="font-size:10px;color:var(--ink-faint)">SIZE</span><input type="range" id="scgRoiSize" min="0.008" max="0.06" step="0.002" value="'+S.roi.r+'"><output id="scgRoiSizeOut">'+mmDiameter().toFixed(0)+' mm</output></div>' : "")+
      '<div class="scg-size"><span style="font-size:10px;color:var(--ink-faint)">TRIGGER</span><input type="range" id="scgThr" min="50" max="300" step="10" value="'+S.threshold+'"><output id="scgThrOut">'+S.threshold+' HU</output></div>'+
      kvBlock([
        ["Monitoring slice", rangeLabel(axFrac(S.monK))],
        ["Diagnostic delay", DIAG_DELAY.toFixed(0)+" s after trigger"],
        ["Trigger","Automatic at threshold"],
        ["ROI Ø", '<span id="scgRoiMm">'+(S.roiActive? mmDiameter().toFixed(0)+" mm" : "—")+'</span>']
      ]);
    var sz=$("scgRoiSize");
    if(sz) sz.addEventListener("input",function(){ S.roi.r=parseFloat(sz.value); positionOverlays(); updateRoiHint(); syncRoiMm(); });
    var th=$("scgThr");
    th.addEventListener("input",function(){ setThreshold(parseInt(th.value,10)); $("scgThrOut").textContent=S.threshold+" HU"; });
    updateRoiHint();
    vpTL.textContent="MONITORING SLICE · "+(S.level.y*Z_TOTAL).toFixed(0)+" mm\npre-contrast";
    vpBL.textContent=""; vpBR.textContent="WL 40  WW 400";
  }
  else if(S.phase==="monitor"){
    railTitle.textContent="Bolus tracking — monitor";
    railDesc.textContent="Auto-trigger at "+S.threshold+" HU";
    railBody.innerHTML=
      '<div class="scg-readout" id="scgHuBox">'+
        '<div class="scg-ro-lab">ROI attenuation</div>'+
        '<div class="scg-ro-val"><span id="scgHuVal">—</span> <small>HU</small></div>'+
      '</div>'+
      '<canvas class="scg-tdc" id="scgTdc" width="292" height="110"></canvas>'+
      kvBlock([
        ["Elapsed","<b id=\"scgElapsed\">0.0 s</b>"],
        ["Threshold",S.threshold+" HU"],
        ["State","<b id=\"scgMonState\">baseline</b>"]
      ])+
      '<div class="scg-hint" id="scgMonHint">Contrast injecting. The scan fires automatically when the ROI crosses the threshold (plus the breath-hold delay). <b>scan</b> triggers manually.</div>';
    vpTL.textContent="BOLUS TRACKING\nMONITOR · 20 mA";
    vpBR.textContent="WL 40  WW 400";
    drawTDC();
  }
  else if(S.phase==="timed"){
    railTitle.textContent="Timed scan — delay";
    railDesc.textContent="Seconds from start of injection";
    railBody.innerHTML=
      '<div class="scg-readout"><div class="scg-ro-lab">Scan delay</div><div class="scg-ro-val"><span id="scgDelayVal">'+S.delay.toFixed(0)+'</span> <small>s</small></div></div>'+
      '<div class="scg-size"><span style="font-size:10px;color:var(--ink-faint)">DELAY</span><input type="range" id="scgDelay" min="5" max="45" step="1" value="'+S.delay+'"></div>'+
      kvBlock([
        ["Injection","140 mL @ 4 mL/s (35 s)"],
        ["Table speed",S.speed+" mm/s"],
        ["Scan time",scanTime().toFixed(1)+" s · cranio-caudal"]
      ])+
      '<div class="scg-hint">The scan starts this many seconds after the injector starts. The contrast has to reach the abdominal aorta before the table does — and stay ahead of it all the way to the feet.</div>';
    var dl=$("scgDelay");
    dl.addEventListener("input",function(){ setDelay(parseInt(dl.value,10)); $("scgDelayVal").textContent=S.delay.toFixed(0); });
    vpTL.textContent="SCANOGRAM · AP\ntimed protocol"; vpBL.textContent=""; vpBR.textContent="";
  }
  else if(S.phase==="countdown"){
    railTitle.textContent="Timed scan";
    railDesc.textContent="Injecting — scan at "+S.delay+" s";
    railBody.innerHTML=
      '<div class="scg-readout" id="scgHuBox">'+
        '<div class="scg-ro-lab">Abdominal aorta (simulated)</div>'+
        '<div class="scg-ro-val"><span id="scgHuVal">—</span> <small>HU</small></div>'+
      '</div>'+
      '<canvas class="scg-tdc" id="scgTdc" width="292" height="110"></canvas>'+
      kvBlock([["Delay",S.delay+" s"],["Elapsed",'<b id="scgElapsed">0.0 s</b>']])+
      '<div class="scg-hint">A timed protocol takes <b>no</b> monitoring images — the view on the left is a teaching simulation of where the bolus is. The scanner starts at '+S.delay+' s whatever the bolus is doing.</div>';
  }
  else if(S.phase==="acquire"){
    railTitle.textContent="Acquisition";
    railDesc.textContent="Helical run-off in progress";
    railBody.innerHTML=kvBlock([
      ["Coverage", covMm().toFixed(0)+" mm"],
      ["Start", "t = "+S.scanStart.toFixed(1)+" s"],
      ["Table speed", S.speed+" mm/s"],
      ["Scan time", scanTime().toFixed(1)+" s"],
      ["Direction","Cranio-caudal"]
    ])+'<div class="scg-hint">The table carries the patient through the gantry from the diaphragm towards the feet. Watch the table position against the front of the bolus.</div>';
  }
  else if(S.phase==="result"){
    railTitle.textContent="Review";
    railDesc.textContent="Scroll the axial stack · read the debrief";
    railBody.innerHTML=
      kvBlock([
        ["Series","CTA run-off · 1.0 mm"],
        ["Slices",(S.dxHi-S.dxLo+1)+" shown (every "+AX_STEP+" mm)"],
        ["Aorto-iliac", Math.round(S.enh.prox)+" HU"],
        ["Calf arteries", S.enh.distalImaged ? Math.round(S.enh.distalMin)+" HU (lowest)" : "not imaged"],
        ["Navigate","wheel / drag / ↑ ↓"]
      ])+
      '<div class="scg-hint">Each slice on the left was rendered for <b>when the table reached it</b> and where the bolus was at that moment. Use CTA / SOFT / BONE windows. Full debrief below.</div>';
  }
}
function syncRoiMm(){
  var o=$("scgRoiSizeOut"); if(o) o.textContent=mmDiameter().toFixed(0)+" mm";
  var m=$("scgRoiMm"); if(m) m.textContent=mmDiameter().toFixed(0)+" mm";
}
function mmDiameter(){ return S.roi.r*2*FOV_MM; }
function setRoiDiameterMM(mm){ S.roi.r=Math.max(0.008,Math.min(0.06,(mm/FOV_MM)/2)); positionOverlays(); updateRoiHint(); render(); }
function setThreshold(v){ S.threshold=Math.max(50,Math.min(300,Math.round(v/10)*10)); }
function setDelay(v){ S.delay=Math.max(5,Math.min(45,Math.round(v))); }
function setSpeed(v){ S.speed=Math.max(20,Math.min(150,Math.round(v/5)*5)); }

/* =============================================================
   PATIENT SET-UP (feet first)
   ============================================================= */
/* 3-D room (three.js from the CDN); the SVG drawing stays as the fallback */
var THREE_URL = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js";
var room3d = null, room3dTried = false;
window.__room = function(){ return room3d; };
function init3D(){
  if(room3dTried) { if(room3d){ room3d.reset(); room3d.start(); } return; }
  room3dTried = true;
  if(!window.SCG_ROOM3D) return;
  import(THREE_URL).then(function(THREE){
    try{
      room3d = window.SCG_ROOM3D(THREE, $("scgRoom3d"));
      room.classList.add("is-3d");
      room3d.start();
      if(S.loading && room3d) room3d.finish();       // user pressed load before the scene arrived
    }catch(e){ room3d = null; room.classList.remove("is-3d"); }
  }).catch(function(){ room3d = null; });
}
function gotoSetup(){
  setPhase("setup");
  img.removeAttribute("src"); imgB.removeAttribute("src");
  room.classList.remove("is-in"); drawTube();
  init3D();
  log("patient on the table: supine, arms up, legs together, cannula in the antecubital fossa. Command: <b>load</b>","sys");
}
var couchEl=$("scgCouch"), tubeEl=$("scgTube");
function couchOffset(){
  var m=getComputedStyle(couchEl).transform;
  if(!m || m==="none") return 0;
  var p=m.match(/matrix\(([^)]+)\)/); return p ? parseFloat(p[1].split(",")[4])||0 : 0;
}
function drawTube(){
  var x=78+couchOffset(), y=297;                    // cannula moves with the couch; injector is fixed
  var sag=Math.max(262, 330-(x-78)*0.2);
  tubeEl.setAttribute("d","M46 244 C 52 "+sag+", "+((46+x)/2)+" "+(sag+16)+", "+(x-12)+" "+(y-4)+" S "+(x-3)+" "+(y-1)+", "+x+" "+y);
}
function followTube(until){
  drawTube();
  if(performance.now() < until) requestAnimationFrame(function(){ followTube(until); });
}
function loadPatient(){
  if(S.loaded || S.loading) return;
  S.loading=true; S.checkN=2;
  if(room3d){
    var stepTx=$("scgRoomStep");
    log("table moving — feet first toward the gantry…","sys");
    render();
    room3d.play(function(step){
      if(step===1){ S.checkN=3; stepTx.textContent="table moving feet first toward the gantry"; }
      if(step===2){ S.checkN=5; stepTx.textContent="landmark: xiphisternum at the gantry lasers · table zeroed"; log("lasers on — xiphisternum landmarked, table position zeroed.","sys"); }
      if(step===3){ stepTx.textContent="moving to the start position — upper abdomen at isocentre"; }
      render();
    }, function(){
      S.checkN=CHECKS.length; S.loading=false; S.loaded=true;
      stepTx.textContent="upper abdomen at isocentre · legs and feet already through the bore";
      log("patient in position. Command: <b>scout</b>","ok");
      render();
    });
    return;
  }
  room.classList.remove("is-in"); void room.offsetWidth; room.classList.add("is-in");
  followTube(performance.now()+4800);
  log("table moving — feet first into the gantry…","sys");
  render();
  var iv=setInterval(function(){
    S.checkN++; render();
    if(S.checkN>=CHECKS.length){
      clearInterval(iv);
      S.loading=false; S.loaded=true;
      log("patient in position · lasers on the xiphisternum. Command: <b>scout</b>","ok");
      render();
    }
  }, 1050);
}

/* =============================================================
   SCANOGRAM
   ============================================================= */
var topoRunning=false;
function runTopo(){
  if(topoRunning || !S.loaded) return;
  topoRunning=true;
  if(room3d) room3d.stop();
  setPhase("topo");
  log("acquiring scanogram — AP + lateral, lower chest to beyond the feet…","sys");
  acquireScout("scout_lat","LATERAL", function(){
    acquireScout("scout_ap","AP", function(){
      topoRunning=false;
      log("scanogram complete — 2 projections stored.","ok");
      gotoRange();
    });
  });
}
function acquireScout(name, tag, done){
  setImg(name,false);
  vpTL.textContent="ACQUIRING SCANOGRAM · "+tag+"\n120 kV · 35 mA";
  vpBL.textContent="localiser"; vpBR.textContent="";
  requestAnimationFrame(function(){
    if(S.phase!=="topo") return;
    stage.classList.remove("is-scan"); void stage.offsetWidth;
    stage.classList.add("is-scan");
  });
  setTimeout(function(){ stage.classList.remove("is-scan"); done(); }, 2600);
}

/* --- scan range --- */
function gotoRange(){
  S.range={ top:0.25, bot:0.78, confirmed:false };      // starts short: misses the visceral arteries and the feet
  setPhase("range");
  setImg("scout_ap",true);
  pipImg.src = url("scout_lat");
  log("prescribe the run-off range: drag the box to cover the <b>diaphragm → beyond the toes</b>, then <b>confirm</b>.","sys");
}
function rangeLabel(f){
  var mm=f*Z_TOTAL;
  if(mm < 60)   return "lower chest / heart";
  if(mm < 112)  return "lung bases";
  if(mm < 146)  return "diaphragm domes";
  if(mm < 215)  return "upper abdomen · coeliac / SMA";
  if(mm < 270)  return "renal arteries";
  if(mm < BIF_MM-12) return "infrarenal aorta";
  if(mm < BIF_MM+15) return "aortic bifurcation";
  if(mm < 460)  return "iliac arteries";
  if(mm < 525)  return "groins · femoral heads";
  if(mm < KNEE_MM-45) return "thighs · SFA";
  if(mm < KNEE_MM+40) return "knees · popliteal";
  if(mm < ANKLE_MM-30) return "calves · tibial arteries";
  if(mm < ANKLE_MM+25) return "ankles";
  if(mm < TOE_MM-4) return "feet";
  return "beyond the toes";
}
function rangeTopOK(){ return topMm() <= DOME_MM + 8; }
function rangeBotOK(){ return botMm() >= TOE_MM; }
function rangeIdeal(){ return rangeTopOK() && rangeBotOK(); }
function clampRange(){
  S.range.top = Math.max(0.00, Math.min(0.75, S.range.top));
  S.range.bot = Math.max(S.range.top + 0.12, Math.min(1.0, S.range.bot));
}
function nudgeRange(which, step){
  if(which==="top") S.range.top -= step; else S.range.bot += step;
  clampRange(); positionOverlays(); render();
}
function autoCover(){
  S.range.top = F(DOME_MM - 15); S.range.bot = F(TOE_MM + 15);
  clampRange(); positionOverlays(); render();
  log("auto coverage: diaphragm domes → beyond the toes.","sys");
}
function confirmRange(){
  S.range.confirmed=true;
  if(rangeIdeal()) log("scan range confirmed — "+covMm().toFixed(0)+" mm, diaphragm to toes.","ok");
  else {
    if(!rangeTopOK()) log("caution: top is below the diaphragm — "+(topMm()>BIF_MM?"the aorto-iliac inflow":"the visceral and renal arteries")+" will be missed.","warn");
    if(!rangeBotOK()) log("caution: base stops short of the toes — "+(botMm()<ANKLE_MM?"the distal tibial and pedal arteries":"the pedal arch")+" will be missed.","warn");
  }
  gotoMethod();
}
var rngDrag=null;
function rngStart(e, mode){
  if(S.phase!=="range") return;
  e.preventDefault(); e.stopPropagation();
  try{ rangeBox.setPointerCapture(e.pointerId); }catch(_){}
  rngDrag={ mode:mode, y:e.clientY, top:S.range.top, bot:S.range.bot };
}
rangeTopH.addEventListener("pointerdown",function(e){ rngStart(e,"top"); });
rangeBotH.addEventListener("pointerdown",function(e){ rngStart(e,"bot"); });
rangeBox.addEventListener("pointerdown",function(e){
  if(rangeTopH.contains(e.target)||rangeBotH.contains(e.target)) return;
  rngStart(e,"move");
});
rangeBox.addEventListener("pointermove",function(e){
  if(!rngDrag) return;
  var r=contentRect(); if(r.h < 4) return;
  var df=(e.clientY - rngDrag.y)/r.h; if(!isFinite(df)) return;
  if(rngDrag.mode==="top") S.range.top = rngDrag.top + df;
  else if(rngDrag.mode==="bot") S.range.bot = rngDrag.bot + df;
  else { var span=rngDrag.bot-rngDrag.top; S.range.top=Math.max(0,Math.min(1-span,rngDrag.top+df)); S.range.bot=S.range.top+span; }
  clampRange(); positionOverlays(); render();
});
rangeBox.addEventListener("pointerup",function(){ if(rngDrag){ rngDrag=null; render(); } });

/* =============================================================
   SPEED + METHOD CHOICE
   ============================================================= */
function gotoMethod(){
  clearInterval(S.monTimer); S.monTimer=null;
  S.roiActive=false; S.roiPlaced=false; S.roiLocked=false;
  setPhase("method");
  setImg("scout_ap",true);
  log("set the <b>table speed</b>, then choose contrast timing: <b>bt</b> (bolus tracking) or <b>timed</b> (fixed delay).","sys");
}
function chooseMethod(m){
  S.method=m;
  log("table speed "+S.speed+" mm/s → "+scanTime().toFixed(1)+" s to cover "+covMm().toFixed(0)+" mm.","sys");
  if(m==="bt"){ gotoLevel(); }
  else { setPhase("timed"); log("timed scan: set the delay from the start of injection, then <b>inject</b>.","sys"); }
}

/* --- monitoring level --- */
function levelInBand(){ return Math.abs(S.level.y - LEVEL_TARGET.y) <= LEVEL_TARGET.tol; }
function levelHint(ok){
  return ok ? "Monitoring level on the <b>aorta</b>, above the bifurcation. Command: <b>confirm</b>"
            : "Drag the amber line up onto the <b>aorta</b> — the descending aorta at the diaphragm, or the abdominal aorta above the bifurcation (iliac crests). Nudge with <b>level+</b> / <b>level-</b>.";
}
function gotoLevel(){
  S.level.y = 0.55; S.level.confirmed=false;
  setPhase("level");
  setImg("scout_ap",true);
  pipImg.src = url("scout_lat");
  log("bolus tracking: set the monitoring level on the scanogram, then <b>confirm</b>.","sys");
}
function setLevelY(y, full){
  if(!isFinite(y)) return;
  S.level.y = Math.max(LEVEL_MIN, Math.min(LEVEL_MAX, y));
  positionOverlays();
  if(S.phase!=="level") return;
  if(full){ render(); return; }
  var ok=levelInBand(), lab=rangeLabel(S.level.y);
  levelLine.classList.toggle("is-on", ok);
  pip.classList.toggle("is-on", ok);
  levelTag.textContent = ok ? "▶ AORTA" : lab;
  var h=$("scgLvlHint"); if(h){ h.classList.toggle("is-ok", ok); h.innerHTML = levelHint(ok); }
  var kvs=railBody.querySelectorAll(".scg-kv span:last-child");
  if(kvs[0]) kvs[0].innerHTML='<b style="color:'+(ok?"var(--accent)":"var(--warn)")+'">'+lab+'</b>';
  if(kvs[1]) kvs[1].textContent=(S.level.y*Z_TOTAL).toFixed(0)+" mm from top";
  renderCmds();
}
function nudgeLevel(d){ setLevelY(S.level.y + d, true); }
function confirmLevel(){
  S.level.confirmed=true;
  S.monK = axForFrac(S.level.y);
  if(levelInBand()) log("monitoring level confirmed on the aorta ("+rangeLabel(S.level.y)+"). Acquiring monitoring slice…","ok");
  else log("monitoring level confirmed at "+rangeLabel(S.level.y)+" — not on the aorta. Acquiring that slice…","warn");
  var tr = TARGETS[S.monK] || TARGETS[24];
  S.target = { x:tr.x, y:tr.y, tol:tr.r };
  setPhase("plan");
  showMonitorFrame(0, false, function(){ updateRoiHint(); });
  log("place the tracking ROI: command <b>roi</b>","sys");
}
var lvlDrag=false;
levelLine.addEventListener("pointerdown",function(e){
  if(S.phase!=="level") return;
  e.preventDefault(); levelLine.setPointerCapture(e.pointerId); lvlDrag=true;
});
levelLine.addEventListener("pointermove",function(e){
  if(!lvlDrag) return;
  var r=contentRect(), vb=vp.getBoundingClientRect();
  if(r.h<4) return;
  setLevelY((e.clientY - vb.top - r.y)/r.h);
});
levelLine.addEventListener("pointerup",function(){ if(lvlDrag){ lvlDrag=false; render(); } });
vp.addEventListener("pointerdown",function(e){
  if(S.phase!=="level" || levelLine.contains(e.target) || pip.contains(e.target)) return;
  var r=contentRect(), vb=vp.getBoundingClientRect();
  if(r.h<4 || e.clientX < vb.left+r.x-40 || e.clientX > vb.left+r.x+r.w+40) return;
  setLevelY((e.clientY - vb.top - r.y)/r.h);
  lvlDrag=true; try{ levelLine.setPointerCapture(e.pointerId); }catch(_){}
});

/* =============================================================
   MONITORING SLICE RENDER
   ============================================================= */
function showMonitorFrame(t, noisy, cb){
  getSlice(S.monK, function(sl){
    if(!sl){ log("could not decode the monitoring slice.","bad"); return; }
    var hu=huBuffer(sl, artHU(t, S.monK*AX_STEP), noisy?22:6);
    var out=huToDataURL(hu, WINDOWS.mon);
    showSrc(out.src, out.w, out.h, false);
    if(cb) cb(hu);
  });
}

/* =============================================================
   ROI
   ============================================================= */
function activateRoi(){
  if(S.roiActive) return;
  S.roiActive=true; S.roiPlaced=true; S.roiLocked=false;
  S.roi.x=0.32; S.roi.y=0.30; S.roi.r=0.022;
  roiEl.classList.remove("scg-hidden","is-locked","is-bad");
  log("ROI created. Drag it into the aorta; wheel or SIZE resizes it.","sys");
  render();
}
function resizeRoi(d){ S.roi.r=Math.max(0.008,Math.min(0.06,S.roi.r+d)); positionOverlays(); updateRoiHint(); syncRoiMm(); var sz=$("scgRoiSize"); if(sz) sz.value=S.roi.r; }
var drag=null;
roiEl.addEventListener("pointerdown",function(e){
  if(S.phase!=="plan") return;
  e.preventDefault(); e.stopPropagation();
  roiEl.setPointerCapture(e.pointerId);
  roiEl.classList.add("is-drag");
  var r=contentRect(), vb=vp.getBoundingClientRect();
  drag={ dx: e.clientX - (vb.left + r.x + S.roi.x*r.w), dy: e.clientY - (vb.top + r.y + S.roi.y*r.h) };
});
roiEl.addEventListener("pointermove",function(e){
  if(!drag) return;
  var r=contentRect(), vb=vp.getBoundingClientRect();
  if(r.w < 4 || r.h < 4) return;
  var nx=(e.clientX - drag.dx - vb.left - r.x)/r.w, ny=(e.clientY - drag.dy - vb.top - r.y)/r.h;
  if(!isFinite(nx) || !isFinite(ny)) return;
  S.roi.x=Math.max(0.03,Math.min(0.97,nx)); S.roi.y=Math.max(0.03,Math.min(0.97,ny));
  positionOverlays(); updateRoiHint();
});
roiEl.addEventListener("pointerup",function(){
  if(!drag) return;
  drag=null; roiEl.classList.remove("is-drag");
  if(TARGETS[S.monK] && roiTargetDist() < S.target.tol*1.6){       // gentle magnetic snap
    S.roi.x = S.target.x + (S.roi.x - S.target.x)*0.3;
    S.roi.y = S.target.y + (S.roi.y - S.target.y)*0.3;
    positionOverlays();
  }
  updateRoiHint(); render();
});
roiEl.addEventListener("wheel",function(e){
  if(S.phase!=="plan") return;
  e.preventDefault(); resizeRoi(e.deltaY>0? -0.003 : 0.003);
},{passive:false});
function roiTargetDist(){ return Math.hypot(S.roi.x - S.target.x, S.roi.y - S.target.y); }
function roiSizeOK(){ var mm=mmDiameter(); return mm>=8 && mm<=2*S.target.tol*FOV_MM+2; }
function updateRoiHint(){
  if(S.phase!=="plan" || !S.roiActive) return;
  var hintEl=$("scgRoiHint"); if(!hintEl) return;
  var art=roiArtFrac(S.monK);
  var inAorta = !!TARGETS[S.monK] && roiTargetDist() < S.target.tol && art > 0.8;
  var sizeOK = roiSizeOK();
  roiEl.classList.remove("is-locked","is-bad");
  hintEl.classList.remove("is-ok","is-warn");
  targetEl.classList.toggle("is-near", roiTargetDist() < S.target.tol*1.8);
  var msg, cls="";
  S.roiLocked=false;
  if(inAorta && sizeOK){
    S.roiLocked=true; roiEl.classList.add("is-locked");
    roiTag.textContent="ROI · aorta"; cls="is-ok";
    msg="ROI inside the aortic lumen. Set the trigger, then <b>inject</b>.";
  } else if(inAorta){
    roiEl.classList.add("is-bad"); roiTag.textContent="ROI · adjust size"; cls="is-warn";
    msg = mmDiameter()<8 ? "ROI too small — noisy readings. Enlarge it (≥ 8 mm) within the lumen."
                         : "ROI too large — it overlaps the vessel wall (and any calcium or thrombus). Shrink it inside the lumen.";
  } else if(!TARGETS[S.monK]){
    roiTag.textContent="ROI"; cls="is-warn";
    msg="There is no aorta on this slice — the level was set at "+rangeLabel(axFrac(S.monK))+". Small leg arteries make a poor, noisy trigger. Go <b>back</b> and choose again, or track whatever you can.";
  } else if(art > 0.3){
    roiTag.textContent="ROI"; cls="is-warn";
    msg="Partly in the aorta — centre it in the lumen.";
  } else {
    roiTag.textContent="ROI";
    msg="Drag the ROI into the <b>aorta</b> — the round vessel just in front of the vertebral body.";
  }
  hintEl.innerHTML=msg; if(cls) hintEl.classList.add(cls);
  renderCmds();
}

/* =============================================================
   MONITOR — bolus tracking
   ============================================================= */
function startMonitor(){
  if(S.injected) return;
  S.injected=true; S.t=0; S.huSeries=[]; S.triggered=false;
  if(!S.roiLocked) log("note: ROI is not in the aorta — the trigger may misbehave.","warn");
  setPhase("monitor");
  log("contrast injecting — 140 mL @ 4 mL/s + 40 mL saline. Monitoring from "+MON_START.toFixed(0)+" s, every "+MON_CYCLE+" s.","ok");
  roiEl.classList.add("is-locked"); roiEl.classList.remove("is-bad"); roiTag.textContent="ROI · monitoring";
  S.t = MON_START - MON_CYCLE;
  tickMonitor();
  S.monTimer=setInterval(tickMonitor, MON_MS);
}
function tickMonitor(){
  if(S.triggered || S.phase!=="monitor") return;
  S.t = +(S.t + MON_CYCLE).toFixed(2);
  var t=S.t;
  showMonitorFrame(t, true, function(hu){
    if(S.triggered) return;
    var v=Math.round(roiMeanHU(hu));
    S.huSeries.push({ t:t, hu:v });
    var huVal=$("scgHuVal"); if(huVal) huVal.textContent=v;
    var box=$("scgHuBox"); if(box) box.classList.toggle("is-warn", v>=S.threshold);
    var el=$("scgElapsed"); if(el) el.textContent=t.toFixed(1)+" s";
    var st=$("scgMonState");
    if(st) st.textContent = v < 70 ? "baseline" : v < S.threshold ? "contrast arriving" : "THRESHOLD";
    vpBL.textContent = "t "+t.toFixed(1)+" s · ROI "+v+" HU";
    vpTL.textContent = "BOLUS TRACKING\n"+(v < 70 ? "waiting for the bolus" : v < S.threshold ? "contrast arriving in the aorta" : "aorta opacified");
    drawTDC();
    if(v >= S.threshold){ triggerScan("auto"); return; }
    if(t >= MON_TIMEOUT){ log("no trigger after "+MON_TIMEOUT+" s — monitoring timed out; scanner starts anyway.","bad"); triggerScan("timeout"); }
  });
}
function drawTDC(){
  var c=$("scgTdc"); if(!c) return;
  var ctx=c.getContext("2d"), W=c.width, H=c.height;
  ctx.fillStyle="#0a0d08"; ctx.fillRect(0,0,W,H);
  var padL=26, padB=16, padT=8, padR=6, gx=W-padL-padR, gy=H-padT-padB;
  var maxT=Math.max(25, S.t+2, S.trigT!=null ? S.trigT+DIAG_DELAY+1 : 0, S.method==="timed" ? S.delay+4 : 0), maxHU=500;
  ctx.strokeStyle="#1c2717"; ctx.lineWidth=1; ctx.beginPath();
  for(var h=0;h<=500;h+=100){ var y=padT+gy-(h/maxHU)*gy; ctx.moveTo(padL,y); ctx.lineTo(padL+gx,y); }
  ctx.stroke();
  ctx.font="9px ui-monospace,monospace";
  if(S.method==="timed"){
    var dx=padL+(S.delay/maxT)*gx;
    ctx.fillStyle="rgba(224,108,95,.14)"; ctx.fillRect(dx,padT,padL+gx-dx,gy);
    ctx.strokeStyle="rgba(224,108,95,.85)"; ctx.setLineDash([2,3]); ctx.beginPath(); ctx.moveTo(dx,padT); ctx.lineTo(dx,padT+gy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle="#e06c5f"; ctx.fillText("scan "+S.delay+"s",dx+3,padT+9);
  } else {
    var ty=padT+gy-(S.threshold/maxHU)*gy;
    ctx.strokeStyle="rgba(232,180,95,.8)"; ctx.setLineDash([4,3]); ctx.beginPath();
    ctx.moveTo(padL,ty); ctx.lineTo(padL+gx,ty); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle="rgba(232,180,95,.9)";
    ctx.fillText(String(S.threshold),2,ty+3);
  }
  ctx.fillStyle="#4c5c44"; ctx.fillText("HU",2,padT+7);
  if(S.huSeries.length){
    ctx.strokeStyle="#5fe08a"; ctx.lineWidth=1.8; ctx.beginPath();
    S.huSeries.forEach(function(p,i){
      var x=padL+(p.t/maxT)*gx, y=padT+gy-(Math.max(-50,Math.min(p.hu,maxHU))/maxHU)*gy;
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    });
    ctx.stroke();
    var last=S.huSeries[S.huSeries.length-1];
    ctx.fillStyle="#5fe08a"; ctx.beginPath();
    ctx.arc(padL+(last.t/maxT)*gx, padT+gy-(Math.max(-50,Math.min(last.hu,maxHU))/maxHU)*gy, 2.6, 0, 7); ctx.fill();
  }
  if(S.trigT!=null){                                   // trigger + scan-start markers
    var trx=padL+(S.trigT/maxT)*gx, scx=padL+((S.trigT+DIAG_DELAY)/maxT)*gx;
    ctx.strokeStyle="rgba(95,224,138,.7)"; ctx.setLineDash([2,3]); ctx.beginPath(); ctx.moveTo(trx,padT); ctx.lineTo(trx,padT+gy); ctx.stroke();
    ctx.strokeStyle="rgba(224,108,95,.8)"; ctx.beginPath(); ctx.moveTo(scx,padT); ctx.lineTo(scx,padT+gy); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle="#5fe08a"; ctx.fillText("trig",trx+2,padT+8); ctx.fillStyle="#e06c5f"; ctx.fillText("scan",scx+2,padT+18);
  }
  ctx.fillStyle="#4c5c44"; ctx.fillText("0",padL-2,H-4); ctx.fillText(maxT.toFixed(0)+"s",padL+gx-14,H-4);
}

/* =============================================================
   TIMED SCAN
   ============================================================= */
var TIMED_K = 24;                 // upper abdominal aorta slice used for the simulated view
function startTimed(){
  if(S.injected) return;
  S.injected=true; S.t=0; S.huSeries=[];
  S.monK = TIMED_K;
  setPhase("countdown");
  log("contrast injecting — scan programmed for t = "+S.delay+" s.","ok");
  trigEl.classList.remove("scg-hidden");
  trigEl.querySelector("b").textContent = "TIMED SCAN · SIMULATED VIEW";
  vpTL.textContent = "SIMULATED · NOT ACQUIRED\nupper abdominal aorta";
  vpBR.textContent = "WL 40  WW 400";
  var tick = function(){
    var t=S.t, left=S.delay-t;
    var ao=Math.round(artHU(t, TIMED_K*AX_STEP));
    S.huSeries.push({ t:t, hu:ao });
    showMonitorFrame(t, false);
    var v=$("scgHuVal"); if(v) v.textContent=ao;
    var box=$("scgHuBox"); if(box) box.classList.toggle("is-warn", ao>=250);
    var el=$("scgElapsed"); if(el) el.textContent=t.toFixed(1)+" s";
    vpBL.textContent = "t "+t.toFixed(1)+" s · aorta "+ao+" HU";
    trigTx.textContent = left > 4 ? "contrast injecting · scan starts at "+S.delay+" s"
                       : left > 0 ? "“Breathe in… and hold.” · scan in "+left.toFixed(1)+" s" : "scanning";
    drawTDC();
    if(Math.abs(t-(S.delay-4))<0.01) log("auto-voice: “breathe in… and hold your breath.”","sys");
    if(t >= S.delay){
      clearInterval(S.monTimer); S.monTimer=null;
      trigEl.classList.add("scg-hidden");
      log("t = "+S.delay+" s — scan starts (aorta "+ao+" HU at this moment).", ao>=200?"ok":"warn");
      beginScan(S.delay, "timed"); return;
    }
    S.t = +(S.t+0.5).toFixed(1);
  };
  tick();
  S.monTimer=setInterval(tick, 330);
}

/* =============================================================
   TRIGGER + ACQUIRE
   ============================================================= */
function triggerScan(how){
  if(S.triggered) return;
  S.triggered=true;
  clearInterval(S.monTimer); S.monTimer=null;
  S.trigT=S.t; S.trigHow=how;
  var last=S.huSeries.length? S.huSeries[S.huSeries.length-1].hu : 0;
  if(how==="auto") log("threshold reached ("+last+" HU ≥ "+S.threshold+") at t = "+S.t.toFixed(1)+" s — breath-hold, scan in "+DIAG_DELAY+" s.","ok");
  else if(how==="manual") log("manual trigger at t = "+S.t.toFixed(1)+" s ("+last+" HU) — scan in "+DIAG_DELAY+" s.","warn");
  var tScan = S.t + DIAG_DELAY;
  if(how==="timeout" || S.phase!=="monitor"){ beginScan(tScan, how); return; }
  // keep the monitor running through the breath-hold delay
  trigEl.classList.remove("scg-hidden");
  trigEl.querySelector("b").textContent = how==="auto" ? "THRESHOLD REACHED · "+last+" HU" : "MANUAL TRIGGER";
  roiEl.classList.add("is-trig");
  renderCmds();
  var step = function(){
    var left = tScan - S.t;
    trigTx.textContent = left > DIAG_DELAY-1.3 ? "“Breathe in… and hold your breath.”" : "scan starts in "+Math.max(0, left).toFixed(1)+" s";
    if(left <= 0.01){ clearInterval(S.monTimer); S.monTimer=null; trigEl.classList.add("scg-hidden"); roiEl.classList.remove("is-trig"); beginScan(tScan, how); return; }
    S.t = +Math.min(tScan, S.t + MON_CYCLE).toFixed(2);
    var t = S.t;
    showMonitorFrame(t, true, function(hu){
      var v=Math.round(roiMeanHU(hu));
      S.huSeries.push({ t:t, hu:v });
      var huVal=$("scgHuVal"); if(huVal) huVal.textContent=v;
      var el=$("scgElapsed"); if(el) el.textContent=t.toFixed(1)+" s";
      var st=$("scgMonState"); if(st) st.textContent="triggered · breath-hold";
      vpBL.textContent = "t "+t.toFixed(1)+" s · ROI "+v+" HU";
      drawTDC();
    });
  };
  step();
  S.monTimer=setInterval(step, MON_MS);
}
/* enhancement summary for the prescribed range and timing */
function enhancementSummary(){
  var top=topMm(), bot=botMm(), e={};
  function mean(z0, z1){ var s=0,n=0; for(var z=z0; z<=z1+1e-6; z+=4){ s+=enhAt(z); n++; } return n? s/n : 0; }
  function min(z0, z1){ var m=1e9; for(var z=z0; z<=z1+1e-6; z+=4) m=Math.min(m, enhAt(z)); return m; }
  var p0=Math.max(top, DOME_MM), p1=Math.min(bot, FEMHEAD_MM);
  e.prox = p1>p0 ? mean(p0, p1) : enhAt(Math.max(top, Math.min(bot, (DOME_MM+FEMHEAD_MM)/2)));
  var d0=Math.max(top, KNEE_MM+60), d1=Math.min(bot, ANKLE_MM+20);
  e.distalImaged = d1 > d0 + 40;
  if(e.distalImaged){ e.distalMin=min(d0, d1); e.distalMean=mean(d0, d1); }
  else { e.distalMin=enhAt(1050); e.distalMean=e.distalMin; }
  /* why the distal vessels are faint, judged at the calf */
  var zc = Math.min(bot, ANKLE_MM), tc = sliceTime(zc) - transit(zc);   // time "seen" by the bolus
  e.outrun = tc < t0() + 3.5;
  e.washout = tc > t0() + INJ + 1.5;
  e.early = S.scanStart - transit(Math.max(top, DOME_MM)) < t0() + 2;  // started before the aorta filled
  e.venous = sliceTime(Math.min(bot, TOE_MM)) > t0() + transit(Math.min(bot, TOE_MM)) + 30;
  return e;
}
/* first table position (below the aortic reference) that the scanner reaches before the bolus does */
function crossover(){
  for(var z=Math.max(topMm(), Z_REF); z<=botMm(); z+=4){ var bf=bolusFront(sliceTime(z)); if(bf<0 || z > bf+5) return z; }
  return botMm();
}
function beginScan(t0s, how){
  S.scanStart=t0s;
  S.enh = enhancementSummary();
  setPhase("acquire");
  img.style.opacity=0.12;
  acqEl.classList.remove("scg-hidden"); acqBig.classList.remove("scg-hidden");
  acqTitle.textContent="ACQUIRING RUN-OFF";
  var T=scanTime(), cm=covMm(), top=topMm(), total=Math.round(cm/1.0);
  var realMs = Math.max(2600, Math.min(6000, T*140)), t_start=performance.now(), warned=false;
  (function frame(){
    var u=Math.min(1, (performance.now()-t_start)/realMs), t=S.scanStart+u*T, z=top+u*cm, bf=bolusFront(t);
    acqBig.textContent="t "+t.toFixed(1)+" s";
    var ahead = z > Z_REF && (bf<0 || z > bf + 5);
    acqNum.innerHTML="TABLE "+(z).toFixed(0)+" mm · "+rangeLabel(F(z))+"<br>BOLUS FRONT "+(bf<0?"not yet in the aorta":Math.min(bf, Z_TOTAL).toFixed(0)+" mm")+
                     (ahead ? '<br><b style="color:var(--bad)">⚠ TABLE AHEAD OF THE BOLUS</b>' : "");
    if(ahead && !warned){ warned=true; var zc=crossover(); log("table overtook the bolus front at the "+rangeLabel(F(zc))+" ("+zc.toFixed(0)+" mm) — arteries below this will be unopacified.","bad"); }
    if(u<1) requestAnimationFrame(frame); else setTimeout(showResult, 380);
  })();
  log("helical run-off: "+cm.toFixed(0)+" mm in "+T.toFixed(1)+" s at "+S.speed+" mm/s, starting t = "+S.scanStart.toFixed(1)+" s.","sys");
}

/* =============================================================
   GRADING
   ============================================================= */
function proxGrade(h){ return h>=250?15 : h>=200?10 : h>=150?5 : 0; }
function distalGrade(h){ return h>=200?25 : h>=150?15 : h>=100?6 : 0; }
function computeScore(){
  var rows=[], total=0, e=S.enh;
  // 1) coverage (30)
  var tOK=rangeTopOK(), bOK=rangeBotOK(), tooHigh = topMm() < DOME_MM-110;
  var topPts = tOK ? (tooHigh ? 10 : 15) : (topMm() < RENAL_MM ? 7 : 0);
  var botPts = bOK ? 15 : (botMm() >= ANKLE_MM ? 7 : 0);
  rows.push({ kind: tOK&&!tooHigh?"ok":(topPts?"warn":"bad"), title:"Upper limit", pts:topPts, max:15,
    body: tOK ? (tooHigh ? "Covers the diaphragm, but starts at the "+rangeLabel(S.range.top)+" — "+Math.round(DOME_MM-topMm())+" mm of chest irradiated for no gain in a run-off."
                         : "At the diaphragm — the abdominal aorta, coeliac axis, SMA and renal arteries are all included.")
              : topMm() < RENAL_MM ? "Starts at the "+rangeLabel(S.range.top)+" — "+Math.round(topMm()-DOME_MM)+" mm below the domes: the coeliac axis / SMA origins may be cut off."
              : "Starts at the "+rangeLabel(S.range.top)+" — the "+(topMm()>BIF_MM?"aorta and iliac inflow are":"visceral and renal arteries are")+" not imaged. Inflow disease decides the treatment plan." });
  rows.push({ kind: bOK?"ok":(botPts?"warn":"bad"), title:"Lower limit", pts:botPts, max:15,
    body: bOK ? "Beyond the tips of the toes — the dorsalis pedis, plantar arteries and pedal arch are included."
              : botMm() >= ANKLE_MM ? "Stops in the "+rangeLabel(S.range.bot)+" — "+Math.round(TOE_MM-botMm())+" mm short of the toes: the pedal arch is partly missed."
              : "Stops at the "+rangeLabel(S.range.bot)+" — the distal run-off (ankle and foot vessels, the usual bypass targets) is not imaged." });
  // 2) enhancement (40)
  var pP=proxGrade(e.prox);
  rows.push({ kind: pP>=15?"ok":(pP?"warn":"bad"), title:"Aorto-iliac enhancement", pts:pP, max:15,
    body: Math.round(e.prox)+" HU in the aorta and iliac arteries (target ≥ 250 HU)."+(e.early && pP<15 ? " The scan started before the bolus had filled the aorta — too early." : "") });
  var dP = e.distalImaged ? distalGrade(e.distalMin) : 0;
  var why = e.outrun ? " The table <b>outran the bolus</b>: at "+S.speed+" mm/s it reached the calves before the contrast did (this patient’s bolus travelled at about "+S.vb+" mm/s)."
          : e.washout ? " The table arrived <b>after the plateau</b> — the injection had finished and the arterial contrast was washing out."+(e.venous?" Veins will also be filling — venous contamination.":"")
          : "";
  rows.push({ kind: !e.distalImaged ? "bad" : dP>=25?"ok":(dP?"warn":"bad"), title:"Distal run-off (calf arteries)", pts:dP, max:25,
    body: !e.distalImaged ? "The calf arteries are outside the scan range — the distal run-off cannot be assessed."
        : "Lowest calf-artery enhancement "+Math.round(e.distalMin)+" HU (target ≥ 200 HU)."+why+(dP>=25 && e.venous ? " Some venous filling in the calves — acceptable, but don't scan slower than this." : "") });
  var sOK = S.speed>=30 && S.speed<=50, sPts = sOK ? 10 : (S.speed>=25 && S.speed<=60 ? 5 : 0);
  rows.push({ kind: sOK?"ok":(sPts?"warn":"bad"), title:"Table speed ("+S.speed+" mm/s · "+scanTime().toFixed(0)+" s)", pts:sPts, max:10,
    body: sOK ? "Matched to the bolus: slow enough not to overtake it in a patient with sluggish flow, fast enough to finish before the injection ends."
        : S.speed>50 ? "Faster than the slowest bolus (~50 mm/s in diseased legs). Fast scanners need a lower pitch or an added delay for run-offs, or they outrun the contrast."
        : "Very slow — "+scanTime().toFixed(0)+" s of scanning outlasts the injection, so the feet are imaged in the washout / venous phase." });
  // 3) technique (20)
  if(S.method==="bt"){
    var lvlOK=levelInBand(), art=roiArtFrac(S.monK);
    var roiOK=S.roiLocked;
    var thrOK=S.threshold>=100 && S.threshold<=180;
    var lPts=lvlOK && TARGETS[S.monK] ?6:0, rPts=roiOK?8:(art>0.5?4:0), tPts=thrOK?6:(S.threshold>=80&&S.threshold<=220?3:0);
    if(S.trigHow==="manual"){ tPts=Math.min(tPts,3); }
    if(S.trigHow==="timeout"){ tPts=0; }
    rows.push({ kind:lPts?"ok":"warn", title:"Monitoring level", pts:lPts, max:6,
      body: lPts ? "On the aorta ("+rangeLabel(axFrac(S.monK))+") — a large vessel that gives a clean, reliable trigger."
                 : "Set at the "+rangeLabel(axFrac(S.monK))+" — no aorta on the monitoring slice." });
    rows.push({ kind:roiOK?"ok":(rPts?"warn":"bad"), title:"Tracking ROI ("+mmDiameter().toFixed(0)+" mm)", pts:rPts, max:8,
      body: roiOK ? "Inside the aortic lumen, clear of the wall."
          : art > 0.5 ? "Mostly in arterial blood but not centred in the aorta, or the wrong size."
          : "Not in an opacifying vessel — the ROI could not see the bolus arrive." });
    rows.push({ kind:thrOK&&S.trigHow==="auto"?"ok":"warn", title:"Trigger", pts:tPts, max:6,
      body: (S.trigHow==="auto" ? "Auto-triggered at t = "+S.trigT.toFixed(1)+" s on a "+S.threshold+" HU threshold"
            : S.trigHow==="manual" ? "Manually triggered at t = "+S.trigT.toFixed(1)+" s"
            : "Never reached the "+S.threshold+" HU threshold — the scan started at the "+MON_TIMEOUT+" s timeout")+
            "; scan began at "+S.scanStart.toFixed(1)+" s. "+(thrOK? "An aortic threshold of 100–180 HU is typical." : "Use a threshold of about 100–150 HU in the aorta.") });
  } else {
    var dOK = S.delay>=18 && S.delay<=24, dPts = dOK?20:(S.delay>=15&&S.delay<=27?10:0);
    rows.push({ kind:dOK?"ok":(dPts?"warn":"bad"), title:"Scan delay ("+S.delay+" s)", pts:dPts, max:20,
      body: (dOK ? "Within a typical 18–24 s window for 4 mL/s."
                 : S.delay<18 ? "Shorter than a typical 18–24 s window — the table can reach the aorta before the contrast does."
                 : "Longer than a typical 18–24 s window — less plateau left for the long journey to the feet.")+
            " This patient’s contrast reached the upper abdominal aorta at "+t0().toFixed(0)+" s; a fixed delay cannot adapt to that, bolus tracking can." });
  }
  rows.forEach(function(r){ total+=r.pts; });
  return { rows:rows, total:total };
}

/* =============================================================
   RESULT
   ============================================================= */
function renderStack(k, cb){
  getSlice(k, function(sl){
    if(!sl) return;
    var hu=huBuffer(sl, enhAt(k*AX_STEP), 7);
    var out=huToDataURL(hu, WINDOWS[S.win]);
    if(S.phase==="result" && S.stackK===k) showSrc(out.src, out.w, out.h, false);
    if(cb) cb();
  });
}
/* run-off MIP: bone-dimmed coronal MIP with the arteries scaled row by row to the enhancement achieved */
var mipBase=null, mipArt=null;
function loadMip(cb){
  if(mipBase && mipArt){ cb(); return; }
  var n=0, done=function(){ if(++n===2) cb(); };
  mipBase=new Image(); mipBase.onload=done; mipBase.src=url("mip_base");
  mipArt=new Image(); mipArt.onload=done; mipArt.src=url("mip_art");
}
function drawRunoffMip(){
  loadMip(function(){
    var W=mipBase.naturalWidth, H=mipBase.naturalHeight, c=document.createElement("canvas");
    c.width=W; c.height=H;
    var g=c.getContext("2d");
    g.drawImage(mipBase,0,0); var b=g.getImageData(0,0,W,H);
    g.clearRect(0,0,W,H); g.drawImage(mipArt,0,0); var a=g.getImageData(0,0,W,H);
    var o=g.createImageData(W,H), top=topMm(), bot=botMm();
    for(var y=0;y<H;y++){
      var z=y*Z_TOTAL/H, inR = z>=top && z<=bot;
      var k = inR ? Math.max(0, (enhAt(z)-40)/(ART_REF-40)) : 0;
      for(var x=0;x<W;x++){
        var i=(y*W+x)*4, base=b.data[i]*(inR?0.42:0.14), art=a.data[i]*k;
        var v=Math.max(base, Math.min(255, art*1.05));
        o.data[i]=v; o.data[i+1]=v; o.data[i+2]=v; o.data[i+3]=255;
        if(art>base && art>30){ o.data[i]=Math.min(255,v*1.0); o.data[i+1]=Math.min(255,v*0.86); o.data[i+2]=Math.min(255,v*0.8); }
      }
    }
    g.putImageData(o,0,0);
    g.strokeStyle="rgba(232,180,95,.8)"; g.setLineDash([6,5]); g.lineWidth=2;
    [top, bot].forEach(function(z){ var yy=z*H/Z_TOTAL; g.beginPath(); g.moveTo(0,yy); g.lineTo(W,yy); g.stroke(); });
    var h=$("scgHeroMip"); if(h) h.src=c.toDataURL("image/jpeg",0.9);
  });
}
function showResult(){
  setPhase("result");
  acqEl.classList.add("scg-hidden");
  img.style.opacity=1;
  roiEl.classList.add("scg-hidden"); targetEl.classList.add("scg-hidden");

  // stack trimmed to the prescribed coverage
  var ks=[]; for(var k=0;k<AX_N;k++){ var f=axFrac(k); if(f>=S.range.top && f<=S.range.bot) ks.push(k); }
  if(!ks.length) ks=[axForFrac((S.range.top+S.range.bot)/2)];
  S.dxLo=Math.min.apply(null,ks); S.dxHi=Math.max.apply(null,ks);
  S.stackK = Math.max(S.dxLo, Math.min(S.dxHi, 28));
  stackSlider.min=S.dxLo; stackSlider.max=S.dxHi; stackSlider.value=S.stackK;
  S.win="cta"; setWindow("cta", true);
  stackUI.classList.remove("scg-hidden"); winBtns.classList.remove("scg-hidden");
  renderStack(S.stackK);
  updateStackMeta();

  var sc=computeScore(), e=S.enh; S.score=sc.total;
  var proxBad = e.prox < 150, distBad = e.distalImaged && e.distalMin < 150;
  watermark.classList.toggle("scg-hidden", !(proxBad||distBad));
  if(proxBad) watermarkTx.innerHTML = "NON-DIAGNOSTIC<br>ARTERIES NOT OPACIFIED";
  else if(distBad) watermarkTx.innerHTML = e.outrun ? "DISTAL RUN-OFF LOST<br>BOLUS OUTRUN" : "DISTAL RUN-OFF LOST<br>CONTRAST WASHED OUT";

  var pct=sc.total, gcls = pct>=85 ? "" : (pct>=60 && !proxBad && !distBad) ? "is-warn" : "is-bad";
  var verdict = pct===100 ? "Perfect study" : (proxBad||distBad) ? "Repeat recommended" : pct>=85 ? "Diagnostic run-off" : pct>=60 ? "Diagnostic with limitations" : "Repeat recommended";
  var h2tx = proxBad ? "Arteries not adequately opacified" : distBad ? (e.outrun ? "Outran the bolus — distal vessels empty" : "Distal vessels faded — scanned too late") : "Arterial tree opacified, aorta to feet";
  var captx = proxBad ? "The aorta and iliac arteries were scanned before (or long after) the contrast was there."
      : distBad ? (e.outrun ? "The table moved down the legs faster than the contrast did. Above the calves the arteries are bright; below, the vessels are empty — that can look exactly like occlusion."
                            : "By the time the table reached the calves the arterial contrast was washing out. Faint distal arteries and filling veins make stenoses hard to judge.")
      : "Bright arteries from the abdominal aorta to the calves: stenoses and occlusions can be judged and the run-off vessels mapped for treatment planning.";

  resultEl.classList.remove("scg-hidden");
  resultEl.innerHTML =
    '<div>'+
      '<h2 class="'+(proxBad||distBad?"is-bad":"")+'">'+h2tx+'</h2>'+
      '<div class="scg-cap">'+captx+'</div>'+
      '<div class="scg-hero scg-hero2"><img id="scgHeroMip" class="scg-hero-mip" alt="Run-off MIP of the arteries at your timing"><img id="scgHeroImg" class="scg-hero-ax" alt="Mid-calf axial image at your timing">'+
        '<div class="scg-hero-lab">RUN-OFF MIP · MID-CALF\nyour range + timing</div>'+
        '<div class="scg-hero-hu">aorto-iliac '+Math.round(e.prox)+' HU · calf '+Math.round(e.distalMin)+' HU\nscan t = '+S.scanStart.toFixed(1)+'–'+(S.scanStart+scanTime()).toFixed(1)+' s</div></div>'+
    '</div>'+
    '<div class="scg-debrief">'+
      '<div class="scg-grade '+gcls+'"><b>'+pct+'%</b><span>'+verdict.toUpperCase()+'<br>'+(S.method==="bt"?"bolus tracking":"timed scan · "+S.delay+" s")+" · "+S.speed+" mm/s"+
        '<div class="scg-bar"><i style="width:'+pct+'%;background:'+(gcls?(gcls==="is-warn"?"var(--warn)":"var(--bad)"):"var(--accent)")+'"></i></div></span></div>'+
      sc.rows.map(function(r){ return drow(r.kind, r.title, r.body, r.pts+" / "+r.max); }).join('')+
      drow("ok", "This patient", "Bolus reached the upper abdominal aorta at "+t0().toFixed(1)+" s and travelled down the legs at about "+S.vb+" mm/s (aorta → ankle in "+transit(ANKLE_MM).toFixed(0)+" s). Both vary from patient to patient — and between runs of this simulator.", "")+
      '<button class="scg-again" id="scgAgain">⟲ '+(pct===100?"Scan another way":"Try again")+'</button>'+
    '</div>'+
    '<div class="scg-credits">'+CREDITS+'</div>';
  $("scgAgain").onclick=function(){ logCmd("reset"); resetAll(); };

  drawRunoffMip();
  getSlice(HERO_K, function(sl){
    if(!sl) return;
    var inR = axFrac(HERO_K)>=S.range.top && axFrac(HERO_K)<=S.range.bot;
    var hu=huBuffer(sl, inR ? enhAt(HERO_K*AX_STEP) : 40, 5);
    var out=huToDataURL(hu, WINDOWS.cta, HERO_CROP);
    var h=$("scgHeroImg"); if(h){ h.src=out.src; h.classList.toggle("is-out", !inR); }
    renderStack(S.stackK);           // the shared canvas was reused — repaint the viewer
  });

  log("study complete — score "+pct+"% ("+verdict+").", pct>=85?"ok":"warn");
  var perfect = pct===100;
  achWrap.classList.toggle("scg-hidden", !perfect);
  if(perfect){ log("★ MARKER UNLOCKED — Legs for Days","ok"); setTimeout(playAchievement, 60); }
  render();
}
function drow(kind,title,body,pts){
  return '<div class="scg-drow"><i class="scg-d-'+kind+'">'+(kind==="ok"?"✓":kind==="warn"?"!":"✗")+'</i>'+
         '<div><b>'+title+'</b>'+(pts?'<em>'+pts+'</em>':'')+'<p>'+body+'</p></div></div>';
}
var CREDITS =
  '<b>Imaging credit.</b> This is a <b>composite of two people</b>, joined at L1/L2. '+
  '<b>Chest → L1</b>, adapted from: KiTS-00026, arterial phase, C4KC-KiTS collection — Heller N, Sathianathen N, Kalapara A, et al. (2019) Data from C4KC-KiTS [Data set], The Cancer Imaging Archive, '+
  '<a href="https://doi.org/10.7937/TCIA.2019.IX49E8NX" target="_blank" rel="noopener">doi:10.7937/TCIA.2019.IX49E8NX</a>, licensed '+
  '<a href="https://creativecommons.org/licenses/by/3.0/" target="_blank" rel="noopener">CC BY 3.0</a>. '+
  '<b>L1 → toes</b>, adapted from: licensed stock footage of a CT lower-limb angiogram (Shutterstock). '+
  '<b>Changes made:</b> the KiTS volume is rescaled (×0.77 wide, ×0.70 deep, ×0.73 long) to match the second patient at the join; the stock footage’s video frames were de-duplicated, '+
  'the table removed and its 8-bit grey levels mapped to approximate HU (it is not calibrated, and its geometry is nominal); scanograms and the run-off MIP are computed from the composite volume, not acquired; '+
  'axial images are resampled every 8 mm and re-encoded as JPEG; arteries (segmented by thresholding and tracking) are digitally rescaled in your browser to simulate the enhancement at the moment the table reached each slice, '+
  'and noise is added (other organs keep the enhancement they had in the source scans, so the “pre-contrast” monitoring slice is not truly unenhanced); monitoring images and time–density curves are simulated from a simplified contrast model, not measured. The 3-D patient-positioning scene is original (three.js, MIT licence). '+
  'Neither the dataset authors nor their institutions endorse this simulator.';

/* ---- stack scrolling ---- */
function updateStackMeta(){
  vpBR.textContent="Im "+(S.stackK-S.dxLo+1)+" / "+(S.dxHi-S.dxLo+1)+"\n"+({cta:"WL 150 WW 700",soft:"WL 40 WW 400",bone:"WL 400 WW 1800"})[S.win];
  var h=enhAt(S.stackK*AX_STEP);
  vpBL.textContent = "arteries "+Math.round(h)+" HU · t "+sliceTime(S.stackK*AX_STEP).toFixed(1)+" s · "+rangeLabel(axFrac(S.stackK));
  vpTL.textContent="CTA RUN-OFF · 1.0 mm\n"+(S.method==="bt"?"bolus tracked":"timed "+S.delay+" s")+" · "+S.speed+" mm/s";
}
function setStackK(k){
  k=Math.max(S.dxLo,Math.min(S.dxHi, k|0));
  if(k===S.stackK) return;
  S.stackK=k; stackSlider.value=k;
  renderStack(k); updateStackMeta();
}
stackSlider.addEventListener("input",function(){ setStackK(parseInt(stackSlider.value,10)); });
vp.addEventListener("wheel",function(e){
  if(S.phase!=="result") return;
  e.preventDefault(); setStackK(S.stackK + (e.deltaY>0?1:-1));
},{passive:false});
var sdrag=null;
vp.addEventListener("pointerdown",function(e){
  if(S.phase!=="result" || winBtns.contains(e.target) || stackUI.contains(e.target)) return;
  sdrag={ y:e.clientY, k:S.stackK }; try{ vp.setPointerCapture(e.pointerId); }catch(_){}
});
vp.addEventListener("pointermove",function(e){ if(sdrag) setStackK(sdrag.k + Math.round((e.clientY - sdrag.y)/6)); });
vp.addEventListener("pointerup",function(){ sdrag=null; });
document.addEventListener("keydown",function(e){
  if(S.phase!=="result" || document.activeElement===cli) return;
  if(e.key==="ArrowUp"||e.key==="ArrowLeft"){ setStackK(S.stackK-1); e.preventDefault(); }
  if(e.key==="ArrowDown"||e.key==="ArrowRight"){ setStackK(S.stackK+1); e.preventDefault(); }
});
function setWindow(w, quiet){
  S.win=w;
  Array.prototype.forEach.call(winBtns.querySelectorAll("button[data-win]"),function(b){ b.classList.toggle("is-on", b.dataset.win===w); });
  if(!quiet && S.phase==="result"){ renderStack(S.stackK); updateStackMeta(); }
}
Array.prototype.forEach.call(winBtns.querySelectorAll("button[data-win]"),function(b){
  b.onclick=function(e){ e.stopPropagation(); setWindow(b.dataset.win); log("$ window "+b.dataset.win,"cmd"); };
});

/* =============================================================
   RESET / BOOT
   ============================================================= */
function resetAll(){
  clearInterval(S.monTimer);
  var speed=S.speed;
  S = freshState();
  S.speed = speed;                                             // keep the operator's last speed
  randomisePatient();
  S.loaded = true;                                             // patient stays on the table
  resultEl.classList.add("scg-hidden");
  achWrap.classList.add("scg-hidden"); achWrap.classList.remove("is-playing");
  roiEl.classList.add("scg-hidden"); roiEl.classList.remove("is-locked","is-bad");
  targetEl.classList.remove("is-near");
  rangeBox.classList.remove("is-off"); pip.classList.remove("is-on","is-off");
  levelLine.classList.remove("is-on");
  watermark.classList.add("scg-hidden");
  img.style.opacity=1; imgB.style.opacity=0;
  setWindow("cta", true);
  logEl.innerHTML="";
  log("system reset — patient still on the table. Re-running the scanogram…","sys");
  topoRunning=false;
  runTopo();
}
function boot(){
  titleEl.classList.add("scg-hidden");
  logEl.innerHTML="";
  S = freshState();
  randomisePatient();
  log("THE SCANOGRAM · CT angiogram run-off simulator","sys");
  log("type  help  at any time.","sys");
  gotoSetup();
}
startBtn.addEventListener("click", boot);

/* preload */
(function preload(){
  ["scout_ap","scout_lat","logo_full","logo_mark","mip_base","mip_art"].forEach(function(n){ var im=new Image(); im.src=url(n); });
  [HERO_K, TIMED_K].forEach(function(k){ getSlice(k, function(){}); });
})();
img.addEventListener("load", positionOverlays);

/* test hook (used by automated checks; harmless in production) */
window.__scg = { S:function(){ return S; }, aoHU:aoHU, artHU:artHU, enhAt:enhAt, computeScore:computeScore, parse:parseCommand,
  summary:enhancementSummary, setPatient:function(shift, vb){ S.patientShift=shift; S.vb=vb; } };
})();
</script>
